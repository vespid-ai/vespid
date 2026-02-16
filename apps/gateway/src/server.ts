import crypto from "node:crypto";
import type { Socket } from "node:net";
import Fastify from "fastify";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import {
  createPool,
  withTenantContext,
  getOrganizationAgentByTokenHash,
  touchOrganizationAgentLastSeen,
  getMembership,
  getAuthSessionByRefreshTokenHash,
  isAuthSessionActive,
  getAgentSessionById,
  listAgentSessionEventsTail,
  appendAgentSessionEvent,
  setAgentSessionPinnedAgent,
  getAgentToolsetById,
  getOrganizationById,
} from "@vespid/db";
import type {
  GatewayAgentHelloMessage,
  GatewayAgentPingMessage,
  GatewayAgentExecuteReceivedMessage,
  GatewayAgentExecuteResultMessage,
  GatewayAgentExecuteEventMessage,
  GatewayServerExecuteMessage,
  GatewayServerExecuteAckMessage,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
} from "@vespid/shared";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";
import { verifyAuthToken } from "@vespid/shared/auth";
import type { WorkflowContinuationJobPayload } from "@vespid/shared";
import { createInMemoryResultsStore, createRedisResultsStore, type ResultsStore } from "./results-store.js";

type ConnectedAgent = {
  ws: WebSocket;
  organizationId: string;
  agentId: string;
  tokenHash: string;
  lastSeenAtMs: number;
  lastUsedAtMs: number;
  capabilities: Record<string, unknown> | null;
  authoritativeTags: Set<string>;
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
  const kinds = kindsList.length > 0 ? kindsList : ["connector.action", "agent.execute", "agent.run"];

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
  kind: z.enum(["connector.action", "agent.execute", "agent.run"]),
  payload: z.unknown(),
  secret: z.string().min(1).optional(),
  selectorTag: z.string().min(1).max(64).optional(),
  selectorAgentId: z.string().uuid().optional(),
  selectorGroup: z.string().min(1).max(64).optional(),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
});

const gatewayDispatchMetaSchema = z.object({
  organizationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  runId: z.string().uuid(),
  requestId: z.string().min(1),
  attemptCount: z.number().int().min(1),
});

function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const port = Number(url.port || 6379);
  const host = url.hostname || "127.0.0.1";
  const password = url.password ? decodeURIComponent(url.password) : null;
  const username = url.username ? decodeURIComponent(url.username) : null;
  const tls = url.protocol === "rediss:";
  const dbValue = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : null;

  const options: ConnectionOptions = { host, port, maxRetriesPerRequest: null };
  if (username) {
    (options as any).username = username;
  }
  if (password) {
    (options as any).password = password;
  }
  if (dbValue !== null && Number.isFinite(dbValue)) {
    (options as any).db = dbValue;
  }
  if (tls) {
    (options as any).tls = {};
  }
  return options;
}

function metaKey(requestId: string): string {
  return `gateway:meta:${requestId}`;
}

function sessionMetaKey(requestId: string): string {
  return `gateway:session-meta:${requestId}`;
}

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

