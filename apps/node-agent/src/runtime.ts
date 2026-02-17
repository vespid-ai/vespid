import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import { createMemoryManager, runAgentLoop, runLlmInference } from "@vespid/agent-runtime";
import type { LlmInvokeInput } from "@vespid/agent-runtime";
import type {
  GatewayInvokeToolV2,
  GatewayMemoryQueryV2,
  GatewayMemorySyncV2,
  MemoryProvider,
  GatewaySessionOpenV2,
  GatewaySessionTurnV2,
  GatewayToolResultV2,
  WorkflowNodeExecutorResult,
  ToolPolicyV1,
} from "@vespid/shared";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";
import { resolveSandboxBackend, type SandboxBackend } from "./sandbox/index.js";
import { ensureWorkspaceExtracted, snapshotAndUploadWorkspace, verifyWorkspaceDependencies } from "./workspaces/snapshot-cache.js";

export type NodeAgentConfig = {
  pool?: "managed" | "byon";
  // v2 names
  executorId?: string;
  executorToken?: string;
  executorName?: string;
  executorVersion?: string;
  // legacy names (auto-upgraded in memory)
  agentId?: string;
  agentToken?: string;
  name?: string;
  agentVersion?: string;

  organizationId?: string;
  gatewayWsUrl: string;
  apiBaseUrl: string;
  capabilities: Record<string, unknown>;
};

export type StartedNodeAgent = {
  close: () => Promise<void>;
  ready: Promise<void>;
};

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonLog(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify(payload);
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
    return;
  }
  if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.info(line);
}

async function loadTlsCaFromEnv(gatewayWsUrl: string): Promise<Buffer | null> {
  const caFile = process.env.VESPID_AGENT_TLS_CA_FILE;
  if (!caFile || caFile.trim().length === 0) {
    return null;
  }
  if (!gatewayWsUrl.startsWith("wss://")) {
    return null;
  }
  try {
    return await fs.readFile(caFile);
  } catch {
    throw new Error("VESPID_AGENT_TLS_CA_FILE_INVALID");
  }
}

const invokeToolSchema = z.object({
  type: z.literal("invoke_tool_v2"),
  requestId: z.string().min(1),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(["connector.action", "agent.execute"]),
  payload: z.unknown(),
  secret: z.string().min(1).optional(),
  toolPolicy: z.object({
    networkModeDefaultDeny: z.boolean(),
    networkMode: z.enum(["none", "enabled"]),
    timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000),
    outputMaxChars: z.number().int().min(256).max(1_000_000),
    mountsAllowlist: z.array(z.object({ containerPath: z.string().min(1), mode: z.enum(["ro", "rw"]) })),
  }),
  workspace: z.object({
    workspaceId: z.string().uuid(),
    version: z.number().int().min(0),
    objectKey: z.string(),
    etag: z.string().optional().nullable(),
  }),
  workspaceAccess: z.object({
    downloadUrl: z.string().url().optional().nullable(),
    upload: z.object({
      url: z.string().url(),
      objectKey: z.string().min(1),
      version: z.number().int().min(1),
    }),
  }),
  idempotencyKey: z.string().min(1).optional(),
});

const sessionOpenSchema = z.object({
  type: z.literal("session_open"),
  requestId: z.string().min(1),
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionKey: z.string().min(1),
  routedAgentId: z.string().min(1),
  userId: z.string().uuid(),
  sessionConfig: z.object({
    engineId: z.string().min(1),
    llm: z.object({
      provider: z.enum(["openai", "anthropic", "gemini", "vertex"]),
      model: z.string().min(1),
      authMode: z.enum(["env", "inline_api_key", "inline_vertex_oauth"]),
      auth: z
        .discriminatedUnion("kind", [
          z.object({
            kind: z.literal("api_key"),
            apiKey: z.string().min(1),
          }),
          z.object({
            kind: z.literal("vertex_oauth"),
            refreshToken: z.string().min(1),
            projectId: z.string().min(1),
            location: z.string().min(1),
          }),
        ])
        .optional(),
    }),
    prompt: z.object({
      system: z.string().optional().nullable(),
      instructions: z.string().min(1),
    }),
    toolsAllow: z.array(z.string().min(1)).max(200),
    limits: z.object({
      maxTurns: z.number().int().min(1).max(200),
      maxToolCalls: z.number().int().min(0).max(1000),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000),
      maxOutputChars: z.number().int().min(256).max(2_000_000),
      maxRuntimeChars: z.number().int().min(10_000).max(5_000_000),
    }),
    memoryProvider: z.enum(["builtin", "qmd"]),
  }),
});

