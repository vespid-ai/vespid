import crypto from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import {
  appendAgentSessionEvent,
  setAgentSessionPinnedAgent,
  createExecutionWorkspace,
  createPool,
  getAgentSessionById,
  getConnectorSecretById,
  getExecutionWorkspaceByOwner,
  getOrganizationById,
  tryLockExecutionWorkspace,
  commitExecutionWorkspaceVersion,
  withTenantContext,
} from "@vespid/db";
import { runAgentLoop } from "@vespid/agent-runtime";
import {
  REMOTE_EXEC_ERROR,
  type GatewayExecutionKind,
  type ExecutorSelectorV1,
  type GatewayBrainSessionEventV2,
  type GatewayDispatchResponse,
  type GatewayInvokeToolV2,
  type GatewayToolKind,
  type WorkflowContinuationJobPayload,
} from "@vespid/shared";
import { decryptSecret, parseKekFromEnv } from "@vespid/shared/secrets";
import type { LlmInvokeInput, LlmInvokeResult } from "@vespid/agent-runtime";
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
  pool: "managed" | "byon";
};

type SelectExecutorResult =
  | { ok: true; selected: SelectedExecutor }
  | { ok: false; error: "NO_EXECUTOR_AVAILABLE" | "EXECUTOR_OVER_CAPACITY" | "ORG_QUOTA_EXCEEDED" };

async function selectExecutorForTool(redis: Redis, input: {
  organizationId: string;
  kind: GatewayExecutionKind;
  selector?: ExecutorSelectorV1 | null;
  orgMaxInFlight: number;
  reserveTtlMs: number;
}): Promise<SelectExecutorResult> {
  const selectorPool = input.selector?.pool ?? "managed";
  const selectorExecutorId = input.selector?.executorId ?? null;
  const selectorLabels = [
    ...(Array.isArray(input.selector?.labels) ? input.selector!.labels! : []),
    ...(typeof input.selector?.tag === "string" ? [input.selector.tag] : []),
  ];
  const selectorGroup = typeof input.selector?.group === "string" ? input.selector.group : null;
  const matchesSelector = (route: {
    labels?: string[] | undefined;
  }) => {
    const labels = new Set((route.labels ?? []).filter((x) => typeof x === "string"));
    if (!selectorLabels.every((need) => labels.has(need))) {
      return false;
    }
    if (!selectorGroup) {
      return true;
    }
    return labels.has(selectorGroup) || labels.has(`group:${selectorGroup}`);
  };

  const listInput =
    selectorPool === "byon"
      ? { pool: "byon" as const, organizationId: input.organizationId }
      : { pool: "managed" as const };

  if (selectorExecutorId) {
    const routes = await listExecutorRoutes(redis, listInput);
    const match = routes.find((r) => r.executorId === selectorExecutorId) ?? null;
    if (!match) return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
    if (!match.kinds?.includes(input.kind)) return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
    if (selectorPool === "byon" && match.organizationId !== input.organizationId) {
      return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
    }
    if (!matchesSelector(match)) {
      return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
    }
    const maxInFlight = match.maxInFlight ?? 10;
    const reserved = await reserveCapacity(redis, {
      executorId: match.executorId,
      organizationId: input.organizationId,
      executorMaxInFlight: maxInFlight,
      orgMaxInFlight: input.orgMaxInFlight,
      ttlMs: input.reserveTtlMs,
    });
    if (!reserved.ok) {
      return { ok: false, error: reserved.reason === "ORG_QUOTA_EXCEEDED" ? "ORG_QUOTA_EXCEEDED" : "EXECUTOR_OVER_CAPACITY" };
    }
    await markExecutorUsed(redis, match.executorId);
    return { ok: true, selected: { executorId: match.executorId, edgeId: match.edgeId, maxInFlight, pool: match.pool } };
  }

  const routes = await listExecutorRoutes(redis, listInput);
  const candidates = routes
    .filter((r) => (selectorPool === "byon" ? r.organizationId === input.organizationId : true))
    .filter((r) => (r.kinds ?? []).includes(input.kind))
    .filter((r) => matchesSelector(r));

  if (candidates.length === 0) return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };

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

  let sawExecutorOverCapacity = false;
  let sawOrgQuotaExceeded = false;
  for (const entry of scored) {
    const maxInFlight = entry.r.maxInFlight ?? 10;
    const reserved = await reserveCapacity(redis, {
      executorId: entry.r.executorId,
      organizationId: input.organizationId,
      executorMaxInFlight: maxInFlight,
      orgMaxInFlight: input.orgMaxInFlight,
      ttlMs: input.reserveTtlMs,
    });
    if (!reserved.ok) {
      if (reserved.reason === "ORG_QUOTA_EXCEEDED") sawOrgQuotaExceeded = true;
      if (reserved.reason === "EXECUTOR_OVER_CAPACITY") sawExecutorOverCapacity = true;
      continue;
    }
    await markExecutorUsed(redis, entry.r.executorId);
    return { ok: true, selected: { executorId: entry.r.executorId, edgeId: entry.r.edgeId, maxInFlight, pool: entry.r.pool } };
  }

  if (sawOrgQuotaExceeded) return { ok: false, error: "ORG_QUOTA_EXCEEDED" };
  if (sawExecutorOverCapacity) return { ok: false, error: "EXECUTOR_OVER_CAPACITY" };
  return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
}