function safeWsSend(ws: WebSocket, message: unknown): boolean {
  try {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header || header.trim().length === 0) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [kRaw, ...rest] = part.trim().split("=");
    if (!kRaw) continue;
    const k = kRaw.trim();
    const v = rest.join("=").trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function b64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function hmac(content: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(content).digest("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

type RefreshTokenPayload = {
  sessionId: string;
  userId: string;
  tokenNonce: string;
  expiresAt: number;
};

function verifyRefreshToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): RefreshTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }
  const expected = hmac(encodedPayload, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(b64UrlDecode(encodedPayload)) as Partial<RefreshTokenPayload>;
    if (!payload.sessionId || !payload.userId || !payload.tokenNonce || typeof payload.expiresAt !== "number") {
      return null;
    }
    if (payload.expiresAt <= nowSec) {
      return null;
    }
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export async function buildGatewayServer(input?: {
  pool?: ReturnType<typeof createPool>;
  serviceToken?: string;
  wsPath?: string;
  clientWsPath?: string;
  resultsStore?: ResultsStore;
}) {
  if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL && !input?.resultsStore) {
    throw new Error("REDIS_URL_REQUIRED_IN_PRODUCTION");
  }

  const server = Fastify({
    disableRequestLogging: true,
    // Ensure server.close() does not hang forever on upgraded sockets in tests/dev.
    forceCloseConnections: true,
    logger: {
      level: process.env.GATEWAY_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-gateway-token']",
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
  const clientWsPath = input?.clientWsPath ?? "/ws/client";
  const staleAgentMs = Math.max(5_000, envNumber("GATEWAY_AGENT_STALE_MS", 60_000));
  const resultsTtlSec = Math.max(30, envNumber("GATEWAY_RESULTS_TTL_SEC", 15 * 60));
  const agentSelection = process.env.GATEWAY_AGENT_SELECTION ?? "least_in_flight_lru";
  const resultsStore =
    input?.resultsStore ??
    (process.env.REDIS_URL ? createRedisResultsStore(process.env.REDIS_URL) : createInMemoryResultsStore());

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? "dev-auth-secret";
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? "dev-refresh-secret";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "vespid_session";
  const githubApiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

  const redisUrl = process.env.REDIS_URL ?? null;
  const continuationQueueName = process.env.WORKFLOW_CONTINUATION_QUEUE_NAME ?? "workflow-continuations";
  const enableContinuationPush = process.env.GATEWAY_CONTINUATION_PUSH !== "0";
  const continuationQueue =
    redisUrl && enableContinuationPush
      ? new Queue<WorkflowContinuationJobPayload>(continuationQueueName, {
          connection: parseRedisConnectionOptions(redisUrl),
        })
      : null;
  const metaRedis =
    redisUrl && enableContinuationPush
      ? new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false })
      : null;

  const agentsByOrg = new Map<string, ConnectedAgent[]>();
  const rrCursorByOrg = new Map<string, number>();
  const inFlightByAgentId = new Map<string, number>();
  const pendingByRequestId = new Map<string, PendingRequest>();
  const dispatchedByRequestId = new Map<string, string>();
  const asyncTimeoutByRequestId = new Map<string, NodeJS.Timeout>();
  const metaByRequestId = new Map<string, z.infer<typeof gatewayDispatchMetaSchema>>();

  const sessionClientsBySessionId = new Map<string, Set<WebSocket>>();
  const sessionMetaByRequestId = new Map<string, { organizationId: string; sessionId: string; userId: string }>();
  const clientStateByWs = new Map<WebSocket, { organizationId: string; userId: string; joinedSessionId: string | null }>();

  const httpSockets = new Set<Socket>();
  server.server.on("connection", (socket) => {
    httpSockets.add(socket);
    socket.on("close", () => {
      httpSockets.delete(socket);
    });
  });

  function terminateSessions() {
    for (const agents of agentsByOrg.values()) {
      for (const agent of agents) {
        try {
          agent.ws.terminate();
        } catch {
          // ignore
        }
      }
    }
    agentsByOrg.clear();
    rrCursorByOrg.clear();
    inFlightByAgentId.clear();

    for (const ws of clientStateByWs.keys()) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    clientStateByWs.clear();
    sessionClientsBySessionId.clear();

    for (const socket of httpSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    httpSockets.clear();
  }

  // Fastify's close can wait on upgraded sockets; force termination before shutdown begins.
  const originalClose = server.close.bind(server);
  (server as any).close = async () => {
    terminateSessions();
    return await originalClose();
  };

  function getInFlight(agentId: string): number {
    return inFlightByAgentId.get(agentId) ?? 0;
  }

  function incInFlight(agentId: string) {
    inFlightByAgentId.set(agentId, getInFlight(agentId) + 1);
  }

  function decInFlight(agentId: string) {
    inFlightByAgentId.set(agentId, Math.max(0, getInFlight(agentId) - 1));
  }

  function selectAgent(
    orgId: string,
    required: {
      kind: string;
      connectorId?: string | null;
      selectorTag?: string | null;
      selectorAgentId?: string | null;
      selectorGroup?: string | null;
    }
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
      if (required.selectorAgentId) {
        if (agent.agentId !== required.selectorAgentId) {
          continue;
        }
      }
      if (getInFlight(agent.agentId) >= capabilities.maxInFlight) {
        continue;
      }
      if (required.kind === "connector.action" && required.connectorId && capabilities.connectors) {
        if (!capabilities.connectors.has(required.connectorId)) {
          continue;
        }
      }
      if (required.selectorTag) {
        if (!agent.authoritativeTags.has(required.selectorTag)) {
          continue;
        }
      }
      if (required.selectorGroup) {
        const key = `group:${required.selectorGroup}`;
        if (!agent.authoritativeTags.has(key)) {
          continue;
        }
      }
      fresh.push(agent);
    }

    if (fresh.length === 0) {
      agentsByOrg.delete(orgId);
      return null;
    }

    if (agentSelection === "round_robin") {
      const cursor = rrCursorByOrg.get(orgId) ?? 0;
      for (let offset = 0; offset < fresh.length; offset += 1) {
        const index = (cursor + offset) % fresh.length;
        const selected = fresh[index];
        if (!selected) {
          continue;
        }
        rrCursorByOrg.set(orgId, (index + 1) % fresh.length);
        return selected;
      }
      return null;
    }

    // Default: prefer least in-flight, then LRU.
    let best: ConnectedAgent | null = null;
    for (const agent of fresh) {
      if (
        !best ||
        getInFlight(agent.agentId) < getInFlight(best.agentId) ||
        (getInFlight(agent.agentId) === getInFlight(best.agentId) && agent.lastUsedAtMs < best.lastUsedAtMs)
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

  async function selectDispatchAgent(input: {
    organizationId: string;
    kind: "connector.action" | "agent.execute" | "agent.run";
    connectorId?: string | null;
    selectorTag?: string | null;
    selectorAgentId?: string | null;
    selectorGroup?: string | null;
    requestId: string;
  }): Promise<ConnectedAgent | null> {
    let agent: ConnectedAgent | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const selected = selectAgent(input.organizationId, {
        kind: input.kind,
        connectorId: input.connectorId ?? null,
        selectorTag: input.selectorTag ?? null,
        selectorAgentId: input.selectorAgentId ?? null,
        selectorGroup: input.selectorGroup ?? null,
      });
      if (!selected) {
        agent = null;
        break;
      }

      if (selected.ws.readyState !== WebSocket.OPEN) {
        removeAgent(selected.organizationId, selected.agentId);
        server.log.warn({
          event: "gateway_agent_disconnected",
          orgId: selected.organizationId,
          agentId: selected.agentId,
          reasonCode: "WS_NOT_OPEN",
        });
        continue;
      }

      const row = await withTenantContext(pool, { organizationId: selected.organizationId }, async (db) =>
        getOrganizationAgentByTokenHash(db, { organizationId: selected.organizationId, tokenHash: selected.tokenHash })
      );
      if (!row || row.revokedAt) {
        removeAgent(selected.organizationId, selected.agentId);
        server.log.warn({
          event: "gateway_agent_revoked_skipped",
          orgId: selected.organizationId,
          agentId: selected.agentId,
          requestId: input.requestId,
        });
        continue;
      }

      // Control-plane tags are authoritative. Refresh cached tags from DB so changes apply without reconnect.
      selected.authoritativeTags = new Set((row.tags ?? []).filter((tag): tag is string => typeof tag === "string"));
      if (input.selectorTag && !selected.authoritativeTags.has(input.selectorTag)) {
        continue;
      }
      if (input.selectorGroup) {
        const key = `group:${input.selectorGroup}`;
        if (!selected.authoritativeTags.has(key)) {
          continue;
        }
      }

      agent = selected;
      break;
    }
    return agent;
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

    const agent = await selectDispatchAgent({
      organizationId: parsed.data.organizationId,
      kind: parsed.data.kind,
      connectorId,
      selectorTag: parsed.data.selectorTag ?? null,
      selectorAgentId: parsed.data.selectorAgentId ?? null,
      selectorGroup: parsed.data.selectorGroup ?? null,
      requestId,
    });

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

    incInFlight(agent.agentId);
    dispatchedByRequestId.set(requestId, agent.agentId);
    const response = await new Promise<GatewayDispatchResponse>((resolve) => {
      const timeout = setTimeout(() => {
        pendingByRequestId.delete(requestId);
        dispatchedByRequestId.delete(requestId);
        decInFlight(agent.agentId);
        server.log.warn({
          event: "gateway_dispatch_timeout",
          orgId: parsed.data.organizationId,
          agentId: agent.agentId,
          requestId,
          timeoutMs,
        });
        const result: GatewayDispatchResponse = { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout };
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
        dispatchedByRequestId.delete(requestId);
        decInFlight(agent.agentId);
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
        const result: GatewayDispatchResponse = { status: "failed", error: REMOTE_EXEC_ERROR.AgentDisconnected };
        void resultsStore.set(requestId, result, resultsTtlSec);
        resolve(result);
      }
    });

    return reply.status(200).send(response);
  });

  server.post("/internal/v1/dispatch-async", async (request, reply) => {
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
    let connectorId: string | null = null;
    if (parsed.data.kind === "connector.action") {
      const payloadParsed = connectorActionDispatchPayloadSchema.safeParse(parsed.data.payload);
      if (!payloadParsed.success) {
        return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid connector.action payload" });
      }
      connectorId = payloadParsed.data.connectorId;
    }

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
        async: true,
      },
      "gateway dispatch received (async)"
    );

    // If we already have a cached result, do not re-dispatch.
    const cached = await resultsStore.get(requestId);
    if (cached) {
      return reply.status(200).send({ requestId, dispatched: false, cached: true });
    }

    const agent = await selectDispatchAgent({
      organizationId: parsed.data.organizationId,
      kind: parsed.data.kind,
      connectorId,
      selectorTag: parsed.data.selectorTag ?? null,
      selectorAgentId: parsed.data.selectorAgentId ?? null,
      selectorGroup: parsed.data.selectorGroup ?? null,
      requestId,
    });

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

    const meta = {
      organizationId: parsed.data.organizationId,
      workflowId: parsed.data.workflowId,
      runId: parsed.data.runId,
      requestId,
      attemptCount: parsed.data.attemptCount,
    };
    metaByRequestId.set(requestId, meta);
    setTimeout(() => {
      metaByRequestId.delete(requestId);
    }, resultsTtlSec * 1000).unref?.();

    if (metaRedis && continuationQueue) {
      try {
        await metaRedis.set(metaKey(requestId), JSON.stringify(meta), "EX", resultsTtlSec);
      } catch (error) {
        // Best-effort; if meta is missing, worker polling fallback will apply results.
        server.log.warn({
          event: "gateway_dispatch_meta_set_failed",
          orgId: parsed.data.organizationId,
          agentId: agent.agentId,
          requestId,
          reasonCode: error instanceof Error ? error.message : "REDIS_SET_FAILED",
        });
      }
    }

    agent.lastUsedAtMs = Date.now();
    incInFlight(agent.agentId);
    dispatchedByRequestId.set(requestId, agent.agentId);

    try {
      agent.ws.send(JSON.stringify(message));
    } catch (error) {
      if (metaRedis && continuationQueue) {
        try {
          await metaRedis.del(metaKey(requestId));
        } catch {
          // ignore
        }
      }
      dispatchedByRequestId.delete(requestId);
      decInFlight(agent.agentId);
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
      return reply.status(503).send({ code: "NO_AGENT_AVAILABLE", message: "No node-agent is connected for this org" });
    }

    const timeout = setTimeout(() => {
      const dispatchedAgentId = dispatchedByRequestId.get(requestId);
      if (!dispatchedAgentId) {
        return;
      }
      dispatchedByRequestId.delete(requestId);
      asyncTimeoutByRequestId.delete(requestId);
      decInFlight(dispatchedAgentId);

      server.log.warn({
        event: "gateway_dispatch_timeout",
        orgId: parsed.data.organizationId,
        agentId: dispatchedAgentId,
        requestId,
        timeoutMs,
        async: true,
      });

      void (async () => {
        const existing = await resultsStore.get(requestId);
        if (existing) {
          return;
        }
        await resultsStore.set(
          requestId,
          { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout },
          resultsTtlSec
        );
      })();
    }, timeoutMs);
    asyncTimeoutByRequestId.set(requestId, timeout);

    return reply.status(201).send({ requestId, dispatched: true });
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

  function mapAgentEventKindToSessionEventType(kind: string): string {
    if (kind === "agent.assistant_delta") return "agent_delta";
    if (kind === "agent.assistant_message") return "agent_message";
    if (kind === "agent.tool_call") return "tool_call";
    if (kind === "agent.tool_result") return "tool_result";
    if (kind === "agent.final") return "agent_final";
    if (kind === "toolset_skills_applied") return "agent_message";
    return "agent_message";
  }

  function summarizeJson(value: unknown, maxChars: number): unknown {
    if (value === null || value === undefined) {
      return null;
    }
    try {
      const json = JSON.stringify(value);
      if (json.length <= maxChars) {
        return value;
      }
      return { truncated: true, preview: json.slice(0, maxChars), originalLength: json.length };
    } catch {
      return { truncated: true, preview: String(value).slice(0, maxChars), originalLength: null };
    }
  }

  function broadcastSessionEvent(sessionId: string, message: unknown) {
    const set = sessionClientsBySessionId.get(sessionId);
    if (!set || set.size === 0) {
      return;
    }
    for (const ws of set) {
      safeWsSend(ws, message);
    }
  }

  async function resolveSessionMeta(requestId: string): Promise<{ organizationId: string; sessionId: string; userId: string } | null> {
    const cached = sessionMetaByRequestId.get(requestId) ?? null;
    if (cached) {
      return cached;
    }
    if (!metaRedis) {
      return null;
    }
    try {
      const raw = await metaRedis.get(sessionMetaKey(requestId));
      if (!raw) {
        return null;
      }
      const parsed = z
        .object({ organizationId: z.string().uuid(), sessionId: z.string().uuid(), userId: z.string().uuid() })
        .safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) {
        return null;
      }
      sessionMetaByRequestId.set(requestId, parsed.data);
      setTimeout(() => sessionMetaByRequestId.delete(requestId), resultsTtlSec * 1000).unref?.();
      return parsed.data;
    } catch {
      return null;
    }
  }

  async function appendAndBroadcastSessionEvent(input: {
    organizationId: string;
    sessionId: string;
    eventType: string;
    level: "info" | "warn" | "error";
    payload?: unknown;
  }) {
    const row = await withTenantContext(pool, { organizationId: input.organizationId }, async (db) =>
      appendAgentSessionEvent(db, {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        eventType: input.eventType,
        level: input.level,
        payload: input.payload ?? null,
      })
    );
    broadcastSessionEvent(input.sessionId, {
      type: "session_event",
      sessionId: input.sessionId,
      seq: row.seq,
      eventType: row.eventType,
      level: row.level,
      payload: row.payload ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  const wssClient = new WebSocketServer({ noServer: true });
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

      if (type === "execute_received") {
        const parsed = z
          .object({
            type: z.literal("execute_received"),
            requestId: z.string().min(1),
          })
          .safeParse(message) as { success: boolean; data?: GatewayAgentExecuteReceivedMessage };

        if (!parsed.success || !parsed.data) {
          return;
        }

        agent.lastSeenAtMs = Date.now();
        await touchAgent(agent.organizationId, agent.agentId);
        server.log.info({
          event: "gateway_execute_received",
          orgId: agent.organizationId,
          agentId: agent.agentId,
          requestId: parsed.data.requestId,
        });
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
        server.log.info({
          event: "gateway_execute_result_received",
          orgId: agent.organizationId,
          agentId: agent.agentId,
          requestId: parsed.data.requestId,
          status: parsed.data.status,
        });

        // If this requestId belongs to an interactive session, persist and broadcast a terminal event.
        try {
          const sessionMeta = await resolveSessionMeta(parsed.data.requestId);
          if (sessionMeta) {
            await appendAndBroadcastSessionEvent({
              organizationId: sessionMeta.organizationId,
              sessionId: sessionMeta.sessionId,
              eventType: parsed.data.status === "succeeded" ? "agent_final" : "error",
              level: parsed.data.status === "succeeded" ? "info" : "error",
              payload: {
                requestId: parsed.data.requestId,
                status: parsed.data.status,
                ...(parsed.data.output !== undefined ? { output: summarizeJson(parsed.data.output, 20_000) } : {}),
                ...(parsed.data.error ? { error: parsed.data.error } : {}),
              },
            });
            if (metaRedis) {
              await metaRedis.del(sessionMetaKey(parsed.data.requestId));
            }
            sessionMetaByRequestId.delete(parsed.data.requestId);
          }
        } catch {
          // Best-effort: session event persistence should not break gateway result handling.
        }

        // Ack so agents can safely garbage-collect buffered results across reconnects.
        const ack: GatewayServerExecuteAckMessage = { type: "execute_ack", requestId: parsed.data.requestId };
        safeWsSend(ws, ack);

        if (continuationQueue) {
          try {
            let meta: z.infer<typeof gatewayDispatchMetaSchema> | null = null;

            if (metaRedis) {
              const raw = await metaRedis.get(metaKey(parsed.data.requestId));
              if (raw) {
                const parsedMeta = gatewayDispatchMetaSchema.safeParse(JSON.parse(raw) as unknown);
                if (parsedMeta.success) {
                  meta = parsedMeta.data;
                } else {
                  server.log.warn({
                    event: "gateway_result_meta_invalid",
                    orgId: agent.organizationId,
                    agentId: agent.agentId,
                    requestId: parsed.data.requestId,
                  });
                }
              }
            }

            if (!meta) {
              meta = metaByRequestId.get(parsed.data.requestId) ?? null;
              if (meta) {
                server.log.info({
                  event: "gateway_result_meta_fallback_memory",
                  orgId: agent.organizationId,
                  agentId: agent.agentId,
                  requestId: parsed.data.requestId,
                });
              } else {
                server.log.info({
                  event: "gateway_result_meta_missing",
                  orgId: agent.organizationId,
                  agentId: agent.agentId,
                  requestId: parsed.data.requestId,
                });
              }
            }

            if (meta) {
              const payload: WorkflowContinuationJobPayload = {
                type: "remote.apply",
                organizationId: meta.organizationId,
                workflowId: meta.workflowId,
                runId: meta.runId,
                requestId: meta.requestId,
                attemptCount: meta.attemptCount,
                result,
              };
              const requestHash = sha256Hex(parsed.data.requestId);
              await continuationQueue.add("continuation", payload, {
                jobId: `apply-${requestHash}`,
                removeOnComplete: 1000,
                removeOnFail: 1000,
              });
              server.log.info({
                event: "gateway_continuation_apply_enqueued",
                orgId: agent.organizationId,
                agentId: agent.agentId,
                requestId: parsed.data.requestId,
              });
              metaByRequestId.delete(parsed.data.requestId);
              if (metaRedis) {
                await metaRedis.del(metaKey(parsed.data.requestId));
              }
            }
          } catch (error) {
            // Best-effort; worker polling fallback remains.
            server.log.warn({
              event: "gateway_continuation_apply_enqueue_failed",
              orgId: agent.organizationId,
              agentId: agent.agentId,
              requestId: parsed.data.requestId,
              reasonCode: error instanceof Error ? error.message : "APPLY_ENQUEUE_FAILED",
            });
          }
        }

        const asyncTimeout = asyncTimeoutByRequestId.get(parsed.data.requestId);
        if (asyncTimeout) {
          clearTimeout(asyncTimeout);
          asyncTimeoutByRequestId.delete(parsed.data.requestId);
        }

        const dispatchedAgentId = dispatchedByRequestId.get(parsed.data.requestId);
        if (dispatchedAgentId) {
          dispatchedByRequestId.delete(parsed.data.requestId);
          decInFlight(dispatchedAgentId);
        }

        if (!pending) {
          server.log.info({
            event: "gateway_orphan_result_stored",
            orgId: agent.organizationId,
            agentId: agent.agentId,
            requestId: parsed.data.requestId,
          });
          return;
        }

        clearTimeout(pending.timeout);
        pendingByRequestId.delete(parsed.data.requestId);
        pending.resolve(result);
        return;
      }

      if (type === "execute_event") {
        const parsed = z
          .object({
            type: z.literal("execute_event"),
            requestId: z.string().min(1),
            event: z.object({
              seq: z.number().int().min(0),
              ts: z.number(),
              kind: z.string().min(1).max(200),
              level: z.enum(["info", "warn", "error"]),
              message: z.string().min(1).max(500).optional(),
              payload: z.unknown().optional(),
            }),
          })
          .safeParse(message) as { success: boolean; data?: GatewayAgentExecuteEventMessage };

        if (!parsed.success || !parsed.data) {
          return;
        }

        agent.lastSeenAtMs = Date.now();
        await touchAgent(agent.organizationId, agent.agentId);

        // Session streaming: persist/broadcast agent execution events when the requestId belongs to a session.
        try {
          const sessionMeta = await resolveSessionMeta(parsed.data.requestId);
          if (sessionMeta) {
            await appendAndBroadcastSessionEvent({
              organizationId: sessionMeta.organizationId,
              sessionId: sessionMeta.sessionId,
              eventType: mapAgentEventKindToSessionEventType(parsed.data.event.kind),
              level: parsed.data.event.level,
              payload: {
                requestId: parsed.data.requestId,
                kind: parsed.data.event.kind,
                ...(parsed.data.event.message ? { message: parsed.data.event.message } : {}),
                ...(parsed.data.event.payload !== undefined ? { payload: summarizeJson(parsed.data.event.payload, 20_000) } : {}),
              },
            });
          }
        } catch {
          // ignore
        }

        if (!continuationQueue) {
          return;
        }

        try {
          let meta: z.infer<typeof gatewayDispatchMetaSchema> | null = null;
          if (metaRedis) {
            const raw = await metaRedis.get(metaKey(parsed.data.requestId));
            if (raw) {
              const parsedMeta = gatewayDispatchMetaSchema.safeParse(JSON.parse(raw) as unknown);
              if (parsedMeta.success) {
                meta = parsedMeta.data;
              } else {
                server.log.warn({
                  event: "gateway_event_meta_invalid",
                  orgId: agent.organizationId,
                  agentId: agent.agentId,
                  requestId: parsed.data.requestId,
                });
              }
            }
          }
          if (!meta) {
            meta = metaByRequestId.get(parsed.data.requestId) ?? null;
          }
          if (!meta) {
            server.log.info({
              event: "gateway_event_meta_missing",
              orgId: agent.organizationId,
              agentId: agent.agentId,
              requestId: parsed.data.requestId,
            });
            return;
          }

          const payload: WorkflowContinuationJobPayload = {
            type: "remote.event",
            organizationId: meta.organizationId,
            workflowId: meta.workflowId,
            runId: meta.runId,
            requestId: meta.requestId,
            attemptCount: meta.attemptCount,
            event: parsed.data.event,
          };

          const requestHash = sha256Hex(parsed.data.requestId);
          await continuationQueue.add("continuation", payload, {
            jobId: `event-${requestHash}-${parsed.data.event.seq}`,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          });
          server.log.info({
            event: "gateway_continuation_event_enqueued",
            orgId: agent.organizationId,
            agentId: agent.agentId,
            requestId: parsed.data.requestId,
            seq: parsed.data.event.seq,
          });
        } catch {
          // Best-effort: streaming is optional.
          server.log.warn({
            event: "gateway_continuation_event_enqueue_failed",
            orgId: agent.organizationId,
            agentId: agent.agentId,
            requestId: parsed.data.requestId,
          });
        }

        return;
      }
    });

    ws.on("close", () => {
      removeAgent(agent.organizationId, agent.agentId);
      server.log.info({ event: "gateway_agent_disconnected", orgId: agent.organizationId, agentId: agent.agentId });
    });
  }

  function safeJsonStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return "null";
    }
  }

  function parseUuid(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = z.string().uuid().safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async function resolveClientAuth(input: { headers: Record<string, unknown> }) {
    const bearer = parseBearerToken(input.headers["authorization"]);
    if (bearer) {
      const claims = verifyAuthToken(bearer, authSecret);
      if (!claims) {
        return null;
      }
      return { userId: claims.userId, email: claims.email, sessionId: claims.sessionId };
    }

    const cookies = parseCookies(typeof input.headers["cookie"] === "string" ? input.headers["cookie"] : undefined);
    const refreshToken = cookies[sessionCookieName];
    if (!refreshToken) {
      return null;
    }
    const payload = verifyRefreshToken(refreshToken, refreshSecret);
    if (!payload) {
      return null;
    }

    // Validate that the refresh token corresponds to an active DB session.
    const refreshHash = sha256Hex(refreshToken);
    try {
      const sessionRow = await withTenantContext(pool, { userId: payload.userId }, async (db) =>
        getAuthSessionByRefreshTokenHash(db, refreshHash)
      );
      if (!sessionRow) {
        return null;
      }
      if (sessionRow.id !== payload.sessionId) {
        return null;
      }
      if (sessionRow.userId !== payload.userId) {
        return null;
      }
      if (!isAuthSessionActive({ expiresAt: sessionRow.expiresAt, revokedAt: sessionRow.revokedAt })) {
        return null;
      }
    } catch {
      return null;
    }

    return { userId: payload.userId, email: "", sessionId: payload.sessionId };
  }

  function addClientToSession(sessionId: string, ws: WebSocket) {
    const set = sessionClientsBySessionId.get(sessionId) ?? new Set<WebSocket>();
    set.add(ws);
    sessionClientsBySessionId.set(sessionId, set);
  }

  function removeClientFromSession(sessionId: string, ws: WebSocket) {
    const set = sessionClientsBySessionId.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      sessionClientsBySessionId.delete(sessionId);
    }
  }

  async function joinSessionForClient(input: { ws: WebSocket; organizationId: string; userId: string; sessionId: string }) {
    const existing = await withTenantContext(pool, { organizationId: input.organizationId }, async (db) =>
      getAgentSessionById(db, { organizationId: input.organizationId, sessionId: input.sessionId })
    );
    if (!existing) {
      safeWsSend(input.ws, { type: "session_error", sessionId: input.sessionId, code: "SESSION_NOT_FOUND", message: "Session not found" });
      return;
    }

    const state = clientStateByWs.get(input.ws);
    if (state?.joinedSessionId) {
      removeClientFromSession(state.joinedSessionId, input.ws);
    }
    clientStateByWs.set(input.ws, { organizationId: input.organizationId, userId: input.userId, joinedSessionId: input.sessionId });
    addClientToSession(input.sessionId, input.ws);

    // Send tail events for quick hydration.
    const tail = await withTenantContext(pool, { organizationId: input.organizationId }, async (db) =>
      listAgentSessionEventsTail(db, { organizationId: input.organizationId, sessionId: input.sessionId, limit: 200 })
    );
    for (const row of tail) {
      safeWsSend(input.ws, {
        type: "session_event",
        sessionId: input.sessionId,
        seq: row.seq,
        eventType: row.eventType,
        level: row.level,
        payload: row.payload ?? null,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  function normalizeLimits(raw: unknown): {
    maxTurns: number;
    maxToolCalls: number;
    timeoutMs: number;
    maxOutputChars: number;
    maxRuntimeChars: number;
  } {
    const base = { maxTurns: 8, maxToolCalls: 20, timeoutMs: 60_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return base;
    }
    const r: any = raw;
    const out = { ...base };
    if (typeof r.maxTurns === "number" && Number.isFinite(r.maxTurns)) out.maxTurns = Math.max(1, Math.min(64, Math.floor(r.maxTurns)));
    if (typeof r.maxToolCalls === "number" && Number.isFinite(r.maxToolCalls)) out.maxToolCalls = Math.max(0, Math.min(200, Math.floor(r.maxToolCalls)));
    if (typeof r.timeoutMs === "number" && Number.isFinite(r.timeoutMs)) out.timeoutMs = Math.max(1000, Math.min(10 * 60 * 1000, Math.floor(r.timeoutMs)));
    if (typeof r.maxOutputChars === "number" && Number.isFinite(r.maxOutputChars)) out.maxOutputChars = Math.max(256, Math.min(1_000_000, Math.floor(r.maxOutputChars)));
    if (typeof r.maxRuntimeChars === "number" && Number.isFinite(r.maxRuntimeChars)) out.maxRuntimeChars = Math.max(1024, Math.min(2_000_000, Math.floor(r.maxRuntimeChars)));
    return out;
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
      // Keep other events as structured steps so the node can reason about them if needed.
      steps.push({ type: e.eventType, level: e.level, payload: e.payload ?? null });
    }
    return steps;
  }

  function wireClientSocket(ws: WebSocket, context: { organizationId: string; userId: string }) {
    clientStateByWs.set(ws, { organizationId: context.organizationId, userId: context.userId, joinedSessionId: null });

    ws.on("message", async (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const message = safeJsonParse(raw);
      if (!message || typeof message !== "object") {
        return;
      }
      const type = (message as any).type;
      if (type === "client_hello") {
        server.log.info({ event: "gateway_client_connected", orgId: context.organizationId, userId: context.userId });
        return;
      }

      if (type === "session_join") {
        const parsed = z.object({ type: z.literal("session_join"), sessionId: z.string().uuid() }).safeParse(message);
        if (!parsed.success) {
          safeWsSend(ws, { type: "session_error", code: "BAD_REQUEST", message: "Invalid session_join payload" });
          return;
        }
        await joinSessionForClient({ ws, organizationId: context.organizationId, userId: context.userId, sessionId: parsed.data.sessionId });
        return;
      }

      if (type === "session_reset_agent") {
        const parsed = z.object({ type: z.literal("session_reset_agent"), sessionId: z.string().uuid() }).safeParse(message);
        if (!parsed.success) {
          safeWsSend(ws, { type: "session_error", code: "BAD_REQUEST", message: "Invalid session_reset_agent payload" });
          return;
        }
        await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          setAgentSessionPinnedAgent(db, { organizationId: context.organizationId, sessionId: parsed.data.sessionId, pinnedAgentId: null })
        );
        await appendAndBroadcastSessionEvent({
          organizationId: context.organizationId,
          sessionId: parsed.data.sessionId,
          eventType: "agent_selected",
          level: "info",
          payload: { pinnedAgentId: null },
        });
        return;
      }

      if (type === "session_send") {
        const parsed = z
          .object({
            type: z.literal("session_send"),
            sessionId: z.string().uuid(),
            message: z.string().min(1).max(50_000),
            idempotencyKey: z.string().min(1).max(80).optional(),
          })
          .safeParse(message);
        if (!parsed.success) {
          safeWsSend(ws, { type: "session_error", code: "BAD_REQUEST", message: "Invalid session_send payload" });
          return;
        }

        const session = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          getAgentSessionById(db, { organizationId: context.organizationId, sessionId: parsed.data.sessionId })
        );
        if (!session) {
          safeWsSend(ws, { type: "session_error", sessionId: parsed.data.sessionId, code: "SESSION_NOT_FOUND", message: "Session not found" });
          return;
        }

        // Persist and broadcast the user message.
        const userEvent = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          appendAgentSessionEvent(db, {
            organizationId: context.organizationId,
            sessionId: parsed.data.sessionId,
            eventType: "user_message",
            level: "info",
            payload: { message: parsed.data.message },
          })
        );
        broadcastSessionEvent(parsed.data.sessionId, {
          type: "session_event",
          sessionId: parsed.data.sessionId,
          seq: userEvent.seq,
          eventType: userEvent.eventType,
          level: userEvent.level,
          payload: userEvent.payload ?? null,
          createdAt: userEvent.createdAt.toISOString(),
        });

        const attemptCount = userEvent.seq + 1;
        const requestId = `${parsed.data.sessionId}:agent:${attemptCount}`;

        // Ensure we have a pinned agent for deterministic routing.
        let pinnedAgentId = session.pinnedAgentId ?? null;
        let selectedAgent: ConnectedAgent | null = null;
        if (pinnedAgentId) {
          const list = agentsByOrg.get(context.organizationId) ?? [];
          selectedAgent = list.find((a) => a.agentId === pinnedAgentId) ?? null;
        }
        if (!selectedAgent) {
          selectedAgent = await selectDispatchAgent({
            organizationId: context.organizationId,
            kind: "agent.run",
            requestId,
            ...(session.selectorTag ? { selectorTag: session.selectorTag } : {}),
            ...(session.selectorGroup ? { selectorGroup: session.selectorGroup } : {}),
          });
          if (!selectedAgent) {
            await appendAndBroadcastSessionEvent({
              organizationId: context.organizationId,
              sessionId: parsed.data.sessionId,
              eventType: "error",
              level: "error",
              payload: { code: "NO_AGENT_AVAILABLE", message: "No node-agent is connected for this org" },
            });
            safeWsSend(ws, { type: "session_error", sessionId: parsed.data.sessionId, code: "NO_AGENT_AVAILABLE", message: "No node-agent is connected for this org" });
            return;
          }
          pinnedAgentId = selectedAgent.agentId;
          await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
            setAgentSessionPinnedAgent(db, { organizationId: context.organizationId, sessionId: parsed.data.sessionId, pinnedAgentId })
          );
          await appendAndBroadcastSessionEvent({
            organizationId: context.organizationId,
            sessionId: parsed.data.sessionId,
            eventType: "agent_selected",
            level: "info",
            payload: { pinnedAgentId, name: selectedAgent.name ?? null },
          });
        }

        // Prepare toolset payload (skills-only context; execution engines may ignore).
        let toolset: { id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null = null;
        if (session.toolsetId) {
          const loaded = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
            getAgentToolsetById(db, { organizationId: context.organizationId, toolsetId: session.toolsetId! })
          );
          if (loaded) {
            toolset = {
              id: loaded.id,
              name: loaded.name,
              mcpServers: loaded.mcpServers ?? [],
              agentSkills: loaded.agentSkills ?? [],
            };
          }
        }

        const orgRow = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          getOrganizationById(db, { organizationId: context.organizationId })
        );
        const organizationSettings = orgRow ? orgRow.settings : null;

        const tail = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          listAgentSessionEventsTail(db, { organizationId: context.organizationId, sessionId: parsed.data.sessionId, limit: 30 })
        );
        const steps = buildSessionTranscript(tail.map((e) => ({ eventType: e.eventType, payload: e.payload, level: e.level })));

        const toolsAllow = Array.isArray(session.toolsAllow) ? session.toolsAllow.filter((t) => typeof t === "string") : [];
        const limits = normalizeLimits(session.limits);

        const node = {
          id: "agent",
          type: "agent.run",
          config: {
            ...(session.toolsetId ? { toolsetId: session.toolsetId } : {}),
            llm: {
              provider: session.llmProvider,
              model: session.llmModel,
              auth: { fallbackToEnv: true },
            },
            execution: { mode: "node" },
            engine: { id: session.engineId },
            prompt: {
              ...(session.promptSystem ? { system: session.promptSystem } : {}),
              instructions: session.promptInstructions,
            },
            tools: { allow: toolsAllow, execution: "node" },
            limits,
            output: { mode: "text" },
          },
        };

        const payload = {
          nodeId: "agent",
          node,
          policyToolsAllow: toolsAllow,
          effectiveToolsAllow: toolsAllow,
          ...(toolset ? { toolset } : {}),
          runId: parsed.data.sessionId,
          workflowId: parsed.data.sessionId,
          attemptCount,
          runInput: { message: parsed.data.message },
          steps,
          organizationSettings,
          env: { githubApiBaseUrl },
          secrets: {},
        };

        // Track session meta so agent execute_event/execute_result can be persisted to agent_session_events.
        const meta = { organizationId: context.organizationId, sessionId: parsed.data.sessionId, userId: context.userId };
        sessionMetaByRequestId.set(requestId, meta);
        setTimeout(() => sessionMetaByRequestId.delete(requestId), resultsTtlSec * 1000).unref?.();
        if (metaRedis) {
          try {
            await metaRedis.set(sessionMetaKey(requestId), safeJsonStringify(meta), "EX", resultsTtlSec);
          } catch {
            // ignore
          }
        }

        const exec: GatewayServerExecuteMessage = {
          type: "execute",
          requestId,
          organizationId: context.organizationId,
          userId: context.userId,
          kind: "agent.run",
          payload,
        };

        // Best-effort: keep consistent in-flight tracking and timeouts (like internal dispatch).
        incInFlight(selectedAgent.agentId);
        dispatchedByRequestId.set(requestId, selectedAgent.agentId);

        const timeoutMs = limits.timeoutMs;
        const timeout = setTimeout(() => {
          pendingByRequestId.delete(requestId);
          dispatchedByRequestId.delete(requestId);
          decInFlight(selectedAgent!.agentId);
          void resultsStore.set(requestId, { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout }, resultsTtlSec);
          void appendAndBroadcastSessionEvent({
            organizationId: context.organizationId,
            sessionId: parsed.data.sessionId,
            eventType: "error",
            level: "error",
            payload: { requestId, code: REMOTE_EXEC_ERROR.NodeExecutionTimeout },
          });
          safeWsSend(ws, {
            type: "session_error",
            sessionId: parsed.data.sessionId,
            code: REMOTE_EXEC_ERROR.NodeExecutionTimeout,
            message: "Node execution timed out",
          });
        }, timeoutMs);

        pendingByRequestId.set(requestId, {
          resolve: () => {
            clearTimeout(timeout);
          },
          timeout,
          organizationId: context.organizationId,
          agentId: selectedAgent.agentId,
        });

        selectedAgent.lastUsedAtMs = Date.now();
        if (!safeWsSend(selectedAgent.ws, exec)) {
          clearTimeout(timeout);
          pendingByRequestId.delete(requestId);
          dispatchedByRequestId.delete(requestId);
          decInFlight(selectedAgent.agentId);
          removeAgent(selectedAgent.organizationId, selectedAgent.agentId);
          await appendAndBroadcastSessionEvent({
            organizationId: context.organizationId,
            sessionId: parsed.data.sessionId,
            eventType: "error",
            level: "error",
            payload: { requestId, code: REMOTE_EXEC_ERROR.AgentDisconnected },
          });
          safeWsSend(ws, { type: "session_error", sessionId: parsed.data.sessionId, code: "PINNED_AGENT_OFFLINE", message: "Pinned agent is offline" });
          return;
        }

        server.log.info({
          event: "gateway_session_send_received",
          orgId: context.organizationId,
          userId: context.userId,
          sessionId: parsed.data.sessionId,
          requestId,
          agentId: selectedAgent.agentId,
        });
        return;
      }
    });

    ws.on("close", () => {
      const state = clientStateByWs.get(ws);
      if (state?.joinedSessionId) {
        removeClientFromSession(state.joinedSessionId, ws);
      }
      clientStateByWs.delete(ws);
      server.log.info({ event: "gateway_client_disconnected", orgId: context.organizationId, userId: context.userId });
    });
  }

  server.server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === wsPath) {
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
        capabilities:
          agentRow.capabilities && typeof agentRow.capabilities === "object"
            ? (agentRow.capabilities as Record<string, unknown>)
            : null,
        authoritativeTags: new Set((agentRow.tags ?? []).filter((tag): tag is string => typeof tag === "string")),
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
      return;
    }

    if (url.pathname === clientWsPath) {
      const auth = await resolveClientAuth({ headers: req.headers as any });
      if (!auth) {
        socket.destroy();
        return;
      }

      const orgId =
        parseUuid(req.headers["x-org-id"]) ??
        parseUuid(url.searchParams.get("orgId")) ??
        null;

      if (!orgId) {
        socket.destroy();
        return;
      }

      const membership = await withTenantContext(pool, { organizationId: orgId }, async (db) =>
        getMembership(db, { organizationId: orgId, userId: auth.userId })
      );
      if (!membership) {
        socket.destroy();
        return;
      }

      wssClient.handleUpgrade(req, socket, head, (ws) => {
        wireClientSocket(ws, { organizationId: orgId, userId: auth.userId });
      });
      return;
    }

    socket.destroy();
  });

  server.addHook("onClose", async () => {
    terminateSessions();

    wss.close();
    wssClient.close();
    for (const timeout of asyncTimeoutByRequestId.values()) {
      clearTimeout(timeout);
    }
    asyncTimeoutByRequestId.clear();
    for (const pending of pendingByRequestId.values()) {
      clearTimeout(pending.timeout);
      pending.resolve({ status: "failed", error: REMOTE_EXEC_ERROR.GatewayShutdown });
    }
    pendingByRequestId.clear();
    if (continuationQueue) {
      const timeoutMs = 2000;
      try {
        await Promise.race([
          continuationQueue.close(),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), timeoutMs).unref?.();
          }),
        ]);
      } catch {
        // ignore
      }
    }
    if (metaRedis) {
      const timeoutMs = 2000;
      try {
        await Promise.race([
          metaRedis.quit(),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), timeoutMs).unref?.();
          }),
        ]);
      } catch {
        // ignore
      } finally {
        try {
          metaRedis.disconnect();
        } catch {
          // ignore
        }
      }
    }
    await resultsStore.close();
    if (ownsPool) {
      const timeoutMs = 2000;
      try {
        await Promise.race([
          pool.end(),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), timeoutMs).unref?.();
          }),
        ]);
      } catch {
        // ignore
      }
    }
  });

  return server;
}
