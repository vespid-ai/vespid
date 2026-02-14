import crypto from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";
import { createPool, withTenantContext, getOrganizationAgentByTokenHash, touchOrganizationAgentLastSeen } from "@vespid/db";
import type {
  GatewayAgentHelloMessage,
  GatewayAgentPingMessage,
  GatewayAgentExecuteResultMessage,
  GatewayServerExecuteMessage,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
} from "@vespid/shared";
import { createInMemoryResultsStore, createRedisResultsStore, type ResultsStore } from "./results-store.js";

type ConnectedAgent = {
  ws: WebSocket;
  organizationId: string;
  agentId: string;
  tokenHash: string;
  lastSeenAtMs: number;
  lastUsedAtMs: number;
  inFlightCount: number;
  capabilities: Record<string, unknown> | null;
  name: string | null;
  agentVersion: string | null;
};

type PendingRequest = {
  resolve: (value: GatewayDispatchResponse) => void;
  timeout: NodeJS.Timeout;
  organizationId: string;
  agentId: string;
};

type AgentCapabilities = {
  kinds: Set<string>;
  connectors: Set<string> | null;
  maxInFlight: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeCapabilities(input: Record<string, unknown> | null): AgentCapabilities {
  const kindsRaw = input?.["kinds"];
  const kindsList = Array.isArray(kindsRaw) ? kindsRaw.filter((item): item is string => typeof item === "string") : [];
  // Backward-compatible default: if kinds not provided, assume it can handle any kind (MVP).
  const kinds = kindsList.length > 0 ? kindsList : ["connector.action", "agent.execute"];

  const connectorsRaw = input?.["connectors"];
  const connectorsList = Array.isArray(connectorsRaw)
    ? connectorsRaw.filter((item): item is string => typeof item === "string")
    : [];
  const connectors = connectorsList.length > 0 ? new Set(connectorsList) : null;

  const maxInFlightRaw = input?.["maxInFlight"];
  const maxInFlight =
    typeof maxInFlightRaw === "number" && Number.isFinite(maxInFlightRaw) ? Math.max(1, maxInFlightRaw) : 10;

  return { kinds: new Set(kinds), connectors, maxInFlight };
}

const connectorActionDispatchPayloadSchema = z.object({
  connectorId: z.string().min(1),
  actionId: z.string().min(1),
});

const dispatchRequestSchema = z.object({
  organizationId: z.string().uuid(),
  requestedByUserId: z.string().uuid(),
  runId: z.string().uuid(),
  workflowId: z.string().uuid(),
  nodeId: z.string().min(1),
  nodeType: z.string().min(1),
  attemptCount: z.number().int().min(1).max(1000),
  kind: z.enum(["connector.action", "agent.execute"]),
  payload: z.unknown(),
  secret: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
});

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function parseOrgIdPrefix(value: string): string | null {
  const [orgId] = value.split(".");
  if (!orgId) {
    return null;
  }
  const parsed = z.string().uuid().safeParse(orgId);
  return parsed.success ? parsed.data : null;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

export async function buildGatewayServer(input?: {
  pool?: ReturnType<typeof createPool>;
  serviceToken?: string;
  wsPath?: string;
  resultsStore?: ResultsStore;
}) {
  const server = Fastify({
    logger: {
      level: process.env.GATEWAY_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-gateway-token",
          "secret",
          "*.secret",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  const pool = input?.pool ?? createPool(process.env.DATABASE_URL);
  const ownsPool = !input?.pool;
  const serviceToken = input?.serviceToken ?? process.env.GATEWAY_SERVICE_TOKEN ?? "dev-gateway-token";
  const wsPath = input?.wsPath ?? "/ws";
  const staleAgentMs = Math.max(5_000, envNumber("GATEWAY_AGENT_STALE_MS", 60_000));
  const resultsTtlSec = Math.max(30, envNumber("GATEWAY_RESULTS_TTL_SEC", 15 * 60));
  const resultsStore =
    input?.resultsStore ??
    (process.env.REDIS_URL ? createRedisResultsStore(process.env.REDIS_URL) : createInMemoryResultsStore());

  const agentsByOrg = new Map<string, ConnectedAgent[]>();
  const pendingByRequestId = new Map<string, PendingRequest>();

  function selectAgent(
    orgId: string,
    required: { kind: string; connectorId?: string | null }
  ): ConnectedAgent | null {
    const now = Date.now();
    const agents = agentsByOrg.get(orgId) ?? [];
    if (agents.length === 0) {
      return null;
    }

    // Prune stale agents.
    const fresh: ConnectedAgent[] = [];
    for (const agent of agents) {
      if (now - agent.lastSeenAtMs > staleAgentMs) {
        removeAgent(orgId, agent.agentId);
        try {
          agent.ws.terminate();
        } catch {
          // ignore
        }
        server.log.warn({ event: "gateway_agent_disconnected", orgId, agentId: agent.agentId, reasonCode: "STALE" });
        continue;
      }
      const capabilities = normalizeCapabilities(agent.capabilities);
      if (!capabilities.kinds.has(required.kind)) {
        continue;
      }
      if (agent.inFlightCount >= capabilities.maxInFlight) {
        continue;
      }
      if (required.kind === "connector.action" && required.connectorId && capabilities.connectors) {
        if (!capabilities.connectors.has(required.connectorId)) {
          continue;
        }
      }
      fresh.push(agent);
    }

    if (fresh.length === 0) {
      agentsByOrg.delete(orgId);
      return null;
    }

    // Prefer least in-flight, then LRU.
    let best: ConnectedAgent | null = null;
    for (const agent of fresh) {
      if (
        !best ||
        agent.inFlightCount < best.inFlightCount ||
        (agent.inFlightCount === best.inFlightCount && agent.lastUsedAtMs < best.lastUsedAtMs)
      ) {
        best = agent;
      }
    }
    return best;
  }

  function removeAgent(orgId: string, agentId: string) {
    const list = agentsByOrg.get(orgId);
    if (!list) {
      return;
    }
    const next = list.filter((agent) => agent.agentId !== agentId);
    if (next.length === 0) {
      agentsByOrg.delete(orgId);
      return;
    }
    agentsByOrg.set(orgId, next);
  }

  async function touchAgent(orgId: string, agentId: string) {
    try {
      await withTenantContext(pool, { organizationId: orgId }, async (db) => {
        await touchOrganizationAgentLastSeen(db, { organizationId: orgId, agentId });
      });
    } catch {
      // Best-effort; do not fail WS processing due to telemetry writes.
    }
  }

  server.post("/internal/v1/dispatch", async (request, reply) => {
    const token = request.headers["x-gateway-token"];
    if (typeof token !== "string" || token.length === 0 || token !== serviceToken) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Invalid gateway service token" });
    }

    const parsed = dispatchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid dispatch payload" });
    }

    const requestId = `${parsed.data.runId}:${parsed.data.nodeId}:${parsed.data.attemptCount}`;
    const timeoutMs = parsed.data.timeoutMs ?? 60_000;
    server.log.info(
      {
        event: "gateway_dispatch_received",
        orgId: parsed.data.organizationId,
        runId: parsed.data.runId,
        workflowId: parsed.data.workflowId,
        nodeId: parsed.data.nodeId,
        attemptCount: parsed.data.attemptCount,
        kind: parsed.data.kind,
        requestId,
      },
      "gateway dispatch received"
    );

    let connectorId: string | null = null;
    if (parsed.data.kind === "connector.action") {
      const payloadParsed = connectorActionDispatchPayloadSchema.safeParse(parsed.data.payload);
      if (!payloadParsed.success) {
        return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid connector.action payload" });
      }
      connectorId = payloadParsed.data.connectorId;
    }

    // If we already have a cached result for this deterministic requestId, return it.
    const cached = await resultsStore.get(requestId);
    if (cached) {
      return reply.status(200).send(cached);
    }

    let agent: ConnectedAgent | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const selected = selectAgent(parsed.data.organizationId, { kind: parsed.data.kind, connectorId });
      if (!selected) {
        agent = null;
        break;
      }

      // Drop disconnected sockets eagerly.
      if (selected.ws.readyState !== selected.ws.OPEN) {
        removeAgent(selected.organizationId, selected.agentId);
        server.log.warn({
          event: "gateway_agent_disconnected",
          orgId: selected.organizationId,
          agentId: selected.agentId,
          reasonCode: "WS_NOT_OPEN",
        });
        continue;
      }

      // Re-check revocation at dispatch time (revoked agents remain connected but are never used).
      const row = await withTenantContext(pool, { organizationId: selected.organizationId }, async (db) =>
        getOrganizationAgentByTokenHash(db, { organizationId: selected.organizationId, tokenHash: selected.tokenHash })
      );
      if (!row || row.revokedAt) {
        removeAgent(selected.organizationId, selected.agentId);
        server.log.warn({
          event: "gateway_agent_revoked_skipped",
          orgId: selected.organizationId,
          agentId: selected.agentId,
          requestId,
        });
        continue;
      }

      agent = selected;
      break;
    }

    if (!agent) {
      server.log.warn({ event: "gateway_dispatch_no_agent", orgId: parsed.data.organizationId, requestId });
      return reply.status(503).send({ code: "NO_AGENT_AVAILABLE", message: "No node-agent is connected for this org" });
    }

    const message: GatewayServerExecuteMessage = {
      type: "execute",
      requestId,
      organizationId: parsed.data.organizationId,
      userId: parsed.data.requestedByUserId,
      kind: parsed.data.kind,
      payload: parsed.data.payload as GatewayDispatchRequest["payload"],
      ...(parsed.data.secret ? { secret: parsed.data.secret } : {}),
    };

    agent.inFlightCount += 1;
    const response = await new Promise<GatewayDispatchResponse>((resolve) => {
      const timeout = setTimeout(() => {
        pendingByRequestId.delete(requestId);
        agent.inFlightCount = Math.max(0, agent.inFlightCount - 1);
        server.log.warn({
          event: "gateway_dispatch_timeout",
          orgId: parsed.data.organizationId,
          agentId: agent.agentId,
          requestId,
          timeoutMs,
        });
        const result: GatewayDispatchResponse = { status: "failed", error: "NODE_EXECUTION_TIMEOUT" };
        void resultsStore.set(requestId, result, resultsTtlSec);
        resolve(result);
      }, timeoutMs);

      pendingByRequestId.set(requestId, {
        resolve,
        timeout,
        organizationId: parsed.data.organizationId,
        agentId: agent.agentId,
      });

      agent.lastUsedAtMs = Date.now();
      try {
        agent.ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeout);
        pendingByRequestId.delete(requestId);
        agent.inFlightCount = Math.max(0, agent.inFlightCount - 1);
        removeAgent(agent.organizationId, agent.agentId);
        server.log.warn(
          {
            event: "gateway_dispatch_ws_send_failed",
            orgId: parsed.data.organizationId,
            agentId: agent.agentId,
            requestId,
            reasonCode: error instanceof Error ? error.message : "WS_SEND_FAILED",
          },
          "gateway dispatch ws send failed"
        );
        const result: GatewayDispatchResponse = { status: "failed", error: "AGENT_DISCONNECTED" };
        void resultsStore.set(requestId, result, resultsTtlSec);
        resolve(result);
      }
    });

    return reply.status(200).send(response);
  });

  server.get("/internal/v1/results/:requestId", async (request, reply) => {
    const token = request.headers["x-gateway-token"];
    if (typeof token !== "string" || token.length === 0 || token !== serviceToken) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "Invalid gateway service token" });
    }

    const requestId = (request.params as { requestId?: string }).requestId;
    if (!requestId || requestId.length < 10) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid requestId" });
    }

    const result = await resultsStore.get(requestId);
    if (!result) {
      return reply.status(404).send({ code: "RESULT_NOT_READY", message: "Result not ready" });
    }
    return reply.status(200).send(result);
  });

  server.get("/healthz", async () => ({ ok: true }));

  const wss = new WebSocketServer({ noServer: true });
  function wireAgentSocket(ws: WebSocket, agent: ConnectedAgent) {
    ws.on("message", async (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const message = safeJsonParse(raw);
      if (!message || typeof message !== "object") {
        return;
      }

      const type = (message as { type?: unknown }).type;
      if (type === "hello") {
        const parsed = z
          .object({
            type: z.literal("hello"),
            agentVersion: z.string().min(1),
            name: z.string().min(1).max(120),
            capabilities: z.record(z.string(), z.unknown()).optional(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayAgentHelloMessage };

        agent.lastSeenAtMs = Date.now();
        agent.name = parsed.success ? parsed.data?.name ?? null : null;
        agent.agentVersion = parsed.success ? parsed.data?.agentVersion ?? null : null;
        agent.capabilities =
          parsed.success ? (parsed.data?.capabilities as Record<string, unknown> | undefined) ?? null : null;

        await touchAgent(agent.organizationId, agent.agentId);
        return;
      }

      if (type === "ping") {
        const parsed = z.object({ type: z.literal("ping"), ts: z.number() }).safeParse(message) as {
          success: boolean;
          data?: GatewayAgentPingMessage;
        };
        agent.lastSeenAtMs = Date.now();
        await touchAgent(agent.organizationId, agent.agentId);
        const pong = { type: "pong", ts: parsed.success ? parsed.data?.ts ?? Date.now() : Date.now() };
        ws.send(JSON.stringify(pong));
        return;
      }

      if (type === "execute_result") {
        const parsed = z
          .object({
            type: z.literal("execute_result"),
            requestId: z.string().min(1),
            status: z.enum(["succeeded", "failed"]),
            output: z.unknown().optional(),
            error: z.string().min(1).optional(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayAgentExecuteResultMessage };

        if (!parsed.success || !parsed.data) {
          return;
        }

        agent.lastSeenAtMs = Date.now();
        await touchAgent(agent.organizationId, agent.agentId);

        const pending = pendingByRequestId.get(parsed.data.requestId);
        const result: GatewayDispatchResponse = {
          status: parsed.data.status,
          ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
          ...(parsed.data.error ? { error: parsed.data.error } : {}),
        };
        await resultsStore.set(parsed.data.requestId, result, resultsTtlSec);

        if (!pending) {
          server.log.info({
            event: "gateway_orphan_result_stored",
            orgId: agent.organizationId,
            agentId: agent.agentId,
            requestId: parsed.data.requestId,
          });
          return;
        }

        agent.inFlightCount = Math.max(0, agent.inFlightCount - 1);
        clearTimeout(pending.timeout);
        pendingByRequestId.delete(parsed.data.requestId);
        pending.resolve(result);
        return;
      }
    });

    ws.on("close", () => {
      removeAgent(agent.organizationId, agent.agentId);
      server.log.info({ event: "gateway_agent_disconnected", orgId: agent.organizationId, agentId: agent.agentId });
    });
  }

  server.server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== wsPath) {
      socket.destroy();
      return;
    }

    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      socket.destroy();
      return;
    }

    const orgId = parseOrgIdPrefix(token);
    if (!orgId) {
      socket.destroy();
      return;
    }

    const tokenHash = sha256Hex(token);

    const agentRow = await withTenantContext(pool, { organizationId: orgId }, async (db) =>
      getOrganizationAgentByTokenHash(db, { organizationId: orgId, tokenHash })
    );

    if (!agentRow || agentRow.revokedAt) {
      socket.destroy();
      return;
    }

    const agent: ConnectedAgent = {
      ws: null as unknown as WebSocket,
      organizationId: orgId,
      agentId: agentRow.id,
      tokenHash,
      lastSeenAtMs: Date.now(),
      lastUsedAtMs: 0,
      inFlightCount: 0,
      capabilities:
        agentRow.capabilities && typeof agentRow.capabilities === "object"
          ? (agentRow.capabilities as Record<string, unknown>)
          : null,
      name: agentRow.name ?? null,
      agentVersion: null,
    };

    wss.handleUpgrade(req, socket, head, (ws) => {
      agent.ws = ws;
      const list = agentsByOrg.get(orgId) ?? [];
      list.push(agent);
      agentsByOrg.set(orgId, list);
      void touchAgent(orgId, agent.agentId);
      server.log.info({ event: "gateway_agent_connected", orgId, agentId: agent.agentId });
      wireAgentSocket(ws, agent);
    });
  });

  server.addHook("onClose", async () => {
    wss.close();
    for (const pending of pendingByRequestId.values()) {
      clearTimeout(pending.timeout);
      pending.resolve({ status: "failed", error: "GATEWAY_SHUTDOWN" });
    }
    pendingByRequestId.clear();
    await resultsStore.close();
    if (ownsPool) {
      await pool.end();
    }
  });

  return server;
}
