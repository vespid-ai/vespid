import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import { createMemoryManager } from "@vespid/agent-runtime";
import type {
  AgentEngineId,
  GatewayInvokeToolV2,
  GatewayMemoryQueryV2,
  GatewayMemorySyncV2,
  MemoryProvider,
  GatewaySessionOpenV2,
  GatewaySessionCancelV2,
  GatewaySessionTurnV2,
  GatewayToolResultV2,
  ToolPolicyV1,
} from "@vespid/shared";
import { AGENT_ENGINE_IDS, REMOTE_EXEC_ERROR } from "@vespid/shared";
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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
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
  kind: z.enum(["connector.action", "agent.execute", "agent.run"]),
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
    engine: z.object({
      id: z.enum(AGENT_ENGINE_IDS),
      model: z.string().min(1).optional(),
      authMode: z.enum(["env", "inline_api_key", "oauth_executor"]).default("env"),
      auth: z
        .object({
          kind: z.literal("api_key"),
          apiKey: z.string().min(1),
        })
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

const sessionCancelSchema = z.object({
  type: z.literal("session_cancel"),
  requestId: z.string().min(1),
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
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

const agentRunPayloadSchema = z
  .object({
    nodeId: z.string().min(1),
    node: z
      .object({
        id: z.string().min(1),
        type: z.literal("agent.run"),
        config: z.object({
          engine: z.object({
            id: z.enum(AGENT_ENGINE_IDS),
            model: z.string().min(1).optional(),
          }),
          prompt: z.object({
            system: z.string().optional(),
            instructions: z.string().min(1),
            inputTemplate: z.string().optional(),
          }),
          tools: z
            .object({
              allow: z.array(z.string().min(1)).default([]),
            })
            .optional(),
          limits: z
            .object({
              maxToolCalls: z.number().int().min(0).max(200).optional(),
              timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
            })
            .optional(),
        }),
      })
      .passthrough(),
    runId: z.string().uuid().optional(),
    workflowId: z.string().uuid().optional(),
    attemptCount: z.number().int().min(1).optional(),
    runInput: z.unknown().optional(),
    env: z.object({ githubApiBaseUrl: z.string().url() }).optional(),
    resolvedSecrets: z
      .object({
        engine: z.string().nullable().optional(),
        connectors: z.record(z.string().min(1), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

const bridgeToolCallSchema = z.object({
  kind: z.enum(["connector.action", "agent.execute"]),
  payload: z.unknown(),
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
  history: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  workspaceDir: string;
  activeTurn:
    | {
        requestId: string;
        controller: AbortController;
      }
    | null;
};

function normalizePathPart(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-z0-9._-]+/g, "-");
}

function resolveEngineCommand(engineId: AgentEngineId): string {
  if (engineId === "gateway.codex.v2") return process.env.VESPID_CODEX_PATH?.trim() || "codex";
  if (engineId === "gateway.claude.v2") return process.env.VESPID_CLAUDE_CODE_PATH?.trim() || "claude";
  return process.env.VESPID_OPENCODE_PATH?.trim() || "opencode";
}

function defaultEngineModel(engineId: AgentEngineId): string {
  if (engineId === "gateway.codex.v2") return "gpt-5-codex";
  if (engineId === "gateway.claude.v2") return "claude-sonnet-4-20250514";
  return "claude-opus-4-6";
}

type ExecutorOauthEngineId = Extract<AgentEngineId, "gateway.codex.v2" | "gateway.claude.v2">;

type EngineAuthProbeState = {
  oauthVerified: boolean;
  checkedAt: string;
  reason: string;
};

const EXECUTOR_OAUTH_ENGINES: readonly ExecutorOauthEngineId[] = ["gateway.codex.v2", "gateway.claude.v2"] as const;

function parseCommandString(raw: string): { command: string; args: string[] } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (parts.length === 0) return null;
  const normalized = parts.map((part) => part.replace(/^["']|["']$/g, ""));
  const [command, ...args] = normalized;
  if (!command) return null;
  return { command, args };
}

function defaultVerifyCommandAttempts(engineId: ExecutorOauthEngineId): Array<{ command: string; args: string[] }> {
  const cli = resolveEngineCommand(engineId);
  if (engineId === "gateway.codex.v2") {
    return [
      { command: cli, args: ["login", "status"] },
      { command: cli, args: ["auth", "status"] },
      { command: cli, args: ["whoami"] },
    ];
  }
  return [
    { command: cli, args: ["auth", "status"] },
    { command: cli, args: ["whoami"] },
  ];
}

function verifyCommandAttemptsFromEnv(engineId: ExecutorOauthEngineId): Array<{ command: string; args: string[] }> {
  const envName = engineId === "gateway.codex.v2" ? "VESPID_CODEX_OAUTH_VERIFY_CMD" : "VESPID_CLAUDE_OAUTH_VERIFY_CMD";
  const override = process.env[envName];
  if (!override) {
    return defaultVerifyCommandAttempts(engineId);
  }
  const parsed = parseCommandString(override);
  if (!parsed) {
    return defaultVerifyCommandAttempts(engineId);
  }
  return [parsed];
}

function defaultProbeState(): EngineAuthProbeState {
  return {
    oauthVerified: false,
    checkedAt: new Date(0).toISOString(),
    reason: "not_checked",
  };
}

async function probeEngineOauthStatus(input: {
  engineId: ExecutorOauthEngineId;
  timeoutMs: number;
}): Promise<EngineAuthProbeState> {
  const now = new Date().toISOString();
  let sawNotFound = false;
  let sawTimeout = false;

  const attempts = verifyCommandAttemptsFromEnv(input.engineId);
  for (const attempt of attempts) {
    const result = await runCliCommand({
      command: attempt.command,
      args: attempt.args,
      cwd: process.cwd(),
      timeoutMs: input.timeoutMs,
    });
    if (result.notFound) {
      sawNotFound = true;
      continue;
    }
    if (result.timedOut) {
      sawTimeout = true;
      continue;
    }
    if (result.exitCode === 0) {
      return {
        oauthVerified: true,
        checkedAt: now,
        reason: "verified",
      };
    }
  }

  if (sawNotFound) {
    return {
      oauthVerified: false,
      checkedAt: now,
      reason: "cli_not_found",
    };
  }
  if (sawTimeout) {
    return {
      oauthVerified: false,
      checkedAt: now,
      reason: "probe_timeout",
    };
  }
  return {
    oauthVerified: false,
    checkedAt: now,
    reason: "unauthenticated",
  };
}

function renderPromptFromMessages(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): string {
  return messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
}

async function runCliCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ exitCode: number; stdout: string; stderr: string; notFound: boolean; timedOut: boolean; aborted: boolean }> {
  if (input.signal?.aborted) {
    return { exitCode: 130, stdout: "", stderr: "aborted", notFound: false, timedOut: false, aborted: true };
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...(input.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let abortTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(1000, input.timeoutMs));

    const onAbort = () => {
      if (settled) return;
      aborted = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      abortTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 300);
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      input.signal?.removeEventListener("abort", onAbort);
      if (error.code === "ENOENT") {
        resolve({
          exitCode: 127,
          stdout,
          stderr: `${input.command}: command not found`,
          notFound: true,
          timedOut: false,
          aborted: false,
        });
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      input.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code ?? (timedOut ? 124 : aborted ? 130 : 0),
        stdout,
        stderr,
        notFound: false,
        timedOut,
        aborted,
      });
    });
  });
}

async function executeEnginePrompt(input: {
  engineId: AgentEngineId;
  model: string;
  prompt: string;
  workspaceDir: string;
  timeoutMs: number;
  apiKey?: string | null;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; content: string; raw: { stdout: string; stderr: string } }
  | { ok: false; code: string; message: string; raw?: { stdout: string; stderr: string } }
> {
  const command = resolveEngineCommand(input.engineId);
  const env: NodeJS.ProcessEnv = {};
  if (input.apiKey && input.apiKey.trim().length > 0) {
    const key = input.apiKey.trim();
    if (input.engineId === "gateway.claude.v2") env.ANTHROPIC_API_KEY = key;
    else env.OPENAI_API_KEY = key;
  }

  const attempts: string[][] =
    input.engineId === "gateway.codex.v2"
      ? [
          ["exec", "--skip-git-repo-check", "--model", input.model, input.prompt],
          ["run", "--print", input.prompt],
        ]
      : input.engineId === "gateway.claude.v2"
        ? [["--print", "--model", input.model, input.prompt]]
        : [
            ["run", "--model", input.model, "--", input.prompt],
            ["run", "--", input.prompt],
          ];

  let lastStdout = "";
  let lastStderr = "";
  for (const args of attempts) {
    const result = await runCliCommand({
      command,
      args,
      cwd: input.workspaceDir,
      env,
      timeoutMs: input.timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    lastStdout = result.stdout;
    lastStderr = result.stderr;
    if (result.aborted) {
      return {
        ok: false,
        code: "TURN_CANCELED",
        message: "Turn canceled",
      };
    }
    if (result.notFound) {
      return {
        ok: false,
        code: REMOTE_EXEC_ERROR.ExecutorCliNotFound,
        message: `CLI_NOT_FOUND:${command}`,
      };
    }
    if (result.exitCode === 0) {
      const content = result.stdout.trim();
      return { ok: true, content: content.length > 0 ? content : "ok", raw: { stdout: result.stdout, stderr: result.stderr } };
    }
  }

  return {
    ok: false,
    code: REMOTE_EXEC_ERROR.ExecutorCliFailed,
    message: lastStderr.trim() || "CLI execution failed",
    raw: { stdout: lastStdout, stderr: lastStderr },
  };
}

async function buildSessionRuntimeManager(input: {
  pool: "managed" | "byon";
}): Promise<{
  openSession: (open: z.infer<typeof sessionOpenSchema>) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  runTurn: (turn: z.infer<typeof sessionTurnSchema>) => Promise<
    | { ok: true; content: string; payload?: unknown }
    | { ok: false; code: string; message: string }
  >;
  cancelTurn: (cancel: z.infer<typeof sessionCancelSchema>) => Promise<{ ok: true; canceled: boolean }>;
  syncMemory: (sync: z.infer<typeof memorySyncSchema>) => Promise<{ ok: true; details: unknown } | { ok: false; error: string }>;
  queryMemory: (query: z.infer<typeof memoryQuerySchema>) => Promise<{ ok: true; results: unknown[] } | { ok: false; error: string }>;
}> {
  const sessions = new Map<string, SessionContext>();
  const memoryRoot = process.env.SESSION_MEMORY_ROOT ?? "/tmp/vespid-memory";

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
      history: [
        ...(open.sessionConfig.prompt.system ? [{ role: "system" as const, content: open.sessionConfig.prompt.system }] : []),
        { role: "system" as const, content: open.sessionConfig.prompt.instructions },
      ],
      workspaceDir,
      activeTurn: null,
    });
    return { ok: true } as const;
  }

  async function runTurn(turn: z.infer<typeof sessionTurnSchema>) {
    const ctx = sessions.get(turn.sessionId) ?? null;
    if (!ctx) {
      return { ok: false as const, code: "SESSION_NOT_OPEN", message: "Session has not been opened on this executor." };
    }
    if (ctx.activeTurn) {
      return { ok: false as const, code: "TURN_IN_PROGRESS", message: "A turn is already running for this session." };
    }

    const maxTurns = Math.max(1, Math.floor(ctx.opened.sessionConfig.limits.maxTurns));
    if (ctx.history.filter((m) => m.role === "user").length >= maxTurns) {
      return { ok: false as const, code: "SESSION_LIMIT_REACHED", message: "Session maxTurns reached." };
    }

    const attachmentText =
      Array.isArray(turn.attachments) && turn.attachments.length > 0
        ? `\n\nAttachments:\n${JSON.stringify(turn.attachments)}`
        : "";
    ctx.history.push({ role: "user", content: `${turn.message}${attachmentText}` });

    const controller = new AbortController();
    ctx.activeTurn = { requestId: turn.requestId, controller };
    let result:
      | { ok: true; content: string; raw: { stdout: string; stderr: string } }
      | { ok: false; code: string; message: string; raw?: { stdout: string; stderr: string } };
    try {
      result = await executeEnginePrompt({
        engineId: ctx.opened.sessionConfig.engine.id,
        model: ctx.opened.sessionConfig.engine.model ?? defaultEngineModel(ctx.opened.sessionConfig.engine.id),
        prompt: renderPromptFromMessages(ctx.history),
        workspaceDir: ctx.workspaceDir,
        timeoutMs: ctx.opened.sessionConfig.limits.timeoutMs,
        apiKey:
          ctx.opened.sessionConfig.engine.authMode === "inline_api_key" && ctx.opened.sessionConfig.engine.auth?.kind === "api_key"
            ? ctx.opened.sessionConfig.engine.auth.apiKey
            : null,
        signal: controller.signal,
      });
    } finally {
      if (ctx.activeTurn?.requestId === turn.requestId) {
        ctx.activeTurn = null;
      }
    }
    if (!result.ok) {
      return { ok: false as const, code: result.code, message: result.message };
    }

    ctx.history.push({ role: "assistant", content: result.content });
    return { ok: true as const, content: result.content, payload: { raw: result.raw } };
  }

  async function cancelTurn(cancel: z.infer<typeof sessionCancelSchema>) {
    const ctx = sessions.get(cancel.sessionId) ?? null;
    if (!ctx || !ctx.activeTurn) {
      return { ok: true as const, canceled: false };
    }
    if (ctx.activeTurn.requestId !== cancel.requestId) {
      return { ok: true as const, canceled: false };
    }
    ctx.activeTurn.controller.abort();
    return { ok: true as const, canceled: true };
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
    cancelTurn,
    syncMemory,
    queryMemory,
  };
}

async function executeTool(input: {
  incoming: z.infer<typeof invokeToolSchema>;
  sandbox: SandboxBackend;
  emitToolEvent?: (event: { kind: string; level: "info" | "warn" | "error"; message: string; payload?: unknown }) => void;
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

  const emit = (event: { kind: string; level: "info" | "warn" | "error"; message: string; payload?: unknown }) => {
    input.emitToolEvent?.(event);
  };

  const runAgentExecuteTask = async (args: {
    nodeId: string;
    runId: string | null;
    workflowId: string | null;
    attemptCount: number | null;
    task: { type?: "shell" | undefined; script: string; shell?: "sh" | "bash" | undefined; env?: Record<string, string> | undefined };
    sandboxCfg?:
      | {
          backend?: "docker" | "host" | "provider" | undefined;
          network?: "none" | "enabled" | undefined;
          timeoutMs?: number | undefined;
          docker?: { image?: string | undefined } | undefined;
        }
      | null;
  }) => {
    const networkMode = policy.networkMode === "enabled" ? "enabled" : "none";
    return await sandbox.executeShellTask({
      requestId: incoming.requestId,
      organizationId: incoming.organizationId,
      userId: incoming.userId,
      runId: args.runId,
      workflowId: args.workflowId,
      nodeId: args.nodeId,
      attemptCount: args.attemptCount,
      script: args.task.script,
      shell: args.task.shell ?? "sh",
      taskEnv: args.task.env ?? {},
      ...(args.sandboxCfg?.backend ? { backend: args.sandboxCfg.backend } : {}),
      networkMode,
      timeoutMs: policy.timeoutMs ?? args.sandboxCfg?.timeoutMs ?? null,
      dockerImage: args.sandboxCfg?.docker?.image ?? null,
      envPassthroughAllowlist: [],
      workdirHostPath: workspace.workdir,
    });
  };

  const runConnectorTask = async (payload: z.infer<typeof connectorPayloadSchema>, secretOverride?: string | null) => {
    const action = getCommunityConnectorAction({
      connectorId: payload.connectorId as ConnectorId,
      actionId: payload.actionId,
    });
    if (!action) {
      return { status: "failed" as const, error: `ACTION_NOT_SUPPORTED:${payload.connectorId}:${payload.actionId}` };
    }
    const inputParsed = action.inputSchema.safeParse(payload.input);
    if (!inputParsed.success) {
      return { status: "failed" as const, error: "INVALID_ACTION_INPUT" };
    }
    const secret = action.requiresSecret ? secretOverride ?? incoming.secret ?? null : null;
    if (action.requiresSecret && !secret) {
      return { status: "failed" as const, error: "SECRET_REQUIRED" };
    }
    return await action.execute({
      organizationId: incoming.organizationId,
      userId: incoming.userId,
      connectorId: payload.connectorId as ConnectorId,
      actionId: payload.actionId,
      input: inputParsed.data,
      secret,
      env: {
        githubApiBaseUrl: payload.env?.githubApiBaseUrl ?? "https://api.github.com",
      },
      fetchImpl: fetch,
    });
  };

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

    const exec = await runAgentExecuteTask({
      nodeId: parsed.data.nodeId,
      runId: parsed.data.runId ?? null,
      workflowId: parsed.data.workflowId ?? null,
      attemptCount: parsed.data.attemptCount ?? null,
      task,
      sandboxCfg: node?.config?.sandbox ?? null,
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

  if (incoming.kind === "agent.run") {
    const parsed = agentRunPayloadSchema.safeParse(incoming.payload);
    if (!parsed.success) {
      return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "INVALID_AGENT_RUN_PAYLOAD" };
    }

    const runInputText = parsed.data.runInput === undefined ? "" : JSON.stringify(parsed.data.runInput);
    const cfg = parsed.data.node.config;
    const promptBody =
      cfg.prompt.inputTemplate && cfg.prompt.inputTemplate.includes("{{input}}")
        ? cfg.prompt.inputTemplate.replaceAll("{{input}}", runInputText)
        : `${cfg.prompt.instructions}\n\nInput:\n${runInputText}`;
    const prompt = `${cfg.prompt.system ? `${cfg.prompt.system}\n\n` : ""}${promptBody}`;

    const baseResult = await executeEnginePrompt({
      engineId: cfg.engine.id,
      model: cfg.engine.model ?? defaultEngineModel(cfg.engine.id),
      prompt,
      workspaceDir: workspace.workdir,
      timeoutMs: cfg.limits?.timeoutMs ?? policy.timeoutMs ?? 60_000,
      apiKey: parsed.data.resolvedSecrets?.engine ?? null,
    });
    if (!baseResult.ok) {
      return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: `${baseResult.code}:${baseResult.message}` };
    }

    const extractToolCalls = (content: string): Array<z.infer<typeof bridgeToolCallSchema>> => {
      const matches = [...content.matchAll(/```vespid_tool_calls\s*([\s\S]*?)```/g)];
      const out: Array<z.infer<typeof bridgeToolCallSchema>> = [];
      for (const m of matches) {
        const raw = (m[1] ?? "").trim();
        if (!raw) continue;
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          continue;
        }
        const list = Array.isArray(parsedJson) ? parsedJson : (parsedJson as any)?.tool_calls;
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          const callParsed = bridgeToolCallSchema.safeParse(item);
          if (callParsed.success) out.push(callParsed.data);
        }
      }
      return out;
    };

    const allow = new Set(cfg.tools?.allow ?? []);
    const toolCalls = extractToolCalls(baseResult.content);
    const maxToolCalls = Math.max(0, cfg.limits?.maxToolCalls ?? 20);
    const toolResults: unknown[] = [];

    for (const [index, call] of toolCalls.entries()) {
      if (index >= maxToolCalls) break;
      if (!allow.has(call.kind)) {
        emit({ kind: "agent.run.tool.skip", level: "warn", message: `Tool ${call.kind} not in allowlist` });
        continue;
      }
      if (call.kind === "connector.action") {
        const connectorParsed = connectorPayloadSchema.safeParse(call.payload);
        if (!connectorParsed.success) {
          toolResults.push({ kind: call.kind, status: "failed", error: "INVALID_ACTION_PAYLOAD" });
          continue;
        }
        emit({ kind: "agent.run.tool.start", level: "info", message: "connector.action", payload: connectorParsed.data });
        const secret = parsed.data.resolvedSecrets?.connectors?.[connectorParsed.data.connectorId] ?? null;
        const res = await runConnectorTask(connectorParsed.data, secret);
        emit({ kind: "agent.run.tool.done", level: res.status === "failed" ? "error" : "info", message: "connector.action", payload: res });
        toolResults.push({ kind: call.kind, ...res });
        continue;
      }
      const execParsed = agentExecutePayloadSchema.safeParse(call.payload);
      if (!execParsed.success || !execParsed.data.node?.config?.task) {
        toolResults.push({ kind: call.kind, status: "failed", error: "INVALID_EXECUTE_PAYLOAD" });
        continue;
      }
      emit({ kind: "agent.run.tool.start", level: "info", message: "agent.execute", payload: { nodeId: execParsed.data.nodeId } });
      const res = await runAgentExecuteTask({
        nodeId: execParsed.data.nodeId,
        runId: execParsed.data.runId ?? parsed.data.runId ?? null,
        workflowId: execParsed.data.workflowId ?? parsed.data.workflowId ?? null,
        attemptCount: execParsed.data.attemptCount ?? parsed.data.attemptCount ?? null,
        task: execParsed.data.node.config.task,
        sandboxCfg: execParsed.data.node.config.sandbox ?? null,
      });
      emit({ kind: "agent.run.tool.done", level: res.status === "failed" ? "error" : "info", message: "agent.execute", payload: res });
      toolResults.push({ kind: call.kind, status: res.status, ...(res.output !== undefined ? { output: res.output } : {}), ...(res.status === "failed" ? { error: res.error } : {}) });
    }

    let finalContent = baseResult.content;
    if (toolResults.length > 0) {
      const rerun = await executeEnginePrompt({
        engineId: cfg.engine.id,
        model: cfg.engine.model ?? defaultEngineModel(cfg.engine.id),
        prompt: `${prompt}\n\nTool results:\n${JSON.stringify(toolResults, null, 2)}`,
        workspaceDir: workspace.workdir,
        timeoutMs: cfg.limits?.timeoutMs ?? policy.timeoutMs ?? 60_000,
        apiKey: parsed.data.resolvedSecrets?.engine ?? null,
      });
      if (rerun.ok) {
        finalContent = rerun.content;
      }
    }

    const nextWorkspace = await snapshotAndUploadWorkspace({
      pointer: normalizeWorkspacePointer(incoming.workspace),
      access: normalizeWorkspaceAccess(incoming.workspaceAccess),
      workdir: workspace.workdir,
    });

    return {
      type: "tool_result_v2",
      requestId: incoming.requestId,
      status: "succeeded",
      output: {
        text: finalContent,
        toolResults,
        raw: baseResult.raw,
      },
      workspace: nextWorkspace,
    };
  }

  const actionParsed = connectorPayloadSchema.safeParse(incoming.payload);
  if (!actionParsed.success) {
    return { type: "tool_result_v2", requestId: incoming.requestId, status: "failed", error: "INVALID_ACTION_PAYLOAD" };
  }

  const result = await runConnectorTask(actionParsed.data);

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

  const probeIntervalMs = Math.max(10_000, envNumber("VESPID_ENGINE_AUTH_PROBE_INTERVAL_MS", 60_000));
  const probeTimeoutMs = Math.max(500, envNumber("VESPID_ENGINE_AUTH_PROBE_TIMEOUT_MS", 5_000));
  const engineAuthState: Record<ExecutorOauthEngineId, EngineAuthProbeState> = {
    "gateway.codex.v2": defaultProbeState(),
    "gateway.claude.v2": defaultProbeState(),
  };
  let probeInFlight = false;

  function buildExecutorHello(): {
    type: "executor_hello_v2";
    executorVersion: string;
    executorId: string;
    pool: "managed" | "byon";
    organizationId?: string;
    name: string;
    labels: string[];
    maxInFlight: number;
    kinds: ["connector.action", "agent.execute", "agent.run"];
    engineAuth: Record<ExecutorOauthEngineId, EngineAuthProbeState>;
  } {
    return {
      type: "executor_hello_v2",
      executorVersion: normalized.executorVersion,
      executorId: normalized.executorId,
      pool: normalized.pool,
      ...(normalized.pool === "byon" && normalized.organizationId ? { organizationId: normalized.organizationId } : {}),
      name: normalized.executorName,
      labels,
      maxInFlight: Number((normalized.capabilities as any)?.maxInFlight ?? 10),
      kinds: ["connector.action", "agent.execute", "agent.run"],
      engineAuth: {
        "gateway.codex.v2": engineAuthState["gateway.codex.v2"],
        "gateway.claude.v2": engineAuthState["gateway.claude.v2"],
      },
    };
  }

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

  async function runEngineAuthProbeCycle(): Promise<void> {
    if (probeInFlight) return;
    probeInFlight = true;
    try {
      for (const engineId of EXECUTOR_OAUTH_ENGINES) {
        engineAuthState[engineId] = await probeEngineOauthStatus({
          engineId,
          timeoutMs: probeTimeoutMs,
        });
      }
    } finally {
      probeInFlight = false;
    }
  }

  await runEngineAuthProbeCycle();

  const probeTimer = setInterval(() => {
    void runEngineAuthProbeCycle()
      .then(() => {
        if (activeWs && activeWs.readyState === WebSocket.OPEN) {
          safeSend(activeWs, buildExecutorHello());
        }
      })
      .catch(() => {
        // ignore probe errors and keep previous heartbeat state
      });
  }, probeIntervalMs);

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
        safeSend(ws, buildExecutorHello());
        pingTimer = setInterval(() => {
          safeSend(ws, buildExecutorHello());
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
            let eventSeq = 0;
            result = await executeTool({
              incoming,
              sandbox,
              emitToolEvent: (evt) => {
                eventSeq += 1;
                safeSend(ws, {
                  type: "tool_event_v2",
                  requestId: incoming.requestId,
                  event: {
                    seq: eventSeq,
                    ts: Date.now(),
                    kind: evt.kind,
                    level: evt.level,
                    message: evt.message,
                    ...(evt.payload !== undefined ? { payload: evt.payload } : {}),
                  },
                });
              },
            });
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
          let opened;
          try {
            opened = await sessionRuntime.openSession(incoming as any);
          } catch (error) {
            const message = error instanceof Error ? error.message : "SESSION_OPEN_FAILED";
            jsonLog("error", {
              event: "session_open_failed",
              sessionId: incoming.sessionId,
              requestId: incoming.requestId,
              message,
            });
            safeSend(ws, {
              type: "turn_error",
              requestId: incoming.requestId,
              sessionId: incoming.sessionId,
              code: "SESSION_OPEN_FAILED",
              message,
            });
            return;
          }
          if (!opened.ok) {
            jsonLog("warn", {
              event: "session_open_rejected",
              sessionId: incoming.sessionId,
              requestId: incoming.requestId,
              code: opened.code,
              message: opened.message,
            });
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

        const parsedCancel = sessionCancelSchema.safeParse(parsedJson);
        if (parsedCancel.success) {
          const incoming = parsedCancel.data as GatewaySessionCancelV2;
          await sessionRuntime.cancelTurn(incoming as any);
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
      clearInterval(probeTimer);
      await loop;
      await sandbox.close();
    },
  };
}

export const __testables = {
  parseCommandString,
  probeEngineOauthStatus,
};

// Backward-compatible helper export name.
export function agentTokenHash(token: string): string {
  return sha256Hex(token);
}

export function executorTokenHash(token: string): string {
  return sha256Hex(token);
}