function resolveSessionPoolOrder(selector: ExecutorSelectorV1 | null | undefined): Array<"byon" | "managed"> {
  if (selector?.pool === "managed") {
    return ["managed"];
  }
  return ["byon", "managed"];
}

async function selectSessionExecutor(redis: Redis, input: {
  organizationId: string;
  selector: ExecutorSelectorV1 | null | undefined;
  orgMaxInFlight: number;
  reserveTtlMs: number;
}): Promise<SelectExecutorResult> {
  const poolOrder = resolveSessionPoolOrder(input.selector);
  let sawExecutorOverCapacity = false;
  let sawNoExecutor = false;

  for (const pool of poolOrder) {
    const selection = await selectExecutorForTool(redis, {
      organizationId: input.organizationId,
      kind: "agent.run",
      selector: {
        ...(input.selector ?? { pool }),
        pool,
      },
      orgMaxInFlight: input.orgMaxInFlight,
      reserveTtlMs: input.reserveTtlMs,
    });
    if (selection.ok) {
      return selection;
    }
    if (selection.error === "ORG_QUOTA_EXCEEDED") {
      return selection;
    }
    if (selection.error === "EXECUTOR_OVER_CAPACITY") {
      sawExecutorOverCapacity = true;
    }
    if (selection.error === "NO_EXECUTOR_AVAILABLE") {
      sawNoExecutor = true;
    }
  }

  if (sawExecutorOverCapacity) {
    return { ok: false, error: "EXECUTOR_OVER_CAPACITY" };
  }
  if (sawNoExecutor) {
    return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
  }
  return { ok: false, error: "NO_EXECUTOR_AVAILABLE" };
}

