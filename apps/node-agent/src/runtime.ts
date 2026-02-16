import crypto from "node:crypto";
import fs from "node:fs/promises";
import WebSocket from "ws";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import type { GatewayInvokeToolV2, GatewayToolResultV2, ToolPolicyV1 } from "@vespid/shared";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";
import { resolveSandboxBackend, type SandboxBackend } from "./sandbox/index.js";
import { ensureWorkspaceExtracted, snapshotAndUploadWorkspace, verifyWorkspaceDependencies } from "./workspaces/snapshot-cache.js";

export type NodeAgentConfig = {
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

  organizationId: string;
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

function normalizeConfig(config: NodeAgentConfig): Required<Pick<NodeAgentConfig, "executorId" | "executorToken" | "organizationId" | "gatewayWsUrl" | "apiBaseUrl" | "executorName" | "executorVersion" | "capabilities">> {
  const executorId = config.executorId ?? config.agentId ?? "";
  const executorToken = config.executorToken ?? config.agentToken ?? "";
  const executorName = config.executorName ?? config.name ?? "executor";
  const executorVersion = config.executorVersion ?? config.agentVersion ?? "0.0.0";
  if (!executorId || !executorToken) {
    throw new Error("EXECUTOR_CONFIG_INVALID");
  }
  return {
    executorId,
    executorToken,
    organizationId: config.organizationId,
    gatewayWsUrl: config.gatewayWsUrl,
    apiBaseUrl: config.apiBaseUrl,
    executorName,
    executorVersion,
    capabilities: config.capabilities ?? {},
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

  const labelsRaw = (normalized.capabilities as any)?.labels ?? (normalized.capabilities as any)?.tags;
  const labels =
    Array.isArray(labelsRaw) && labelsRaw.length > 0 ? labelsRaw.filter((x: unknown): x is string => typeof x === "string") : [];
  const hello = {
    type: "executor_hello_v2",
    executorVersion: normalized.executorVersion,
    executorId: normalized.executorId,
    pool: "byon" as const,
    organizationId: normalized.organizationId,
    name: normalized.executorName,
    labels,
    maxInFlight: Number((normalized.capabilities as any)?.maxInFlight ?? 10),
    kinds: ["connector.action", "agent.execute"] as const,
  };

  const pingIntervalMs = 15_000;
  const abort = new AbortController();
  let activeWs: WebSocket | null = null;

  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const sandbox = resolveSandboxBackend();
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
        jsonLog("info", { event: "executor_connected", orgId: normalized.organizationId, executorId: normalized.executorId });
      });

      ws.on("message", async (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const parsed = invokeToolSchema.safeParse(safeJsonParse(raw));
        if (!parsed.success) {
          return;
        }
        const incoming = parsed.data;
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
