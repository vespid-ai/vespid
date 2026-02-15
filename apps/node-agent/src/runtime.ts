import crypto from "node:crypto";
import fs from "node:fs/promises";
import WebSocket from "ws";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import {
  REMOTE_EXEC_ERROR,
  isRemoteExecErrorCode,
  type GatewayAgentHelloMessage,
  type GatewayAgentPingMessage,
  type GatewayServerExecuteAckMessage,
  type GatewayServerExecuteMessage,
} from "@vespid/shared";
import { resolveSandboxBackend, type SandboxBackend } from "./sandbox/index.js";
import { executeAgentRun } from "./agent-run/execute-agent-run.js";

export type NodeAgentConfig = {
  agentId: string;
  agentToken: string;
  organizationId: string;
  gatewayWsUrl: string;
  apiBaseUrl: string;
  name: string;
  agentVersion: string;
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

const agentExecuteTaskSchema = z
  .object({
    type: z.literal("shell"),
    script: z.string().min(1),
    shell: z.enum(["sh", "bash"]).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const agentExecuteSandboxSchema = z
  .object({
    backend: z.enum(["docker", "host", "provider"]).optional(),
    network: z.enum(["none", "enabled"]).optional(),
    timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
    docker: z
      .object({
        image: z.string().min(1).optional(),
      })
      .optional(),
    envPassthroughAllowlist: z.array(z.string().min(1)).optional(),
  })
  .strict();

const agentExecuteNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.execute"),
  config: z
    .object({
      task: agentExecuteTaskSchema.optional(),
      sandbox: agentExecuteSandboxSchema.optional(),
    })
    .optional(),
});

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

export async function startNodeAgent(config: NodeAgentConfig): Promise<StartedNodeAgent> {
  const hello: GatewayAgentHelloMessage = {
    type: "hello",
    agentVersion: config.agentVersion,
    name: config.name,
    capabilities: config.capabilities,
  };

  const pingIntervalMs = 15_000;
  // Buffer execute_result frames until the gateway explicitly acks them.
  // This makes result delivery resilient to gateway restarts and WS churn.
  const pendingResults = new Map<string, { createdAtMs: number; message: unknown }>();
  const abort = new AbortController();
  let activeWs: WebSocket | null = null;

  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  function safeSend(ws: WebSocket | null, message: unknown) {
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

  function flushPendingResults() {
    const ws = activeWs;
    if (!ws) return;

    const now = Date.now();
    for (const [requestId, entry] of pendingResults.entries()) {
      if (now - entry.createdAtMs > pendingTtlMs) {
        pendingResults.delete(requestId);
        continue;
      }
      const sent = safeSend(ws, entry.message);
      if (sent) {
        jsonLog("info", { event: "node_agent_execute_result_sent", requestId });
      }
    }
  }

  function bufferResult(requestId: string, message: unknown) {
    pendingResults.set(requestId, { createdAtMs: Date.now(), message });
    flushPendingResults();
  }

  async function handleExecute(ws: WebSocket, incoming: GatewayServerExecuteMessage, sandbox: SandboxBackend) {
    const requestId = incoming.requestId;
    try {
      if (incoming.kind === "agent.run") {
        let seq = 0;
        const emitEvent = (event: { ts: number; kind: string; level: "info" | "warn" | "error"; message?: string; payload?: unknown }) => {
          seq += 1;
          safeSend(ws, {
            type: "execute_event",
            requestId,
            event: {
              seq,
              ts: typeof event.ts === "number" ? event.ts : Date.now(),
              kind: event.kind,
              level: event.level,
              ...(typeof event.message === "string" ? { message: event.message } : {}),
              ...(event.payload !== undefined ? { payload: event.payload } : {}),
            },
          });
        };

        const result = await executeAgentRun({
          requestId,
          incoming,
          sandbox,
          emitEvent,
        });
        bufferResult(requestId, result);
        jsonLog("info", {
          event: "node_agent_execute_result_ready",
          requestId,
          status: (result as any)?.status ?? "unknown",
        });
        return;
      }

      if (incoming.kind === "agent.execute") {
        const payload = z
          .object({
            nodeId: z.string().min(1),
            node: z.unknown(),
            runId: z.string().uuid().optional(),
            workflowId: z.string().uuid().optional(),
            attemptCount: z.number().int().min(1).optional(),
          })
          .safeParse(incoming.payload);

        const nodeId = payload.success ? payload.data.nodeId : "node";
        const nodeParsed = agentExecuteNodeSchema.safeParse(payload.success ? payload.data.node : null);

        // Backward-compatible behavior when task is missing: return the stub output.
        if (!nodeParsed.success || !nodeParsed.data.config?.task) {
          const result = {
            type: "execute_result",
            requestId,
            status: "succeeded",
            output: { accepted: true, taskId: `${nodeId}-remote-task` },
          };
          bufferResult(requestId, result);
          jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
          return;
        }

        const sandboxConfig = nodeParsed.data.config?.sandbox;
        const task = nodeParsed.data.config.task;

        const execResult = await sandbox.executeShellTask({
          requestId,
          organizationId: incoming.organizationId,
          userId: incoming.userId,
          runId: payload.success && payload.data.runId ? payload.data.runId : null,
          workflowId: payload.success && payload.data.workflowId ? payload.data.workflowId : null,
          nodeId: nodeParsed.data.id,
          attemptCount: payload.success && typeof payload.data.attemptCount === "number" ? payload.data.attemptCount : null,
          script: task.script,
          shell: task.shell ?? "sh",
          taskEnv: task.env ?? {},
          networkMode: sandboxConfig?.network ?? null,
          timeoutMs: sandboxConfig?.timeoutMs ?? null,
          dockerImage: sandboxConfig?.docker?.image ?? null,
          envPassthroughAllowlist: sandboxConfig?.envPassthroughAllowlist ?? [],
        });

        const result = {
          type: "execute_result",
          requestId,
          status: execResult.status,
          ...(execResult.output !== undefined ? { output: execResult.output } : {}),
          ...(execResult.status === "failed" ? { error: execResult.error } : {}),
        };
        bufferResult(requestId, result);
        jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
        return;
      }

      const actionPayload = z
        .object({
          connectorId: z.string().min(1),
          actionId: z.string().min(1),
          input: z.unknown().optional(),
          env: z.object({ githubApiBaseUrl: z.string().url() }).optional(),
        })
        .safeParse(incoming.payload);

      if (!actionPayload.success) {
        const result = { type: "execute_result", requestId, status: "failed", error: "INVALID_ACTION_PAYLOAD" };
        bufferResult(requestId, result);
        jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
        return;
      }

      const action = getCommunityConnectorAction({
        connectorId: actionPayload.data.connectorId as ConnectorId,
        actionId: actionPayload.data.actionId,
      });
      if (!action) {
        const result = {
          type: "execute_result",
          requestId,
          status: "failed",
          error: `ACTION_NOT_SUPPORTED:${actionPayload.data.connectorId}:${actionPayload.data.actionId}`,
        };
        bufferResult(requestId, result);
        jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
        return;
      }

      const actionInputParsed = action.inputSchema.safeParse(actionPayload.data.input);
      if (!actionInputParsed.success) {
        const result = { type: "execute_result", requestId, status: "failed", error: "INVALID_ACTION_INPUT" };
        bufferResult(requestId, result);
        jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
        return;
      }

      const secret = action.requiresSecret ? incoming.secret ?? null : null;
      if (action.requiresSecret && !secret) {
        const result = { type: "execute_result", requestId, status: "failed", error: "SECRET_REQUIRED" };
        bufferResult(requestId, result);
        jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
        return;
      }

      const execResult = await action.execute({
        organizationId: incoming.organizationId,
        userId: incoming.userId,
        connectorId: actionPayload.data.connectorId as ConnectorId,
        actionId: actionPayload.data.actionId,
        input: actionInputParsed.data,
        secret,
        env: { githubApiBaseUrl: actionPayload.data.env?.githubApiBaseUrl ?? "https://api.github.com" },
        fetchImpl: fetch,
      });

      const result = {
        type: "execute_result",
        requestId,
        status: execResult.status,
        ...(execResult.output !== undefined ? { output: execResult.output } : {}),
        ...(execResult.status === "failed" ? { error: execResult.error } : {}),
      };
      bufferResult(requestId, result);
      jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : REMOTE_EXEC_ERROR.NodeExecutionFailed;
      const safeError = isRemoteExecErrorCode(message) ? message : REMOTE_EXEC_ERROR.NodeExecutionFailed;
      const result = { type: "execute_result", requestId, status: "failed", error: safeError };
      bufferResult(requestId, result);
      jsonLog("info", { event: "node_agent_execute_result_ready", requestId, status: result.status });
    }
  }

  function reconnectDelayMs(attempt: number): number {
    const base = Math.min(30_000, 500 * 2 ** Math.min(10, attempt));
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  const sandbox = resolveSandboxBackend();
  const tlsCa = await loadTlsCaFromEnv(config.gatewayWsUrl);
  const pendingTtlMs = Math.max(60_000, (Number(process.env.GATEWAY_RESULTS_TTL_SEC ?? "900") || 900) * 1000);

  const loop = (async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abort.signal.aborted) {
        return;
      }

      const ws = new WebSocket(config.gatewayWsUrl, {
        headers: { authorization: `Bearer ${config.agentToken}` },
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
        flushPendingResults();
        pingTimer = setInterval(() => {
          const ping: GatewayAgentPingMessage = { type: "ping", ts: Date.now() };
          safeSend(ws, ping);
        }, pingIntervalMs);

        // Resolve "ready" on first successful connection.
        if (readyResolve) {
          readyResolve();
          readyResolve = null;
        }

        jsonLog("info", { event: "node_agent_connected", orgId: config.organizationId });
      });

      ws.on("message", async (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const message = safeJsonParse(raw);
        if (!message || typeof message !== "object") {
          return;
        }
        const type = (message as { type?: unknown }).type;
        if (type === "execute_ack") {
          const parsed = z
            .object({
              type: z.literal("execute_ack"),
              requestId: z.string().min(1),
            })
            .safeParse(message) as { success: boolean; data?: GatewayServerExecuteAckMessage };
          if (!parsed.success || !parsed.data) {
            return;
          }
          pendingResults.delete(parsed.data.requestId);
          return;
        }
        if (type !== "execute") {
          return;
        }

        const parsed = z
          .object({
            type: z.literal("execute"),
            requestId: z.string().min(1),
            organizationId: z.string().uuid(),
            userId: z.string().uuid(),
            kind: z.enum(["connector.action", "agent.execute", "agent.run"]),
            payload: z.unknown(),
            secret: z.string().min(1).optional(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayServerExecuteMessage };

        if (!parsed.success || !parsed.data) {
          return;
        }

        safeSend(ws, { type: "execute_received", requestId: parsed.data.requestId });
        await handleExecute(ws, parsed.data, sandbox);
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
      const delay = reconnectDelayMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
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

export function agentTokenHash(token: string): string {
  return sha256Hex(token);
}
