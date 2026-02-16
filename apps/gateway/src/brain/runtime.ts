import crypto from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import {
  appendAgentSessionEvent,
  createExecutionWorkspace,
  createPool,
  getAgentSessionById,
  getConnectorSecretById,
  getExecutionWorkspaceByOwner,
  getOrganizationById,
  listAgentSessionEventsTail,
  setAgentSessionRuntime,
  tryLockExecutionWorkspace,
  commitExecutionWorkspaceVersion,
  withTenantContext,
} from "@vespid/db";
import { runAgentLoop } from "@vespid/agent-runtime";
import {
  REMOTE_EXEC_ERROR,
  decryptSecret,
  parseKekFromEnv,
  type GatewayDispatchResponse,
  type GatewayInvokeToolV2,
  type GatewayToolKind,
  type WorkflowContinuationJobPayload,
} from "@vespid/shared";
import { replyKey, sessionBrainKey, sessionEdgesKey, streamToBrain, streamToEdge } from "../bus/keys.js";
import { safeJsonParse, safeJsonStringify } from "../bus/codec.js";
import { ensureConsumerGroup, xaddJson, xreadGroupJson } from "../bus/streams.js";
import type { EdgeToBrainRequest } from "../bus/types.js";
import { createInMemoryResultsStore, createRedisResultsStore, type ResultsStore } from "../results-store.js";
import { buildWorkspaceObjectKey, createWorkspaceS3Client, presignWorkspaceDownloadUrl, presignWorkspaceUploadUrl, readWorkspaceS3ConfigFromEnv } from "../workspaces/s3.js";
import { getExecutorLastUsedMs, getInFlight, listExecutorRoutes, markExecutorUsed, reserveCapacity, releaseCapacity } from "./scheduler.js";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const port = Number(url.port || 6379);
  const host = url.hostname || "127.0.0.1";
  const password = url.password ? decodeURIComponent(url.password) : null;
  const username = url.username ? decodeURIComponent(url.username) : null;
  const tls = url.protocol === "rediss:";
  const dbValue = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : null;

  const options: ConnectionOptions = { host, port, maxRetriesPerRequest: null };
  if (username) (options as any).username = username;
  if (password) (options as any).password = password;
  if (dbValue !== null && Number.isFinite(dbValue)) (options as any).db = dbValue;
  if (tls) (options as any).tls = {};
  return options;
}