const sessionTurnSchema = z.object({
  type: z.literal("session_turn"),
  requestId: z.string().min(1),
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionKey: z.string().min(1),
  userId: z.string().uuid(),
  eventSeq: z.number().int().min(0),
  message: z.string().min(1),
  attachments: z.array(z.unknown()).optional(),
});

const memorySyncSchema = z.object({
  type: z.literal("memory_sync"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  provider: z.enum(["builtin", "qmd"]),
  workspaceDir: z.string().min(1),
});

const memoryQuerySchema = z.object({
  type: z.literal("memory_query"),
  requestId: z.string().min(1),
  sessionId: z.string().uuid(),
  provider: z.enum(["builtin", "qmd"]),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

function normalizeWorkspacePointer(pointer: z.infer<typeof invokeToolSchema>["workspace"]) {
  return {
    workspaceId: pointer.workspaceId,
    version: pointer.version,
    objectKey: pointer.objectKey,
    ...(pointer.etag !== undefined ? { etag: pointer.etag } : {}),
  };
}

function normalizeWorkspaceAccess(access: z.infer<typeof invokeToolSchema>["workspaceAccess"]) {
  return {
    ...(access.downloadUrl !== undefined ? { downloadUrl: access.downloadUrl } : {}),
    upload: access.upload,
  };
}

const agentExecutePayloadSchema = z
  .object({
    nodeId: z.string().min(1),
    node: z
      .object({
        id: z.string().min(1),
        type: z.literal("agent.execute"),
        config: z
          .object({
            task: z
              .object({
                type: z.literal("shell"),
                script: z.string().min(1),
                shell: z.enum(["sh", "bash"]).optional(),
                env: z.record(z.string(), z.string()).optional(),
              })
              .optional(),
            sandbox: z
              .object({
                backend: z.enum(["docker", "host", "provider"]).optional(),
                network: z.enum(["none", "enabled"]).optional(),
                timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
                docker: z.object({ image: z.string().min(1).optional() }).optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    runId: z.string().uuid().optional(),
    workflowId: z.string().uuid().optional(),
    attemptCount: z.number().int().min(1).optional(),
  })
  .passthrough();

const connectorPayloadSchema = z.object({
  connectorId: z.string().min(1),
  actionId: z.string().min(1),
  input: z.unknown().optional(),
  env: z.object({ githubApiBaseUrl: z.string().url() }).optional(),
});

function safeSend(ws: WebSocket | null, message: unknown): boolean {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function normalizeConfig(config: NodeAgentConfig): {
  pool: "managed" | "byon";
  executorId: string;
  executorToken: string;
  organizationId: string | null;
  gatewayWsUrl: string;
  apiBaseUrl: string;
  executorName: string;
  executorVersion: string;
  capabilities: Record<string, unknown>;
} {
  const executorId = config.executorId ?? config.agentId ?? "";
  const executorToken = config.executorToken ?? config.agentToken ?? "";
  const executorName = config.executorName ?? config.name ?? "executor";
  const executorVersion = config.executorVersion ?? config.agentVersion ?? "0.0.0";
  const pool = config.pool ?? "byon";
  const organizationId = typeof config.organizationId === "string" && config.organizationId.trim().length > 0 ? config.organizationId : null;
  if (!executorId || !executorToken) {
    throw new Error("EXECUTOR_CONFIG_INVALID");
  }
  if (pool === "byon" && !organizationId) {
    throw new Error("EXECUTOR_CONFIG_INVALID");
  }
  return {
    pool,
    executorId,
    executorToken,
    organizationId,
    gatewayWsUrl: config.gatewayWsUrl,
    apiBaseUrl: config.apiBaseUrl,
    executorName,
    executorVersion,
    capabilities: config.capabilities ?? {},
  };
}

type SessionContext = {
  opened: z.infer<typeof sessionOpenSchema>;
  memory: ReturnType<typeof createMemoryManager>;
  runtime: WorkflowNodeExecutorResult["runtime"];
  workspaceDir: string;
};

function normalizePathPart(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-z0-9._-]+/g, "-");
}

function toTextOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function buildSessionRuntimeManager(input: {
  pool: "managed" | "byon";
}): Promise<{
  openSession: (open: z.infer<typeof sessionOpenSchema>) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  runTurn: (turn: z.infer<typeof sessionTurnSchema>) => Promise<
    | { ok: true; content: string; payload?: unknown }
    | { ok: false; code: string; message: string }
  >;
  syncMemory: (sync: z.infer<typeof memorySyncSchema>) => Promise<{ ok: true; details: unknown } | { ok: false; error: string }>;
  queryMemory: (query: z.infer<typeof memoryQuerySchema>) => Promise<{ ok: true; results: unknown[] } | { ok: false; error: string }>;
}> {
  const sessions = new Map<string, SessionContext>();
  const memoryRoot = process.env.SESSION_MEMORY_ROOT ?? "/tmp/vespid-memory";
  const managedSafeTools = new Set(["memory.search", "memory.get", "memory_search", "memory_get"]);

  async function openSession(open: z.infer<typeof sessionOpenSchema>) {
    const workspaceDir = path.join(
      memoryRoot,
      normalizePathPart(open.organizationId),
      normalizePathPart(open.sessionKey)
    );
    await fs.mkdir(workspaceDir, { recursive: true });
    const memory = createMemoryManager({
      provider: open.sessionConfig.memoryProvider,
      workspaceDir,
    });
    sessions.set(open.sessionId, {
      opened: open,
      memory,
      runtime: {},
      workspaceDir,
    });
    return { ok: true } as const;
  }

  async function runTurn(turn: z.infer<typeof sessionTurnSchema>) {
    const ctx = sessions.get(turn.sessionId) ?? null;
    if (!ctx) {
      return { ok: false as const, code: "SESSION_NOT_OPEN", message: "Session has not been opened on this executor." };
    }

    if (input.pool === "managed") {
      const disallowed = ctx.opened.sessionConfig.toolsAllow.filter((toolId) => !managedSafeTools.has(toolId));
      if (disallowed.length > 0) {
        return {
          ok: false as const,
          code: "MANAGED_TOOL_NOT_ALLOWED",
          message: `Managed pool only allows memory tools in v1: ${disallowed.join(", ")}`,
        };
      }
    }

    let llmAuthOverride:
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
      | null = null;
    if (ctx.opened.sessionConfig.llm.authMode === "inline_api_key" && ctx.opened.sessionConfig.llm.auth?.kind === "api_key") {
      llmAuthOverride = {
        kind: "api_key",
        apiKey: ctx.opened.sessionConfig.llm.auth.apiKey,
      };
    } else if (
      ctx.opened.sessionConfig.llm.authMode === "inline_vertex_oauth" &&
      ctx.opened.sessionConfig.llm.auth?.kind === "vertex_oauth"
    ) {
      llmAuthOverride = {
        kind: "vertex_oauth",
        refreshToken: ctx.opened.sessionConfig.llm.auth.refreshToken,
        projectId: ctx.opened.sessionConfig.llm.auth.projectId,
        location: ctx.opened.sessionConfig.llm.auth.location,
      };
    }

    let llmResponsePreview = "";
    const result = await runAgentLoop({
      organizationId: turn.organizationId,
      workflowId: `session:${turn.sessionId}`,
      runId: turn.sessionId,
      attemptCount: 1,
      requestedByUserId: turn.userId,
      nodeId: `session:${turn.sessionId}`,
      nodeType: "agent.run.session",
      runInput: {
        message: turn.message,
        attachments: turn.attachments ?? [],
      },
      steps: [],
      organizationSettings: {},
      runtime: ctx.runtime,
      pendingRemoteResult: null,
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue: async () => "",
      fetchImpl: fetch,
      llmInvoke: async (invokeInput: Omit<LlmInvokeInput, "fetchImpl">) =>
        await runLlmInference({
          ...invokeInput,
          fetchImpl: fetch,
        }),
      llmAuthOverride,
      config: {
        llm: {
          provider: ctx.opened.sessionConfig.llm.provider,
          model: ctx.opened.sessionConfig.llm.model,
          auth: { fallbackToEnv: true },
        },
        prompt: {
          ...(ctx.opened.sessionConfig.prompt.system ? { system: ctx.opened.sessionConfig.prompt.system } : {}),
          instructions: ctx.opened.sessionConfig.prompt.instructions,
        },
        tools: {
          allow: ctx.opened.sessionConfig.toolsAllow,
          execution: "cloud",
        },
        limits: {
          maxTurns: ctx.opened.sessionConfig.limits.maxTurns,
          maxToolCalls: ctx.opened.sessionConfig.limits.maxToolCalls,
          timeoutMs: ctx.opened.sessionConfig.limits.timeoutMs,
          maxOutputChars: ctx.opened.sessionConfig.limits.maxOutputChars,
          maxRuntimeChars: ctx.opened.sessionConfig.limits.maxRuntimeChars,
        },
        output: { mode: "text" },
      },
      allowRemoteBlocked: false,
      persistNodeId: `session:${turn.sessionId}`,
      memory: {
        sync: async () => {
          await ctx.memory.sync();
        },
        search: async (params: { query: string; maxResults?: number }) => await ctx.memory.search(params),
        get: async (params: { filePath: string; fromLine?: number; lineCount?: number }) => await ctx.memory.get(params),
        status: () => ctx.memory.status(),
      },
      emitEvent: async (event: { eventType: string; level: "info" | "warn" | "error"; message?: string | null; payload?: unknown }) => {
        if (event.eventType === "agent_llm_response") {
          const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : null;
          const content = payload && typeof payload.content === "string" ? payload.content : "";
          if (content.length > 0) {
            llmResponsePreview = content;
          }
        }
      },
    });
    ctx.runtime = result.runtime ?? ctx.runtime;

    if (result.status === "blocked") {
      return { ok: false as const, code: "NODE_EXECUTION_BLOCKED", message: "Blocked tool execution is disabled for interactive turns." };
    }
    if (result.status === "failed") {
      return { ok: false as const, code: result.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed, message: result.error ?? "Turn failed." };
    }

    const payload = result.output ?? null;
    const content = toTextOutput(payload);
    return { ok: true as const, content: content.length > 0 ? content : llmResponsePreview || "ok", ...(payload !== null ? { payload } : {}) };
  }

  async function syncMemory(sync: z.infer<typeof memorySyncSchema>) {
    const ctx = sessions.get(sync.sessionId) ?? null;
    const manager = ctx?.memory ?? createMemoryManager({ provider: sync.provider as MemoryProvider, workspaceDir: sync.workspaceDir });
    try {
      await manager.sync();
      return {
        ok: true as const,
        details: {
          provider: manager.status().provider,
          fallbackFrom: manager.status().fallbackFrom ?? null,
          workspaceDir: ctx?.workspaceDir ?? sync.workspaceDir,
        },
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "MEMORY_SYNC_FAILED" };
    }
  }

  async function queryMemory(query: z.infer<typeof memoryQuerySchema>) {
    const ctx = sessions.get(query.sessionId) ?? null;
    const manager =
      ctx?.memory ??
      createMemoryManager({
        provider: query.provider as MemoryProvider,
        workspaceDir: path.join(memoryRoot, "ephemeral", normalizePathPart(query.sessionId)),
      });
    try {
      const results = await manager.search({
        query: query.query,
        ...(typeof query.limit === "number" ? { maxResults: query.limit } : {}),
      });
      return { ok: true as const, results };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "MEMORY_QUERY_FAILED" };
    }
  }

  return {
    openSession,
    runTurn,
    syncMemory,
    queryMemory,
  };
}

async function executeTool(input: {
  incoming: z.infer<typeof invokeToolSchema>;
  sandbox: SandboxBackend;
}): Promise<GatewayToolResultV2> {
  const { incoming, sandbox } = input;
  const policy: ToolPolicyV1 | undefined = incoming.toolPolicy as any;
  if (!policy) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "TOOL_POLICY_REQUIRED" };
  }

  if (incoming.kind === "agent.execute" && incoming.secret) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "SECRET_NOT_ALLOWED_FOR_SHELL" };
  }

  const workspace = await ensureWorkspaceExtracted({
    pointer: normalizeWorkspacePointer(incoming.workspace),
    access: normalizeWorkspaceAccess(incoming.workspaceAccess),
  });

  if (incoming.kind === "agent.execute") {
    const parsed = agentExecutePayloadSchema.safeParse(incoming.payload);
    if (!parsed.success) {
      return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "INVALID_EXECUTE_PAYLOAD" };
    }

    const node = parsed.data.node;
    const task = node?.config?.task;
    if (!task) {
      // Keep backward compatible behavior for missing task payloads.
      return {
        type: "tool_result_v2",
        requestId: incoming.requestId,
        status: "succeeded",
        output: { accepted: true },
        workspace: await snapshotAndUploadWorkspace({
          pointer: normalizeWorkspacePointer(incoming.workspace),
          access: normalizeWorkspaceAccess(incoming.workspaceAccess),
          workdir: workspace.workdir,
        }),
      };
    }

    const sandboxCfg = node?.config?.sandbox;
    const networkMode = policy.networkMode === "enabled" ? "enabled" : "none";
    const exec = await sandbox.executeShellTask({
      requestId: incoming.requestId,
      organizationId: incoming.organizationId,
      userId: incoming.userId,
      runId: parsed.data.runId ?? null,
      workflowId: parsed.data.workflowId ?? null,
      nodeId: parsed.data.nodeId,
      attemptCount: parsed.data.attemptCount ?? null,
      script: task.script,
      shell: task.shell ?? "sh",
      taskEnv: task.env ?? {},
      ...(sandboxCfg?.backend ? { backend: sandboxCfg.backend } : {}),
      networkMode,
      timeoutMs: policy.timeoutMs ?? sandboxCfg?.timeoutMs ?? null,
      dockerImage: sandboxCfg?.docker?.image ?? null,
      // SaaS default: never pass host env into shell execution.
      envPassthroughAllowlist: [],
      workdirHostPath: workspace.workdir,
    });

    let nextWorkspace;
    try {
      nextWorkspace = await snapshotAndUploadWorkspace({
        pointer: normalizeWorkspacePointer(incoming.workspace),
        access: normalizeWorkspaceAccess(incoming.workspaceAccess),
        workdir: workspace.workdir,
      });
    } catch (error) {
      return {
        type: "tool_result_v2",
        requestId: incoming.requestId,
        status: "failed",
        error: error instanceof Error ? error.message : "WORKSPACE_UPLOAD_FAILED",
      };
    }

    if (exec.status === "succeeded") {
      return {
        type: "tool_result_v2",
        requestId: incoming.requestId,
        status: "succeeded",
        output: exec.output,
        workspace: nextWorkspace,
      };
    }
    return {
      type: "tool_result_v2",
      requestId: incoming.requestId,
      status: "failed",
      error: exec.error,
      ...(exec.output !== undefined ? { output: exec.output } : {}),
      workspace: nextWorkspace,
    };
  }

  const actionParsed = connectorPayloadSchema.safeParse(incoming.payload);
  if (!actionParsed.success) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "INVALID_ACTION_PAYLOAD" };
  }

  const action = getCommunityConnectorAction({
    connectorId: actionParsed.data.connectorId as ConnectorId,
    actionId: actionParsed.data.actionId,
  });
  if (!action) {
    return {
      type: "tool_result_v2",
      requestId: incoming.requestId,
      status: "failed",
      error: `ACTION_NOT_SUPPORTED:${actionParsed.data.connectorId}:${actionParsed.data.actionId}`,
    };
  }

  const inputParsed = action.inputSchema.safeParse(actionParsed.data.input);
  if (!inputParsed.success) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "INVALID_ACTION_INPUT" };
  }

  const secret = action.requiresSecret ? incoming.secret ?? null : null;
  if (action.requiresSecret && !secret) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "SECRET_REQUIRED" };
  }

  const result = await action.execute({
    organizationId: incoming.organizationId,
    userId: incoming.userId,
    connectorId: actionParsed.data.connectorId as ConnectorId,
    actionId: actionParsed.data.actionId,
    input: inputParsed.data,
    secret,
    env: {
      githubApiBaseUrl: actionParsed.data.env?.githubApiBaseUrl ?? "https://api.github.com",
    },
    fetchImpl: fetch,
  });

  const nextWorkspace = await snapshotAndUploadWorkspace({
    pointer: normalizeWorkspacePointer(incoming.workspace),
    access: normalizeWorkspaceAccess(incoming.workspaceAccess),
    workdir: workspace.workdir,
  });

  return {
    type: "tool_result_v2",
    requestId: incoming.requestId,
    status: result.status,
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.status === "failed" ? { error: result.error } : {}),
    workspace: nextWorkspace,
  };
}

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** Math.min(10, attempt));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

