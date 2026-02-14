import crypto from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import type { GatewayAgentHelloMessage, GatewayAgentPingMessage, GatewayServerExecuteMessage } from "@vespid/shared";
import { resolveSandboxBackend, type SandboxBackend } from "./sandbox/index.js";

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

export async function startNodeAgent(config: NodeAgentConfig): Promise<StartedNodeAgent> {
  const hello: GatewayAgentHelloMessage = {
    type: "hello",
    agentVersion: config.agentVersion,
    name: config.name,
    capabilities: config.capabilities,
  };

  const pingIntervalMs = 15_000;
  const pendingResults = new Map<string, unknown>();
  const abort = new AbortController();

  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  function safeSend(ws: WebSocket, message: unknown) {
    try {
      if (ws.readyState !== ws.OPEN) {
        return false;
      }
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  async function handleExecute(ws: WebSocket, incoming: GatewayServerExecuteMessage, sandbox: SandboxBackend) {
    const requestId = incoming.requestId;
    try {
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
          pendingResults.set(requestId, result);
          if (safeSend(ws, result)) {
            pendingResults.delete(requestId);
          }
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
        pendingResults.set(requestId, result);
        if (safeSend(ws, result)) {
          pendingResults.delete(requestId);
        }
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
        pendingResults.set(requestId, result);
        if (safeSend(ws, result)) {
          pendingResults.delete(requestId);
        }
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
        pendingResults.set(requestId, result);
        if (safeSend(ws, result)) {
          pendingResults.delete(requestId);
        }
        return;
      }

      const actionInputParsed = action.inputSchema.safeParse(actionPayload.data.input);
      if (!actionInputParsed.success) {
        const result = { type: "execute_result", requestId, status: "failed", error: "INVALID_ACTION_INPUT" };
        pendingResults.set(requestId, result);
        if (safeSend(ws, result)) {
          pendingResults.delete(requestId);
        }
        return;
      }

      const secret = action.requiresSecret ? incoming.secret ?? null : null;
      if (action.requiresSecret && !secret) {
        const result = { type: "execute_result", requestId, status: "failed", error: "SECRET_REQUIRED" };
        pendingResults.set(requestId, result);
        if (safeSend(ws, result)) {
          pendingResults.delete(requestId);
        }
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
      pendingResults.set(requestId, result);
      if (safeSend(ws, result)) {
        pendingResults.delete(requestId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "EXECUTION_FAILED";
      const result = { type: "execute_result", requestId, status: "failed", error: message };
      pendingResults.set(requestId, result);
      if (safeSend(ws, result)) {
        pendingResults.delete(requestId);
      }
    }
  }

  function reconnectDelayMs(attempt: number): number {
    const base = Math.min(30_000, 500 * 2 ** Math.min(10, attempt));
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  const sandbox = resolveSandboxBackend();

  const loop = (async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abort.signal.aborted) {
        return;
      }

      const ws = new WebSocket(config.gatewayWsUrl, {
        headers: { authorization: `Bearer ${config.agentToken}` },
      });

      let pingTimer: NodeJS.Timeout | null = null;
      const closed = new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.on("error", () => resolve());
      });

      ws.on("open", () => {
        attempt = 0;
        safeSend(ws, hello);
        for (const result of pendingResults.values()) {
          safeSend(ws, result);
        }
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
        if (type !== "execute") {
          return;
        }

        const parsed = z
          .object({
            type: z.literal("execute"),
            requestId: z.string().min(1),
            organizationId: z.string().uuid(),
            userId: z.string().uuid(),
            kind: z.enum(["connector.action", "agent.execute"]),
            payload: z.unknown(),
            secret: z.string().min(1).optional(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayServerExecuteMessage };

        if (!parsed.success || !parsed.data) {
          return;
        }

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