async function waitForJsonReply<T>(redis: Redis, requestId: string, timeoutMs: number): Promise<T | null> {
  const key = replyKey(requestId);
  const deadline = Date.now() + Math.max(100, timeoutMs);
  let delay = 25;
  for (;;) {
    const raw = await redis.get(key);
    if (raw) {
      const parsed = safeJsonParse(raw);
      return parsed as T;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(250, Math.floor(delay * 1.4));
  }
}

type SelectedExecutor = {
  executorId: string;
  edgeId: string;
  maxInFlight: number;
};

async function selectExecutorForTool(redis: Redis, input: {
  organizationId: string;
  kind: GatewayToolKind;
  selector?: { executorId?: string | null; labels?: string[] | null } | null;
  orgMaxInFlight: number;
  reserveTtlMs: number;
}): Promise<SelectedExecutor | null> {
  const selectorExecutorId = input.selector?.executorId ?? null;
  const selectorLabels = input.selector?.labels ?? null;

  if (selectorExecutorId) {
    const routes = await listExecutorRoutes(redis, { organizationId: input.organizationId });
    const match = routes.find((r) => r.executorId === selectorExecutorId) ?? null;
    if (!match) return null;
    if (!match.kinds?.includes(input.kind)) return null;
    const maxInFlight = match.maxInFlight ?? 10;
    const reserved = await reserveCapacity(redis, {
      executorId: match.executorId,
      organizationId: input.organizationId,
      executorMaxInFlight: maxInFlight,
      orgMaxInFlight: input.orgMaxInFlight,
      ttlMs: input.reserveTtlMs,
    });
    if (!reserved) return null;
    await markExecutorUsed(redis, match.executorId);
    return { executorId: match.executorId, edgeId: match.edgeId, maxInFlight };
  }

  const routes = await listExecutorRoutes(redis, { organizationId: input.organizationId });
  const candidates = routes
    .filter((r) => (r.kinds ?? []).includes(input.kind))
    .filter((r) => {
      if (!selectorLabels || selectorLabels.length === 0) return true;
      const labels = new Set((r.labels ?? []).filter((x) => typeof x === "string"));
      return selectorLabels.every((need) => labels.has(need));
    });

  if (candidates.length === 0) return null;

  // Score by least loaded ratio; tie-break by least recently used.
  const scored: Array<{ r: (typeof candidates)[number]; ratio: number; lastUsedMs: number }> = [];
  for (const r of candidates) {
    const maxInFlight = r.maxInFlight ?? 10;
    const inFlight = await getInFlight(redis, r.executorId);
    const ratio = maxInFlight > 0 ? inFlight / maxInFlight : 1;
    const lastUsedMs = await getExecutorLastUsedMs(redis, r.executorId);
    scored.push({ r, ratio, lastUsedMs });
  }

  scored.sort((a, b) => {
    if (a.ratio !== b.ratio) return a.ratio - b.ratio;
    return a.lastUsedMs - b.lastUsedMs;
  });

  for (const entry of scored) {
    const maxInFlight = entry.r.maxInFlight ?? 10;
    const reserved = await reserveCapacity(redis, {
      executorId: entry.r.executorId,
      organizationId: input.organizationId,
      executorMaxInFlight: maxInFlight,
      orgMaxInFlight: input.orgMaxInFlight,
      ttlMs: input.reserveTtlMs,
    });
    if (!reserved) {
      continue;
    }
    await markExecutorUsed(redis, entry.r.executorId);
    return { executorId: entry.r.executorId, edgeId: entry.r.edgeId, maxInFlight };
  }

  return null;
}

function buildSessionTranscript(events: Array<{ eventType: string; payload: any; level: string }>) {
  const steps: any[] = [];
  for (const e of events) {
    if (e.eventType === "user_message") {
      steps.push({ role: "user", content: typeof e.payload?.message === "string" ? e.payload.message : safeJsonStringify(e.payload ?? null) });
      continue;
    }
    if (e.eventType === "agent_message" || e.eventType === "agent_delta") {
      const content =
        typeof e.payload?.message === "string"
          ? e.payload.message
          : typeof e.payload?.content === "string"
            ? e.payload.content
            : safeJsonStringify(e.payload ?? null);
      steps.push({ role: "assistant", content });
      continue;
    }
    steps.push({ type: e.eventType, level: e.level, payload: e.payload ?? null });
  }
  return steps;
}

async function loadSecretValueFromDb(input: { pool: ReturnType<typeof createPool>; organizationId: string; userId: string; secretId: string }): Promise<string> {
  const kek = parseKekFromEnv();
  const row = await withTenantContext(input.pool, { organizationId: input.organizationId }, async (db) =>
    getConnectorSecretById(db, { organizationId: input.organizationId, secretId: input.secretId })
  );
  if (!row) return "";
  try {
    return decryptSecret({
      encrypted: {
        kekId: row.kekId,
        dekCiphertext: row.dekCiphertext,
        dekIv: row.dekIv,
        dekTag: row.dekTag,
        secretCiphertext: row.secretCiphertext,
        secretIv: row.secretIv,
        secretTag: row.secretTag,
      },
      resolveKek: (kekId) => (kekId === kek.kekId ? kek.kekKeyBytes : null),
    });
  } catch {
    return "";
  }
}

export async function startGatewayBrainRuntime(input?: {
  pool?: ReturnType<typeof createPool>;
  brainId?: string;
  redis?: Redis;
  resultsStore?: ResultsStore;
}) {
  const pool = input?.pool ?? createPool(process.env.DATABASE_URL);
  const ownsPool = !input?.pool;

  const redisUrl = process.env.REDIS_URL ?? null;
  if (!redisUrl && !input?.redis) {
    throw new Error("REDIS_URL_REQUIRED");
  }
  const redis = input?.redis ?? new Redis(redisUrl!, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });
  const ownsRedis = !input?.redis;

  const resultsStore =
    input?.resultsStore ??
    (process.env.REDIS_URL ? createRedisResultsStore(process.env.REDIS_URL) : createInMemoryResultsStore());

  const resultsTtlSec = Math.max(30, envNumber("GATEWAY_RESULTS_TTL_SEC", 15 * 60));
  const brainId = input?.brainId ?? process.env.GATEWAY_BRAIN_ID ?? `brain-${crypto.randomBytes(6).toString("hex")}`;

  const orgMaxInFlight = Math.max(1, envNumber("GATEWAY_ORG_MAX_INFLIGHT", 50));
  const reserveTtlMs = Math.max(5_000, envNumber("GATEWAY_RESERVE_TTL_MS", 5 * 60 * 1000));

  const s3Config = readWorkspaceS3ConfigFromEnv();
  const s3Client = s3Config ? createWorkspaceS3Client(s3Config) : null;
  const workspaceUrlExpiresInSec = Math.max(60, envNumber("WORKSPACE_PRESIGN_EXPIRES_SEC", 10 * 60));

  const continuationQueueName = process.env.WORKFLOW_CONTINUATION_QUEUE_NAME ?? "workflow-continuations";
  const continuationQueue =
    process.env.REDIS_URL
      ? new Queue<WorkflowContinuationJobPayload>(continuationQueueName, { connection: parseRedisConnectionOptions(process.env.REDIS_URL) })
      : null;

  async function broadcastToSessionEdges(sessionId: string, event: unknown) {
    const edgeIds = await redis.smembers(sessionEdgesKey(sessionId));
    for (const edgeId of edgeIds) {
      await xaddJson(redis, streamToEdge(edgeId), { type: "client_broadcast", sessionId, event });
    }
  }

  async function invokeToolOnExecutor(inputTool: {
    organizationId: string;
    userId: string;
    selectorExecutorId?: string | null;
    selectorLabels?: string[] | null;
    kind: GatewayToolKind;
    payload: unknown;
    secret?: string;
    timeoutMs: number;
    networkMode: "none" | "enabled";
    workspaceOwner: { ownerType: "session" | "workflow_run"; ownerId: string };
  }): Promise<{ status: "succeeded" | "failed"; output?: unknown; error?: string; workspace?: any }>{
    const selected = await selectExecutorForTool(redis, {
      organizationId: inputTool.organizationId,
      kind: inputTool.kind,
      selector: {
        executorId: inputTool.selectorExecutorId ?? null,
        labels: inputTool.selectorLabels ?? null,
      },
      orgMaxInFlight,
      reserveTtlMs,
    });
    if (!selected) {
      return { status: "failed", error: REMOTE_EXEC_ERROR.NoAgentAvailable };
    }

    try {
      const workspaceRow =
        (await withTenantContext(pool, { organizationId: inputTool.organizationId }, async (db) =>
          getExecutionWorkspaceByOwner(db, {
            organizationId: inputTool.organizationId,
            ownerType: inputTool.workspaceOwner.ownerType,
            ownerId: inputTool.workspaceOwner.ownerId,
          })
        )) ??
        (await withTenantContext(pool, { organizationId: inputTool.organizationId }, async (db) =>
          createExecutionWorkspace(db, {
            id: crypto.randomUUID(),
            organizationId: inputTool.organizationId,
            ownerType: inputTool.workspaceOwner.ownerType,
            ownerId: inputTool.workspaceOwner.ownerId,
            currentVersion: 0,
            currentObjectKey: "",
          })
        ));

      const lockToken = crypto.randomBytes(16).toString("hex");
      const locked = await withTenantContext(pool, { organizationId: inputTool.organizationId }, async (db) =>
        tryLockExecutionWorkspace(db, {
          organizationId: inputTool.organizationId,
          workspaceId: workspaceRow.id,
          lockToken,
          lockTtlSec: Math.max(30, Math.ceil(inputTool.timeoutMs / 1000) + 30),
        })
      );
      if (!locked) {
        return { status: "failed", error: "WORKSPACE_LOCKED" };
      }

      const expectedVersion = workspaceRow.currentVersion ?? 0;
      const currentObjectKey = workspaceRow.currentObjectKey ?? "";
      const currentEtag = workspaceRow.currentEtag ?? null;
      const nextVersion = expectedVersion + 1;
      const nextObjectKey = s3Config ? buildWorkspaceObjectKey({ organizationId: inputTool.organizationId, workspaceId: workspaceRow.id, version: nextVersion }) : "";

      if (!s3Client || !s3Config) {
        return { status: "failed", error: "WORKSPACE_S3_NOT_CONFIGURED" };
      }

      const downloadUrl =
        currentObjectKey && currentObjectKey.length > 0
          ? await presignWorkspaceDownloadUrl({
              client: s3Client,
              bucket: s3Config.bucket,
              objectKey: currentObjectKey,
              expiresInSec: workspaceUrlExpiresInSec,
            })
          : null;

      const uploadUrl = await presignWorkspaceUploadUrl({
        client: s3Client,
        bucket: s3Config.bucket,
        objectKey: nextObjectKey,
        expiresInSec: workspaceUrlExpiresInSec,
      });

      const toolRequestId = `${inputTool.workspaceOwner.ownerId}:${crypto.randomBytes(8).toString("hex")}`;
      const invoke: GatewayInvokeToolV2 = {
        type: "invoke_tool_v2",
        requestId: toolRequestId,
        organizationId: inputTool.organizationId,
        userId: inputTool.userId,
        kind: inputTool.kind,
        payload: inputTool.payload,
        ...(inputTool.secret ? { secret: inputTool.secret } : {}),
        toolPolicy: {
          networkModeDefaultDeny: true,
          networkMode: inputTool.networkMode,
          timeoutMs: inputTool.timeoutMs,
          outputMaxChars: Math.max(10_000, envNumber("GATEWAY_TOOL_OUTPUT_MAX_CHARS", 200_000)),
          mountsAllowlist: [
            { containerPath: "/work", mode: "rw" },
            { containerPath: "/tmp", mode: "rw" },
          ],
        },
        workspace: {
          workspaceId: workspaceRow.id,
          version: expectedVersion,
          objectKey: currentObjectKey,
          etag: currentEtag,
        },
        workspaceAccess: {
          ...(downloadUrl ? { downloadUrl } : {}),
          upload: { url: uploadUrl, objectKey: nextObjectKey, version: nextVersion },
        },
      };

      await xaddJson(redis, streamToEdge(selected.edgeId), { type: "executor_invoke", executorId: selected.executorId, invoke });

      const reply = await waitForJsonReply<any>(redis, toolRequestId, inputTool.timeoutMs);
      if (!reply || typeof reply !== "object") {
        return { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout };
      }

      const status = (reply as any).status === "failed" ? "failed" : "succeeded";
      const output = (reply as any).output;
      const error = typeof (reply as any).error === "string" ? ((reply as any).error as string) : undefined;
      const workspace = (reply as any).workspace ?? null;

      if (workspace && typeof workspace === "object" && typeof (workspace as any).version === "number") {
        const committed = await withTenantContext(pool, { organizationId: inputTool.organizationId }, async (db) =>
          commitExecutionWorkspaceVersion(db, {
            organizationId: inputTool.organizationId,
            workspaceId: workspaceRow.id,
            expectedCurrentVersion: expectedVersion,
            nextObjectKey: typeof (workspace as any).objectKey === "string" ? (workspace as any).objectKey : nextObjectKey,
            nextEtag: typeof (workspace as any).etag === "string" ? (workspace as any).etag : null,
          })
        );
        if (!committed) {
          return { status: "failed", error: "WORKSPACE_VERSION_CONFLICT" };
        }
      }

      return { status, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}), ...(workspace ? { workspace } : {}) };
    } finally {
      await releaseCapacity(redis, { executorId: selected.executorId, organizationId: inputTool.organizationId });
    }
  }

  async function handleWorkflowDispatch(msg: Extract<EdgeToBrainRequest, { type: "workflow_dispatch" }>): Promise<void> {
    const dispatch = msg.dispatch;
    const requestId = msg.requestId;
    const timeoutMs = dispatch.timeoutMs ?? 60_000;

    const finish = async (response: GatewayDispatchResponse) => {
      await resultsStore.set(requestId, response, resultsTtlSec);
      await redis.set(replyKey(requestId), safeJsonStringify(response), "EX", resultsTtlSec);
    };

    const runAsync = async () => {
      const response = await executeWorkflowDispatchInternal({ requestId, dispatch, timeoutMs });
      await resultsStore.set(requestId, response, resultsTtlSec);
      if (continuationQueue) {
        const payload: WorkflowContinuationJobPayload = {
          type: "remote.apply",
          organizationId: dispatch.organizationId,
          workflowId: dispatch.workflowId,
          runId: dispatch.runId,
          requestId,
          attemptCount: dispatch.attemptCount,
          result: response,
        };
        const requestHash = sha256Hex(requestId);
        await continuationQueue.add("continuation", payload, {
          jobId: `apply-${requestHash}`,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
      }
    };

    if (msg.async) {
      void runAsync();
      return;
    }

    const response = await executeWorkflowDispatchInternal({ requestId, dispatch, timeoutMs });
    await finish(response);
  }

  async function executeWorkflowDispatchInternal(inputDispatch: {
    requestId: string;
    dispatch: any;
    timeoutMs: number;
  }): Promise<GatewayDispatchResponse> {
    const dispatch = inputDispatch.dispatch as any;
    if (dispatch.kind === "agent.execute" || dispatch.kind === "connector.action") {
      const selectorExecutorId = typeof dispatch.selectorAgentId === "string" ? dispatch.selectorAgentId : null;
      const selectorLabels: string[] = [];
      if (typeof dispatch.selectorTag === "string") selectorLabels.push(dispatch.selectorTag);
      if (typeof dispatch.selectorGroup === "string") selectorLabels.push(dispatch.selectorGroup);

      const tool = await invokeToolOnExecutor({
        organizationId: dispatch.organizationId,
        userId: dispatch.requestedByUserId,
        selectorExecutorId,
        selectorLabels,
        kind: dispatch.kind,
        payload: dispatch.payload,
        ...(typeof dispatch.secret === "string" ? { secret: dispatch.secret } : {}),
        timeoutMs: inputDispatch.timeoutMs,
        networkMode: "none",
        workspaceOwner: { ownerType: "workflow_run", ownerId: dispatch.runId },
      });
      return {
        status: tool.status,
        ...(tool.output !== undefined ? { output: tool.output } : {}),
        ...(tool.error ? { error: tool.error } : {}),
      };
    }

    if (dispatch.kind === "agent.run") {
      const payload = dispatch.payload ?? null;
      const parsed = z
        .object({
          nodeId: z.string().min(1),
          node: z.unknown(),
          runId: z.string().uuid(),
          workflowId: z.string().uuid(),
          attemptCount: z.number().int().min(1),
          runInput: z.unknown().optional(),
          steps: z.unknown().optional(),
          organizationSettings: z.unknown().optional(),
          env: z.object({ githubApiBaseUrl: z.string().url() }),
        })
        .safeParse(payload);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_AGENT_RUN_PAYLOAD" };
      }

      const nodeAny = parsed.data.node as any;
      const cfg = nodeAny?.config as any;
      const engineId = cfg?.engine?.id ?? "gateway.loop.v2";
      const llmProvider =
        engineId === "gateway.codex.v2"
          ? "openai"
          : engineId === "gateway.claude.v2"
            ? "anthropic"
            : (cfg?.llm?.provider ?? "openai");
      const effectiveToolsAllow = Array.isArray(payload?.effectiveToolsAllow) ? (payload as any).effectiveToolsAllow : (cfg?.tools?.allow ?? []);

      let runtime: unknown = {};
      let pendingRemoteResult: unknown = null;
      for (;;) {
        const result = await runAgentLoop({
          organizationId: dispatch.organizationId,
          workflowId: parsed.data.workflowId,
          runId: parsed.data.runId,
          attemptCount: parsed.data.attemptCount,
          requestedByUserId: dispatch.requestedByUserId,
          nodeId: parsed.data.nodeId,
          nodeType: "agent.run",
          runInput: parsed.data.runInput,
          steps: parsed.data.steps,
          organizationSettings: parsed.data.organizationSettings,
          runtime,
          pendingRemoteResult,
          githubApiBaseUrl: parsed.data.env.githubApiBaseUrl,
          loadSecretValue: ({ organizationId, userId, secretId }) => loadSecretValueFromDb({ pool, organizationId, userId, secretId }),
          fetchImpl: fetch,
          config: {
            llm: {
              provider: llmProvider,
              model: cfg?.llm?.model ?? "gpt-4.1-mini",
              auth: cfg?.llm?.auth ?? { fallbackToEnv: true },
            },
            prompt: cfg?.prompt ?? { instructions: "" },
            tools: {
              allow: effectiveToolsAllow,
              execution: cfg?.tools?.execution === "cloud" ? "cloud" : "executor",
              ...(cfg?.tools?.authDefaults ? { authDefaults: cfg.tools.authDefaults } : {}),
            },
            limits: cfg?.limits ?? { maxTurns: 8, maxToolCalls: 20, timeoutMs: inputDispatch.timeoutMs, maxOutputChars: 50_000, maxRuntimeChars: 200_000 },
            output: cfg?.output ?? { mode: "text" },
          },
          persistNodeId: parsed.data.nodeId,
          allowRemoteBlocked: true,
        });

        if (result.status === "succeeded") {
          return { status: "succeeded", output: result.output ?? null };
        }
        if (result.status === "failed") {
          return { status: "failed", error: result.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed, ...(result.output !== undefined ? { output: result.output } : {}) };
        }
        if (result.status !== "blocked") {
          return { status: "failed", error: "INVALID_AGENT_LOOP_RESULT" };
        }

        runtime = (result as any).runtime ?? runtime;
        const block = (result as any).block;
        const kind = block?.kind as GatewayToolKind;
        if (kind !== "agent.execute" && kind !== "connector.action") {
          return { status: "failed", error: "INVALID_BLOCK_KIND" };
        }
        const toolRes = await invokeToolOnExecutor({
          organizationId: dispatch.organizationId,
          userId: dispatch.requestedByUserId,
          selectorExecutorId: typeof block.selectorAgentId === "string" ? block.selectorAgentId : null,
          selectorLabels: [
            ...(typeof block.selectorTag === "string" ? [block.selectorTag] : []),
            ...(typeof block.selectorGroup === "string" ? [block.selectorGroup] : []),
          ],
          kind,
          payload: block.payload,
          ...(typeof block.secret === "string" ? { secret: block.secret } : {}),
          timeoutMs: inputDispatch.timeoutMs,
          networkMode: "none",
          workspaceOwner: { ownerType: "workflow_run", ownerId: parsed.data.runId },
        });
        pendingRemoteResult = { requestId: inputDispatch.requestId, result: toolRes };
      }
    }

    return { status: "failed", error: "UNSUPPORTED_KIND" };
  }

  async function handleSessionSend(msg: Extract<EdgeToBrainRequest, { type: "session_send" }>) {
    const lockKey = sessionBrainKey(msg.sessionId);
    const lockTtlSec = 30;
    const lockOk = await redis.set(lockKey, brainId, "EX", lockTtlSec, "NX");
    if (!lockOk) {
      return;
    }

    try {
      const session = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        getAgentSessionById(db, { organizationId: msg.organizationId, sessionId: msg.sessionId })
      );
      if (!session) {
        return;
      }

      const orgRow = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        getOrganizationById(db, { organizationId: msg.organizationId })
      );
      const organizationSettings = orgRow ? orgRow.settings : null;

      const tail = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        listAgentSessionEventsTail(db, { organizationId: msg.organizationId, sessionId: msg.sessionId, limit: 50 })
      );
      const steps = buildSessionTranscript(tail.map((e) => ({ eventType: e.eventType, payload: e.payload, level: e.level })));

      const toolsAllow = Array.isArray((session as any).toolsAllow) ? ((session as any).toolsAllow as any[]).filter((t) => typeof t === "string") : [];
      const limitsRaw = session.limits;
      const limits = typeof limitsRaw === "object" && limitsRaw && !Array.isArray(limitsRaw) ? (limitsRaw as any) : {};
      const timeoutMs = typeof limits.timeoutMs === "number" ? limits.timeoutMs : 60_000;
      const sessionEngineId = session.engineId ?? "gateway.loop.v2";
      const sessionLlmProvider =
        sessionEngineId === "gateway.codex.v2"
          ? "openai"
          : sessionEngineId === "gateway.claude.v2"
            ? "anthropic"
            : (session.llmProvider as any);

      let runtime: any = session.runtime && typeof session.runtime === "object" ? session.runtime : {};
      let pendingRemoteResult: unknown = null;
      const runInput = { messageSeq: msg.userEventSeq };

      for (;;) {
        const result = await runAgentLoop({
          organizationId: msg.organizationId,
          workflowId: msg.sessionId,
          runId: msg.sessionId,
          attemptCount: msg.userEventSeq + 1,
          requestedByUserId: msg.userId,
          nodeId: "agent",
          nodeType: "agent.run",
          runInput,
          steps,
          organizationSettings,
          runtime,
          pendingRemoteResult,
          githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
          loadSecretValue: ({ organizationId, userId, secretId }) => loadSecretValueFromDb({ pool, organizationId, userId, secretId }),
          fetchImpl: fetch,
          config: {
            llm: { provider: sessionLlmProvider as any, model: session.llmModel, auth: { fallbackToEnv: true } },
            prompt: { ...(session.promptSystem ? { system: session.promptSystem } : {}), instructions: session.promptInstructions },
            tools: { allow: toolsAllow, execution: "executor" },
            limits: {
              maxTurns: typeof limits.maxTurns === "number" ? limits.maxTurns : 8,
              maxToolCalls: typeof limits.maxToolCalls === "number" ? limits.maxToolCalls : 20,
              timeoutMs,
              maxOutputChars: typeof limits.maxOutputChars === "number" ? limits.maxOutputChars : 50_000,
              maxRuntimeChars: typeof limits.maxRuntimeChars === "number" ? limits.maxRuntimeChars : 200_000,
            },
            output: { mode: "text" },
          },
          persistNodeId: "agent",
          allowRemoteBlocked: true,
        });

        if ((result as any).runtime && typeof (result as any).runtime === "object") {
          runtime = (result as any).runtime;
          await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
            setAgentSessionRuntime(db, { organizationId: msg.organizationId, sessionId: msg.sessionId, runtime })
          );
        }

        if (result.status === "succeeded") {
          const out = result.output ?? null;
          const agentEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
            appendAgentSessionEvent(db, { organizationId: msg.organizationId, sessionId: msg.sessionId, eventType: "agent_message", level: "info", payload: { message: typeof out === "string" ? out : safeJsonStringify(out) } })
          );
          await broadcastToSessionEdges(msg.sessionId, {
            type: "session_event",
            sessionId: msg.sessionId,
            seq: agentEvent.seq,
            eventType: agentEvent.eventType,
            level: agentEvent.level,
            payload: agentEvent.payload ?? null,
            createdAt: agentEvent.createdAt.toISOString(),
          });
          return;
        }

        if (result.status === "failed") {
          const err = result.error ?? "AGENT_FAILED";
          const errorEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
            appendAgentSessionEvent(db, { organizationId: msg.organizationId, sessionId: msg.sessionId, eventType: "error", level: "error", payload: { code: err } })
          );
          await broadcastToSessionEdges(msg.sessionId, {
            type: "session_event",
            sessionId: msg.sessionId,
            seq: errorEvent.seq,
            eventType: errorEvent.eventType,
            level: errorEvent.level,
            payload: errorEvent.payload ?? null,
            createdAt: errorEvent.createdAt.toISOString(),
          });
          return;
        }

        if (result.status !== "blocked") {
          return;
        }

        const block = (result as any).block;
        const kind = block?.kind as GatewayToolKind;
        if (kind !== "agent.execute" && kind !== "connector.action") {
          throw new Error("INVALID_SESSION_BLOCK_KIND");
        }
        const toolRes = await invokeToolOnExecutor({
          organizationId: msg.organizationId,
          userId: msg.userId,
          selectorExecutorId: typeof block.selectorAgentId === "string" ? block.selectorAgentId : null,
          selectorLabels: [
            ...(typeof block.selectorTag === "string" ? [block.selectorTag] : []),
            ...(typeof block.selectorGroup === "string" ? [block.selectorGroup] : []),
          ],
          kind,
          payload: block.payload,
          ...(typeof block.secret === "string" ? { secret: block.secret } : {}),
          timeoutMs,
          networkMode: "none",
          workspaceOwner: { ownerType: "session", ownerId: msg.sessionId },
        });
        pendingRemoteResult = { requestId: msg.requestId, result: toolRes };
      }
    } finally {
      try {
        await redis.del(lockKey);
      } catch {
        // ignore
      }
    }
  }

  const stream = streamToBrain();
  const group = "brain";
  const consumer = `${brainId}:${process.pid}`;
  await ensureConsumerGroup(redis, stream, group);

  let closed = false;

  const loop = (async () => {
    for (;;) {
      if (closed) return;
      const records = await xreadGroupJson({ redis, stream, group, consumer, count: 25, blockMs: 15_000 });
      for (const rec of records) {
        try {
          const msg = rec.message as EdgeToBrainRequest | null;
          if (!msg || typeof msg !== "object") {
            continue;
          }
          if (msg.type === "workflow_dispatch") {
            await handleWorkflowDispatch(msg);
          } else if (msg.type === "session_send") {
            await handleSessionSend(msg);
          }
        } finally {
          try {
            await redis.xack(stream, group, rec.id);
          } catch {
            // ignore
          }
        }
      }
    }
  })();

  return {
    async close() {
      closed = true;
      try {
        await loop;
      } catch {
        // ignore
      }
      try {
        if (continuationQueue) await continuationQueue.close();
      } catch {
        // ignore
      }
      try {
        await resultsStore.close();
      } catch {
        // ignore
      }
      if (ownsRedis) {
        try {
          await redis.quit();
        } catch {
          // ignore
        } finally {
          try {
            redis.disconnect();
          } catch {
            // ignore
          }
        }
      }
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}