function normalizeEventLevel(level: unknown): "info" | "warn" | "error" {
  return level === "warn" || level === "error" ? level : "info";
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

  const orgMaxInFlightDefault = Math.max(1, envNumber("GATEWAY_ORG_MAX_INFLIGHT", 50));
  const reserveTtlMs = Math.max(5_000, envNumber("GATEWAY_RESERVE_TTL_MS", 5 * 60 * 1000));
  const orgQuotaCacheTtlMs = Math.max(2_000, envNumber("GATEWAY_ORG_QUOTA_CACHE_TTL_MS", 15_000));
  const orgQuotaCache = new Map<string, { value: number; expiresAtMs: number }>();

  async function getOrgMaxInFlight(organizationId: string): Promise<number> {
    const now = Date.now();
    const cached = orgQuotaCache.get(organizationId);
    if (cached && cached.expiresAtMs > now) {
      return cached.value;
    }

    let resolved = orgMaxInFlightDefault;
    try {
      const orgRow = await withTenantContext(pool, { organizationId }, async (db) =>
        getOrganizationById(db, { organizationId })
      );
      const quotaValue = (orgRow?.settings as any)?.execution?.quotas?.maxExecutorInFlight;
      if (typeof quotaValue === "number" && Number.isFinite(quotaValue) && quotaValue > 0) {
        resolved = Math.max(1, Math.floor(quotaValue));
      }
    } catch {
      // Keep fallback default when org settings cannot be loaded.
    }
    orgQuotaCache.set(organizationId, { value: resolved, expiresAtMs: now + orgQuotaCacheTtlMs });
    return resolved;
  }

  const engineRunnerBaseUrlRaw = process.env.ENGINE_RUNNER_BASE_URL ?? "";
  const engineRunnerBaseUrl = engineRunnerBaseUrlRaw.trim().length > 0 ? engineRunnerBaseUrlRaw.replace(/\/+$/, "") : null;
  const engineRunnerTokenRaw = process.env.ENGINE_RUNNER_TOKEN ?? "";
  const engineRunnerToken = engineRunnerTokenRaw.trim().length > 0 ? engineRunnerTokenRaw : null;
  const engineRunnerTimeoutMs = Math.max(1000, envNumber("ENGINE_RUNNER_TIMEOUT_MS", 30_000));

  const invokeViaEngineRunner = async (
    invokeInput: Omit<LlmInvokeInput, "fetchImpl">
  ): Promise<LlmInvokeResult> => {
    if (!engineRunnerBaseUrl || !engineRunnerToken) {
      return { ok: false, error: "ENGINE_UNAVAILABLE" };
    }
    const timeoutMs = Math.max(1000, Math.min(invokeInput.timeoutMs, engineRunnerTimeoutMs));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${engineRunnerBaseUrl}/internal/v1/llm/infer`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${engineRunnerToken}`,
        },
        body: JSON.stringify({
          provider: invokeInput.provider,
          model: invokeInput.model,
          messages: invokeInput.messages,
          auth: invokeInput.auth,
          timeoutMs,
          maxOutputChars: invokeInput.maxOutputChars,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return { ok: false, error: "ENGINE_UNAVAILABLE" };
      }
      const payload = (await response.json()) as unknown;
      const parsed = z
        .discriminatedUnion("ok", [
          z.object({
            ok: z.literal(true),
            content: z.string(),
            usage: z
              .object({
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
                totalTokens: z.number().int().nonnegative(),
              })
              .optional(),
          }),
          z.object({
            ok: z.literal(false),
            error: z.string().min(1),
          }),
        ])
        .safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: "ENGINE_UNAVAILABLE" };
      }
      if (parsed.data.ok) {
        return {
          ok: true,
          content: parsed.data.content,
          ...(parsed.data.usage ? { usage: parsed.data.usage } : {}),
        };
      }
      return { ok: false, error: parsed.data.error };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: "ENGINE_UNAVAILABLE" };
      }
      return { ok: false, error: "ENGINE_UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }
  };

  const s3Config = readWorkspaceS3ConfigFromEnv();
  const s3Client = s3Config ? createWorkspaceS3Client(s3Config) : null;
  const workspaceUrlExpiresInSec = Math.max(60, envNumber("WORKSPACE_PRESIGN_EXPIRES_SEC", 10 * 60));

  const continuationQueueName = process.env.WORKFLOW_CONTINUATION_QUEUE_NAME ?? "workflow-continuations";
  const continuationQueue =
    process.env.REDIS_URL
      ? new Queue<WorkflowContinuationJobPayload>(continuationQueueName, { connection: parseRedisConnectionOptions(process.env.REDIS_URL) })
      : null;

  async function broadcastToSessionEdges(sessionId: string, event: GatewayBrainSessionEventV2) {
    const edgeIds = await redis.smembers(sessionEdgesKey(sessionId));
    for (const edgeId of edgeIds) {
      await xaddJson(redis, streamToEdge(edgeId), { type: "client_broadcast", sessionId, event });
    }
  }

  async function broadcastRawToSessionEdges(sessionId: string, payload: unknown) {
    const edgeIds = await redis.smembers(sessionEdgesKey(sessionId));
    for (const edgeId of edgeIds) {
      await xaddJson(redis, streamToEdge(edgeId), {
        type: "client_broadcast",
        sessionId,
        event: payload,
      });
    }
  }

  async function invokeToolOnExecutor(inputTool: {
    organizationId: string;
    userId: string;
    selector?: ExecutorSelectorV1 | null;
    kind: GatewayToolKind;
    payload: unknown;
    secret?: string;
    timeoutMs: number;
    networkMode: "none" | "enabled";
    workspaceOwner: { ownerType: "session" | "workflow_run"; ownerId: string };
  }): Promise<{ status: "succeeded" | "failed"; output?: unknown; error?: string; workspace?: any }>{
    const orgMaxInFlight = await getOrgMaxInFlight(inputTool.organizationId);
    const selected = await selectExecutorForTool(redis, {
      organizationId: inputTool.organizationId,
      kind: inputTool.kind,
      selector: inputTool.selector ?? { pool: "managed" },
      orgMaxInFlight,
      reserveTtlMs,
    });
    if (!selected.ok) {
      if (selected.error === "ORG_QUOTA_EXCEEDED") {
        return { status: "failed", error: "ORG_QUOTA_EXCEEDED" };
      }
      if (selected.error === "EXECUTOR_OVER_CAPACITY") {
        return { status: "failed", error: "EXECUTOR_OVER_CAPACITY" };
      }
      return { status: "failed", error: "NO_EXECUTOR_AVAILABLE" };
    }
    const selectedExecutor = selected.selected;

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

      await xaddJson(redis, streamToEdge(selectedExecutor.edgeId), { type: "executor_invoke", executorId: selectedExecutor.executorId, invoke });

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
      await releaseCapacity(redis, { executorId: selectedExecutor.executorId, organizationId: inputTool.organizationId });
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
      const tool = await invokeToolOnExecutor({
        organizationId: dispatch.organizationId,
        userId: dispatch.requestedByUserId,
        selector: (dispatch.executorSelector as ExecutorSelectorV1 | null | undefined) ?? { pool: "managed" },
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
      const llmProvider = cfg?.llm?.provider ?? "openai";
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
          llmInvoke: invokeViaEngineRunner,
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
          selector:
            (block?.executorSelector as ExecutorSelectorV1 | null | undefined) ??
            ((dispatch.executorSelector as ExecutorSelectorV1 | null | undefined) ?? { pool: "managed" }),
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

    let selectedExecutor: SelectedExecutor | null = null;
    try {
      let session = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        getAgentSessionById(db, { organizationId: msg.organizationId, sessionId: msg.sessionId })
      );
      if (!session) {
        return;
      }

      const failSession = async (inputErr: { code: string; message: string }) => {
        const errorEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
          appendAgentSessionEvent(db, {
            organizationId: msg.organizationId,
            sessionId: msg.sessionId,
            eventType: "error",
            level: "error",
            payload: { code: inputErr.code, message: inputErr.message },
          })
        );
        await broadcastToSessionEdges(msg.sessionId, {
          type: "session_event_v2",
          sessionId: msg.sessionId,
          seq: errorEvent.seq,
          eventType: errorEvent.eventType,
          level: normalizeEventLevel(errorEvent.level),
          payload: errorEvent.payload ?? null,
          createdAt: errorEvent.createdAt.toISOString(),
        });
        await broadcastRawToSessionEdges(msg.sessionId, {
          type: "session_error",
          sessionId: msg.sessionId,
          code: inputErr.code,
          message: inputErr.message,
        });
      };

      const selectorRaw =
        (session as any).executorSelector && typeof (session as any).executorSelector === "object"
          ? ((session as any).executorSelector as Record<string, unknown>)
          : null;
      const selectorPoolRaw = selectorRaw?.pool;
      const selectorPool = selectorPoolRaw === "managed" || selectorPoolRaw === "byon" ? selectorPoolRaw : null;
      const selector: ExecutorSelectorV1 | null = selectorPool
        ? ({
            pool: selectorPool,
            ...(Array.isArray(selectorRaw?.labels)
              ? { labels: selectorRaw.labels.filter((label): label is string => typeof label === "string") }
              : {}),
            ...(typeof selectorRaw?.group === "string" ? { group: selectorRaw.group } : {}),
            ...(typeof selectorRaw?.tag === "string" ? { tag: selectorRaw.tag } : {}),
            ...(typeof selectorRaw?.executorId === "string" ? { executorId: selectorRaw.executorId } : {}),
          } as ExecutorSelectorV1)
        : null;

      const limitsRaw = session.limits;
      const limits = typeof limitsRaw === "object" && limitsRaw && !Array.isArray(limitsRaw) ? (limitsRaw as any) : {};
      const timeoutMs = typeof limits.timeoutMs === "number" ? limits.timeoutMs : 60_000;
      const orgMaxInFlight = await getOrgMaxInFlight(msg.organizationId);

      const existingPinnedExecutorId =
        typeof (session as any).pinnedExecutorId === "string" && (session as any).pinnedExecutorId.length > 0
          ? ((session as any).pinnedExecutorId as string)
          : (session.pinnedAgentId ?? null);
      const pinnedPoolRaw = (session as any).pinnedExecutorPool;
      const existingPinnedExecutorPool: "managed" | "byon" | null =
        pinnedPoolRaw === "managed" || pinnedPoolRaw === "byon" ? pinnedPoolRaw : existingPinnedExecutorId ? "byon" : null;
      const priorPinned =
        existingPinnedExecutorId && existingPinnedExecutorPool
          ? { executorId: existingPinnedExecutorId, pool: existingPinnedExecutorPool }
          : null;

      if (priorPinned) {
        const pinnedSelection = await selectExecutorForTool(redis, {
          organizationId: msg.organizationId,
          kind: "agent.run",
          selector: {
            pool: priorPinned.pool,
            executorId: priorPinned.executorId,
          },
          orgMaxInFlight,
          reserveTtlMs,
        });
        if (pinnedSelection.ok) {
          selectedExecutor = pinnedSelection.selected;
        } else if (pinnedSelection.error === "ORG_QUOTA_EXCEEDED") {
          await failSession({
            code: "ORG_QUOTA_EXCEEDED",
            message: "Organization concurrent execution quota exceeded.",
          });
          return;
        }
      }

      if (!selectedExecutor) {
        const selected = await selectSessionExecutor(redis, {
          organizationId: msg.organizationId,
          selector,
          orgMaxInFlight,
          reserveTtlMs,
        });
        if (!selected.ok) {
          if (selected.error === "ORG_QUOTA_EXCEEDED") {
            await failSession({
              code: "ORG_QUOTA_EXCEEDED",
              message: "Organization concurrent execution quota exceeded.",
            });
            return;
          }
          if (selected.error === "EXECUTOR_OVER_CAPACITY") {
            await failSession({
              code: "EXECUTOR_OVER_CAPACITY",
              message: "No available capacity on executor pool.",
            });
            return;
          }
          await failSession({
            code: REMOTE_EXEC_ERROR.NoAgentAvailable,
            message: "No node-host is currently available for this session.",
          });
          return;
        }
        selectedExecutor = selected.selected;
      }
      if (!selectedExecutor) {
        await failSession({
          code: REMOTE_EXEC_ERROR.NoAgentAvailable,
          message: "No node-host is currently available for this session.",
        });
        return;
      }
      const executor = selectedExecutor;

      const pinnedChanged = Boolean(
        priorPinned?.executorId !== executor.executorId || priorPinned?.pool !== executor.pool
      );
      const shouldPersistPin = Boolean(
        (session as any).pinnedExecutorId !== executor.executorId ||
          (session as any).pinnedExecutorPool !== executor.pool ||
          session.pinnedAgentId !== executor.executorId
      );
      if (shouldPersistPin) {
        const updated = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
          setAgentSessionPinnedAgent(db, {
            organizationId: msg.organizationId,
            sessionId: msg.sessionId,
            pinnedAgentId: executor.executorId,
            pinnedExecutorId: executor.executorId,
            pinnedExecutorPool: executor.pool,
          })
        );
        if (updated) {
          session = updated;
        }
        await broadcastRawToSessionEdges(msg.sessionId, {
          type: "session_state",
          sessionId: msg.sessionId,
          pinnedExecutorId: executor.executorId,
          pinnedExecutorPool: executor.pool,
          pinnedAgentId: executor.executorId,
          routedAgentId: (session as any).routedAgentId ?? null,
          scope: (session as any).scope ?? "main",
          executionMode: "pinned-node-host",
        });
      }

      if (priorPinned && pinnedChanged) {
        const failoverEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
          appendAgentSessionEvent(db, {
            organizationId: msg.organizationId,
            sessionId: msg.sessionId,
            eventType: "system",
            level: "warn",
            payload: {
              action: "session_executor_failover",
              from: {
                executorId: priorPinned.executorId,
                pool: priorPinned.pool,
              },
              to: {
                executorId: executor.executorId,
                pool: executor.pool,
              },
            },
          })
        );
        await broadcastToSessionEdges(msg.sessionId, {
          type: "session_event_v2",
          sessionId: msg.sessionId,
          seq: failoverEvent.seq,
          eventType: failoverEvent.eventType,
          level: normalizeEventLevel(failoverEvent.level),
          payload: failoverEvent.payload ?? null,
          createdAt: failoverEvent.createdAt.toISOString(),
        });
      }

      const sessionKey =
        typeof (session as any).sessionKey === "string" && (session as any).sessionKey.length > 0
          ? ((session as any).sessionKey as string)
          : `session:${msg.sessionId}`;
      const routedAgentId =
        typeof (session as any).routedAgentId === "string" && (session as any).routedAgentId.length > 0
          ? ((session as any).routedAgentId as string)
          : selectedExecutor.executorId;
      if (!routedAgentId) {
        await failSession({
          code: REMOTE_EXEC_ERROR.NoAgentAvailable,
          message: "No routed agent was resolved for this session.",
        });
        return;
      }
      const sessionEngineId = typeof (session as any).engineId === "string" ? ((session as any).engineId as string) : "gateway.loop.v2";
      if (sessionEngineId !== "gateway.loop.v2") {
        await failSession({
          code: REMOTE_EXEC_ERROR.NodeExecutionFailed,
          message: `UNSUPPORTED_SESSION_ENGINE:${sessionEngineId}`,
        });
        return;
      }

      const providerRaw = typeof (session as any).llmProvider === "string" ? (session as any).llmProvider : "openai";
      const llmProvider = providerRaw === "anthropic" || providerRaw === "gemini" || providerRaw === "vertex" ? providerRaw : "openai";
      let llmAuthMode: "env" | "inline_api_key" | "inline_vertex_oauth" = "env";
      let llmAuth:
        | {
            kind: "api_key";
            apiKey: string;
          }
        | {
            kind: "vertex_oauth";
            refreshToken: string;
            projectId: string;
            location: string;
          }
        | undefined;

      if (selectedExecutor.pool === "managed") {
        const llmSecretId = typeof (session as any).llmSecretId === "string" ? ((session as any).llmSecretId as string) : null;
        if (llmSecretId) {
          const secretValue = (await loadSecretValueFromDb({
            pool,
            organizationId: msg.organizationId,
            userId: msg.userId,
            secretId: llmSecretId,
          })).trim();
          if (secretValue.length > 0) {
            if (llmProvider === "vertex") {
              try {
                const parsed = JSON.parse(secretValue) as Record<string, unknown>;
                if (
                  typeof parsed.refreshToken === "string" &&
                  typeof parsed.projectId === "string" &&
                  typeof parsed.location === "string"
                ) {
                  llmAuthMode = "inline_vertex_oauth";
                  llmAuth = {
                    kind: "vertex_oauth",
                    refreshToken: parsed.refreshToken,
                    projectId: parsed.projectId,
                    location: parsed.location,
                  };
                }
              } catch {
                // Keep env mode when secret shape is not vertex oauth payload.
              }
            } else {
              llmAuthMode = "inline_api_key";
              llmAuth = {
                kind: "api_key",
                apiKey: secretValue,
              };
            }
          }
        }
      }

      const toolsAllowRaw = Array.isArray((session as any).toolsAllow) ? ((session as any).toolsAllow as string[]) : [];
      const managedSafeTools = new Set(["memory.search", "memory.get", "memory_search", "memory_get"]);
      const toolsAllow =
        selectedExecutor.pool === "managed"
          ? toolsAllowRaw.filter((toolId) => managedSafeTools.has(toolId))
          : toolsAllowRaw;
      const memoryProviderRaw = limits.memoryProvider;
      const memoryProvider = memoryProviderRaw === "qmd" ? "qmd" : "builtin";
      const sessionLimits = {
        maxTurns: typeof limits.maxTurns === "number" ? Math.max(1, Math.floor(limits.maxTurns)) : 8,
        maxToolCalls: typeof limits.maxToolCalls === "number" ? Math.max(0, Math.floor(limits.maxToolCalls)) : 20,
        timeoutMs,
        maxOutputChars: typeof limits.maxOutputChars === "number" ? Math.max(256, Math.floor(limits.maxOutputChars)) : 100_000,
        maxRuntimeChars: typeof limits.maxRuntimeChars === "number" ? Math.max(10_000, Math.floor(limits.maxRuntimeChars)) : 300_000,
      };

      const openRequestId = `${msg.requestId}:open`;
      await xaddJson(redis, streamToEdge(selectedExecutor.edgeId), {
        type: "executor_session",
        executorId: selectedExecutor.executorId,
        payload: {
          type: "session_open",
          requestId: openRequestId,
          organizationId: msg.organizationId,
          sessionId: msg.sessionId,
          sessionKey,
          routedAgentId,
          userId: msg.userId,
          sessionConfig: {
            engineId: sessionEngineId,
            llm: {
              provider: llmProvider,
              model: typeof (session as any).llmModel === "string" ? (session as any).llmModel : "gpt-4.1-mini",
              authMode: selectedExecutor.pool === "managed" ? llmAuthMode : "env",
              ...(selectedExecutor.pool === "managed" && llmAuth ? { auth: llmAuth } : {}),
            },
            prompt: {
              ...(typeof (session as any).promptSystem === "string" ? { system: (session as any).promptSystem } : {}),
              instructions:
                typeof (session as any).promptInstructions === "string"
                  ? (session as any).promptInstructions
                  : "Help me accomplish my task safely and efficiently.",
            },
            toolsAllow,
            limits: sessionLimits,
            memoryProvider,
          },
        },
      });

      const opened = await waitForJsonReply<{ status: "ok" | "failed"; error?: string }>(redis, openRequestId, Math.min(timeoutMs, 10_000));
      if (!opened || opened.status !== "ok") {
        await failSession({
          code: selectedExecutor.pool === "byon" ? REMOTE_EXEC_ERROR.PinnedAgentOffline : REMOTE_EXEC_ERROR.NoAgentAvailable,
          message: opened?.error ?? "Node-host could not open the session.",
        });
        return;
      }

      await xaddJson(redis, streamToEdge(selectedExecutor.edgeId), {
        type: "executor_session",
        executorId: selectedExecutor.executorId,
        payload: {
          type: "session_turn",
          requestId: msg.requestId,
          organizationId: msg.organizationId,
          sessionId: msg.sessionId,
          sessionKey,
          userId: msg.userId,
          eventSeq: msg.userEventSeq,
          message: msg.message ?? "",
          ...(msg.attachments ? { attachments: msg.attachments } : {}),
        },
      });

      const turnReply = await waitForJsonReply<{ status: "succeeded" | "failed"; content?: string; payload?: unknown; error?: string; code?: string }>(
        redis,
        msg.requestId,
        timeoutMs
      );
      if (!turnReply) {
        await failSession({
          code: REMOTE_EXEC_ERROR.NodeExecutionTimeout,
          message: "Pinned node-host did not reply in time.",
        });
        return;
      }
      if (turnReply.status === "failed") {
        await failSession({
          code: turnReply.code ?? turnReply.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed,
          message: turnReply.error ?? "Agent turn failed on pinned node-host.",
        });
        return;
      }

      const out = turnReply.payload ?? turnReply.content ?? null;
      const outText =
        typeof turnReply.content === "string"
          ? turnReply.content
          : typeof out === "string"
            ? out
            : safeJsonStringify(out);

      const agentDeltaEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        appendAgentSessionEvent(db, {
          organizationId: msg.organizationId,
          sessionId: msg.sessionId,
          eventType: "agent_message",
          level: "info",
          payload: { message: outText, delta: true },
        })
      );
      const agentFinalEvent = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
        appendAgentSessionEvent(db, {
          organizationId: msg.organizationId,
          sessionId: msg.sessionId,
          eventType: "agent_final",
          level: "info",
          payload: { message: outText, output: out },
        })
      );
      await broadcastToSessionEdges(msg.sessionId, {
        type: "session_event_v2",
        sessionId: msg.sessionId,
        seq: agentDeltaEvent.seq,
        eventType: agentDeltaEvent.eventType,
        level: normalizeEventLevel(agentDeltaEvent.level),
        payload: agentDeltaEvent.payload ?? null,
        createdAt: agentDeltaEvent.createdAt.toISOString(),
      });
      await broadcastToSessionEdges(msg.sessionId, {
        type: "session_event_v2",
        sessionId: msg.sessionId,
        seq: agentFinalEvent.seq,
        eventType: agentFinalEvent.eventType,
        level: normalizeEventLevel(agentFinalEvent.level),
        payload: agentFinalEvent.payload ?? null,
        createdAt: agentFinalEvent.createdAt.toISOString(),
      });
      await broadcastRawToSessionEdges(msg.sessionId, {
        type: "agent_delta",
        sessionId: msg.sessionId,
        seq: agentDeltaEvent.seq,
        content: outText,
        createdAt: agentDeltaEvent.createdAt.toISOString(),
      });
      await broadcastRawToSessionEdges(msg.sessionId, {
        type: "agent_final",
        sessionId: msg.sessionId,
        seq: agentFinalEvent.seq,
        content: outText,
        payload: out,
        createdAt: agentFinalEvent.createdAt.toISOString(),
      });

      if (msg.source && msg.originEdgeId && outText.length > 0) {
        await xaddJson(redis, streamToEdge(msg.originEdgeId), {
          type: "channel_outbound",
          organizationId: msg.organizationId,
          sessionId: msg.sessionId,
          sessionEventSeq: agentFinalEvent.seq,
          source: msg.source,
          text: outText,
        });
      }
    } finally {
      if (selectedExecutor) {
        await releaseCapacity(redis, { executorId: selectedExecutor.executorId, organizationId: msg.organizationId });
      }
      try {
        await redis.del(lockKey);
      } catch {
        // ignore
      }
    }
  }

  async function handleSessionReset(msg: Extract<EdgeToBrainRequest, { type: "session_reset" }>) {
    const updated = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
      setAgentSessionPinnedAgent(db, {
        organizationId: msg.organizationId,
        sessionId: msg.sessionId,
        pinnedAgentId: null,
        pinnedExecutorId: null,
        pinnedExecutorPool: null,
      })
    );
    if (!updated) {
      return;
    }
    const event = await withTenantContext(pool, { organizationId: msg.organizationId }, async (db) =>
      appendAgentSessionEvent(db, {
        organizationId: msg.organizationId,
        sessionId: msg.sessionId,
        eventType: "system",
        level: "info",
        payload: { action: "session_reset_agent", mode: msg.mode },
      })
    );
    await broadcastToSessionEdges(msg.sessionId, {
      type: "session_event_v2",
      sessionId: msg.sessionId,
      seq: event.seq,
      eventType: event.eventType,
      level: normalizeEventLevel(event.level),
      payload: event.payload ?? null,
      createdAt: event.createdAt.toISOString(),
    });
    await broadcastRawToSessionEdges(msg.sessionId, {
      type: "session_state",
      sessionId: msg.sessionId,
      pinnedExecutorId: null,
      pinnedExecutorPool: null,
      pinnedAgentId: null,
      routedAgentId: (updated as any).routedAgentId ?? null,
      scope: (updated as any).scope ?? "main",
      executionMode: "pinned-node-host",
    });
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
          } else if (msg.type === "session_reset") {
            await handleSessionReset(msg);
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