export async function startNodeAgent(config: NodeAgentConfig): Promise<StartedNodeAgent> {
  verifyWorkspaceDependencies();
  const normalized = normalizeConfig(config);
  const execBackend = (process.env.VESPID_AGENT_EXEC_BACKEND ?? "host").trim().toLowerCase();
  if (normalized.pool === "managed" && execBackend !== "docker" && execBackend !== "provider") {
    throw new Error("MANAGED_POOL_REQUIRES_CONTAINER_SANDBOX");
  }

  const labelsRaw = (normalized.capabilities as any)?.labels ?? (normalized.capabilities as any)?.tags;
  const labels =
    Array.isArray(labelsRaw) && labelsRaw.length > 0 ? labelsRaw.filter((x: unknown): x is string => typeof x === "string") : [];
  const hello = {
    type: "executor_hello_v2",
    executorVersion: normalized.executorVersion,
    executorId: normalized.executorId,
    pool: normalized.pool,
    ...(normalized.pool === "byon" && normalized.organizationId ? { organizationId: normalized.organizationId } : {}),
    name: normalized.executorName,
    labels,
    maxInFlight: Number((normalized.capabilities as any)?.maxInFlight ?? 10),
    kinds: ["connector.action", "agent.execute", "agent.run"] as const,
  };

  const pingIntervalMs = 15_000;
  const abort = new AbortController();
  let activeWs: WebSocket | null = null;

  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const sandbox = resolveSandboxBackend();
  const sessionRuntime = await buildSessionRuntimeManager({ pool: normalized.pool });
  const tlsCa = await loadTlsCaFromEnv(normalized.gatewayWsUrl);

  const loop = (async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abort.signal.aborted) {
        return;
      }

      const ws = new WebSocket(normalized.gatewayWsUrl, {
        headers: { authorization: `Bearer ${normalized.executorToken}` },
        ...(tlsCa ? { ca: tlsCa } : {}),
      });

      let pingTimer: NodeJS.Timeout | null = null;
      const closed = new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.on("error", () => resolve());
      });

      ws.on("open", () => {
        attempt = 0;
        activeWs = ws;
        safeSend(ws, hello);
        pingTimer = setInterval(() => {
          safeSend(ws, hello);
        }, pingIntervalMs);
        if (readyResolve) {
          readyResolve();
          readyResolve = null;
        }
        jsonLog("info", {
          event: "executor_connected",
          pool: normalized.pool,
          orgId: normalized.organizationId,
          executorId: normalized.executorId,
        });
      });

      ws.on("message", async (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const parsedJson = safeJsonParse(raw);
        const parsedTool = invokeToolSchema.safeParse(parsedJson);
        if (parsedTool.success) {
          const incoming = parsedTool.data;
          let result: GatewayToolResultV2;
          try {
            result = await executeTool({ incoming, sandbox });
          } catch (error) {
            const message = error instanceof Error ? error.message : REMOTE_EXEC_ERROR.NodeExecutionFailed;
            result = {
              type: "tool_result_v2",
              requestId: incoming.requestId,
              status: "failed",
              error: message || REMOTE_EXEC_ERROR.NodeExecutionFailed,
            };
          }
          safeSend(ws, result);
          return;
        }

        const parsedOpen = sessionOpenSchema.safeParse(parsedJson);
        if (parsedOpen.success) {
          const incoming = parsedOpen.data as GatewaySessionOpenV2;
          const opened = await sessionRuntime.openSession(incoming as any);
          if (!opened.ok) {
            safeSend(ws, {
              type: "turn_error",
              requestId: incoming.requestId,
              sessionId: incoming.sessionId,
              code: opened.code,
              message: opened.message,
            });
            return;
          }
          safeSend(ws, {
            type: "session_opened",
            requestId: incoming.requestId,
            sessionId: incoming.sessionId,
          });
          return;
        }

        const parsedTurn = sessionTurnSchema.safeParse(parsedJson);
        if (parsedTurn.success) {
          const incoming = parsedTurn.data as GatewaySessionTurnV2;
          safeSend(ws, {
            type: "turn_delta",
            requestId: incoming.requestId,
            sessionId: incoming.sessionId,
            content: "processing...",
          });
          const turn = await sessionRuntime.runTurn(incoming as any);
          if (!turn.ok) {
            safeSend(ws, {
              type: "turn_error",
              requestId: incoming.requestId,
              sessionId: incoming.sessionId,
              code: turn.code,
              message: turn.message,
            });
            return;
          }
          safeSend(ws, {
            type: "turn_final",
            requestId: incoming.requestId,
            sessionId: incoming.sessionId,
            content: turn.content,
            ...(turn.payload !== undefined ? { payload: turn.payload } : {}),
          });
          return;
        }

        const parsedSync = memorySyncSchema.safeParse(parsedJson);
        if (parsedSync.success) {
          const incoming = parsedSync.data as GatewayMemorySyncV2;
          const result = await sessionRuntime.syncMemory(incoming as any);
          if (!result.ok) {
            safeSend(ws, {
              type: "memory_sync_result",
              requestId: incoming.requestId,
              sessionId: incoming.sessionId,
              status: "failed",
              details: { error: result.error },
            });
            return;
          }
          safeSend(ws, {
            type: "memory_sync_result",
            requestId: incoming.requestId,
            sessionId: incoming.sessionId,
            status: "ok",
            details: result.details,
          });
          return;
        }

        const parsedQuery = memoryQuerySchema.safeParse(parsedJson);
        if (parsedQuery.success) {
          const incoming = parsedQuery.data as GatewayMemoryQueryV2;
          const result = await sessionRuntime.queryMemory(incoming as any);
          if (!result.ok) {
            safeSend(ws, {
              type: "memory_query_result",
              requestId: incoming.requestId,
              sessionId: incoming.sessionId,
              status: "failed",
              error: result.error,
            });
            return;
          }
          safeSend(ws, {
            type: "memory_query_result",
            requestId: incoming.requestId,
            sessionId: incoming.sessionId,
            status: "ok",
            results: result.results,
          });
        }
      });

      await Promise.race([
        closed,
        new Promise<void>((resolve) => {
          abort.signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      ]);

      try {
        ws.close();
      } catch {
        // ignore
      }
      if (activeWs === ws) {
        activeWs = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
      }
      if (abort.signal.aborted) {
        return;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(attempt)));
    }
  })();

  return {
    ready,
    async close() {
      abort.abort();
      await loop;
      await sandbox.close();
    },
  };
}

// Backward-compatible helper export name.
export function agentTokenHash(token: string): string {
  return sha256Hex(token);
}

export function executorTokenHash(token: string): string {
  return sha256Hex(token);
}
