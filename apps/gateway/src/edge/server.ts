import crypto from "node:crypto";
import type { Socket } from "node:net";
import Fastify from "fastify";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";
import {
  createPool,
  withTenantContext,
  getMembership,
  getAuthSessionByRefreshTokenHash,
  isAuthSessionActive,
  getAgentSessionById,
  listAgentSessionEventsTail,
  appendAgentSessionEvent,
  getOrganizationExecutorByTokenHash,
  touchOrganizationExecutorLastSeen,
} from "@vespid/db";
import type {
  GatewayBrainSessionEventV2,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayExecutorHelloV2,
  GatewayInvokeToolV2,
  GatewayToolEventV2,
  GatewayToolResultV2,
} from "@vespid/shared";
import { REMOTE_EXEC_ERROR, verifyAuthToken } from "@vespid/shared";
import { createInMemoryResultsStore, createRedisResultsStore, type ResultsStore } from "../results-store.js";
import { executorRouteKey, replyKey, sessionEdgesKey, streamToBrain, streamToEdge } from "../bus/keys.js";
import { safeJsonParse, safeJsonStringify } from "../bus/codec.js";
import { ensureConsumerGroup, xaddJson, xreadGroupJson } from "../bus/streams.js";
import type { BrainToEdgeCommand, EdgeToBrainRequest } from "../bus/types.js";

type ConnectedExecutor = {
  ws: WebSocket;
  executorId: string;
  organizationId: string;
  tokenHash: string;
  lastSeenAtMs: number;
  name: string | null;
  labels: string[];
  maxInFlight: number;
  kinds: Array<"connector.action" | "agent.execute">;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function parseOrgIdPrefix(value: string): string | null {
  const [orgId] = value.split(".");
  if (!orgId) return null;
  const parsed = z.string().uuid().safeParse(orgId);
  return parsed.success ? parsed.data : null;
}

function safeWsSend(ws: WebSocket, message: unknown): boolean {
  try {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header || header.trim().length === 0) return {};
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
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

type RefreshTokenPayload = {
  sessionId: string;
  userId: string;
  tokenNonce: string;
  expiresAt: number;
};

function verifyRefreshToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): RefreshTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = hmac(encodedPayload, secret);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(b64UrlDecode(encodedPayload)) as Partial<RefreshTokenPayload>;
    if (!payload.sessionId || !payload.userId || !payload.tokenNonce || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= nowSec) return null;
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

async function waitForReply(redis: Redis, requestId: string, timeoutMs: number): Promise<GatewayDispatchResponse | null> {
  const key = replyKey(requestId);
  const deadline = Date.now() + Math.max(100, timeoutMs);
  let delay = 25;
  for (;;) {
    const raw = await redis.get(key);
    if (raw) {
      const parsed = safeJsonParse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as GatewayDispatchResponse;
      }
      return { status: "failed", error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(250, Math.floor(delay * 1.4));
  }
}

function parseUuid(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = z.string().uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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

export async function buildGatewayEdgeServer(input?: {
  pool?: ReturnType<typeof createPool>;
  serviceToken?: string;
  resultsStore?: ResultsStore;
  edgeId?: string;
}) {
  const server = Fastify({
    disableRequestLogging: true,
    forceCloseConnections: true,
    logger: {
      level: process.env.GATEWAY_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-gateway-token']", "secret", "*.secret"],
        censor: "[REDACTED]",
      },
    },
  });

  const pool = input?.pool ?? createPool(process.env.DATABASE_URL);
  const ownsPool = !input?.pool;

  const serviceToken = input?.serviceToken ?? process.env.GATEWAY_SERVICE_TOKEN ?? "dev-gateway-token";
  const resultsTtlSec = Math.max(30, envNumber("GATEWAY_RESULTS_TTL_SEC", 15 * 60));
  const staleExecutorMs = Math.max(5_000, envNumber("GATEWAY_AGENT_STALE_MS", 60_000));
  const redisUrl = process.env.REDIS_URL ?? null;
  if (!redisUrl) {
    throw new Error("REDIS_URL_REQUIRED");
  }

  const edgeId = input?.edgeId ?? process.env.GATEWAY_EDGE_ID ?? `edge-${crypto.randomBytes(6).toString("hex")}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });

  const resultsStore =
    input?.resultsStore ??
    (process.env.REDIS_URL ? createRedisResultsStore(process.env.REDIS_URL) : createInMemoryResultsStore());

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? "dev-auth-secret";
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? "dev-refresh-secret";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "vespid_session";

  const executorsById = new Map<string, ConnectedExecutor>();
  const pendingToolResultByRequestId = new Map<string, { executorId: string }>();

  const sessionClientsBySessionId = new Map<string, Set<WebSocket>>();
  const clientStateByWs = new Map<WebSocket, { organizationId: string; userId: string; joinedSessionId: string | null }>();

  async function touchExecutor(orgId: string, executorId: string) {
    try {
      await withTenantContext(pool, { organizationId: orgId }, async (db) => {
        await touchOrganizationExecutorLastSeen(db, { organizationId: orgId, executorId });
      });
    } catch {
      // ignore best-effort
    }
  }

  async function writeExecutorRoute(executor: ConnectedExecutor) {
    const key = executorRouteKey(executor.executorId);
    const payload = {
      edgeId,
      executorId: executor.executorId,
      organizationId: executor.organizationId,
      labels: executor.labels,
      maxInFlight: executor.maxInFlight,
      kinds: executor.kinds,
      lastSeenAtMs: executor.lastSeenAtMs,
    };
    try {
      await redis.set(key, safeJsonStringify(payload), "PX", staleExecutorMs);
    } catch {
      // ignore
    }
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
    if (set.size === 0) sessionClientsBySessionId.delete(sessionId);
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

    // Track presence for cross-edge broadcast.
    try {
      await redis.sadd(sessionEdgesKey(input.sessionId), edgeId);
      await redis.expire(sessionEdgesKey(input.sessionId), Math.max(30, Math.floor(resultsTtlSec)));
    } catch {
      // ignore
    }

    // Send tail events.
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

  async function resolveClientAuth(input: { headers: Record<string, unknown> }) {
    const bearer = parseBearerToken(input.headers["authorization"]);
    if (bearer) {
      const claims = verifyAuthToken(bearer, authSecret);
      if (!claims) return null;
      return { userId: claims.userId, email: claims.email, sessionId: claims.sessionId };
    }

    const cookies = parseCookies(typeof input.headers["cookie"] === "string" ? input.headers["cookie"] : undefined);
    const refreshToken = cookies[sessionCookieName];
    if (!refreshToken) return null;
    const payload = verifyRefreshToken(refreshToken, refreshSecret);
    if (!payload) return null;

    const refreshHash = sha256Hex(refreshToken);
    try {
      const sessionRow = await withTenantContext(pool, { userId: payload.userId }, async (db) =>
        getAuthSessionByRefreshTokenHash(db, refreshHash)
      );
      if (!sessionRow) return null;
      if (sessionRow.id !== payload.sessionId) return null;
      if (sessionRow.userId !== payload.userId) return null;
      if (!isAuthSessionActive({ expiresAt: sessionRow.expiresAt, revokedAt: sessionRow.revokedAt })) return null;
    } catch {
      return null;
    }

    return { userId: payload.userId, email: "", sessionId: payload.sessionId };
  }

  async function startEdgeCommandLoop() {
    const stream = streamToEdge(edgeId);
    const group = "edge";
    const consumer = `${edgeId}:${process.pid}`;
    await ensureConsumerGroup(redis, stream, group);

    for (;;) {
      const records = await xreadGroupJson({ redis, stream, group, consumer, count: 50, blockMs: 15_000 });
      for (const rec of records) {
        try {
          const cmd = rec.message as BrainToEdgeCommand | null;
          if (!cmd || typeof cmd !== "object") continue;

          if (cmd.type === "executor_invoke") {
            const exec = executorsById.get(cmd.executorId) ?? null;
            if (!exec) {
              // Fail fast: executor is offline.
              await redis.set(replyKey(cmd.invoke.requestId), safeJsonStringify({ status: "failed", error: REMOTE_EXEC_ERROR.NoAgentAvailable }), "EX", resultsTtlSec);
              continue;
            }
            pendingToolResultByRequestId.set(cmd.invoke.requestId, { executorId: exec.executorId });
            safeWsSend(exec.ws, cmd.invoke);
            continue;
          }

          if (cmd.type === "client_broadcast") {
            const set = sessionClientsBySessionId.get(cmd.sessionId);
            if (!set) continue;
            for (const ws of set) {
              safeWsSend(ws, cmd.event);
            }
            continue;
          }

          if (cmd.type === "workflow_reply") {
            await redis.set(replyKey(cmd.requestId), safeJsonStringify(cmd.response), "EX", resultsTtlSec);
            continue;
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
  }

  // Start edge command loop in background.
  void startEdgeCommandLoop();

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

    const cached = await resultsStore.get(requestId);
    if (cached) {
      return reply.status(200).send(cached);
    }

    const msg: EdgeToBrainRequest = { type: "workflow_dispatch", requestId, dispatch: parsed.data as unknown as GatewayDispatchRequest, async: false };
    await xaddJson(redis, streamToBrain(), msg);

    const result = await waitForReply(redis, requestId, timeoutMs);
    if (!result) {
      return reply.status(504).send({ code: "GATEWAY_TIMEOUT", message: "Gateway brain did not reply in time" });
    }
    return reply.status(200).send(result);
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
    const cached = await resultsStore.get(requestId);
    if (cached) {
      return reply.status(200).send({ requestId, dispatched: false, cached: true });
    }

    const msg: EdgeToBrainRequest = { type: "workflow_dispatch", requestId, dispatch: parsed.data as unknown as GatewayDispatchRequest, async: true };
    await xaddJson(redis, streamToBrain(), msg);
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

  server.get("/healthz", async () => ({ ok: true, edgeId }));

  function wireClientSocket(ws: WebSocket, context: { organizationId: string; userId: string }) {
    clientStateByWs.set(ws, { organizationId: context.organizationId, userId: context.userId, joinedSessionId: null });

    ws.on("message", async (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const message = safeJsonParse(raw);
      if (!message || typeof message !== "object") return;

      const type = (message as any).type;
      if (type === "session_join") {
        const parsed = z.object({ type: z.literal("session_join"), sessionId: z.string().uuid() }).safeParse(message);
        if (!parsed.success) {
          safeWsSend(ws, { type: "session_error", code: "BAD_REQUEST", message: "Invalid session_join payload" });
          return;
        }
        await joinSessionForClient({ ws, organizationId: context.organizationId, userId: context.userId, sessionId: parsed.data.sessionId });
        return;
      }

      if (type === "session_send") {
        const parsed = z
          .object({
            type: z.literal("session_send"),
            sessionId: z.string().uuid(),
            message: z.string().min(1).max(50_000),
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

        const userEvent = await withTenantContext(pool, { organizationId: context.organizationId }, async (db) =>
          appendAgentSessionEvent(db, {
            organizationId: context.organizationId,
            sessionId: parsed.data.sessionId,
            eventType: "user_message",
            level: "info",
            payload: { message: parsed.data.message },
          })
        );

        // Broadcast legacy event for hydration compatibility.
        const legacy = {
          type: "session_event",
          sessionId: parsed.data.sessionId,
          seq: userEvent.seq,
          eventType: userEvent.eventType,
          level: userEvent.level,
          payload: userEvent.payload ?? null,
          createdAt: userEvent.createdAt.toISOString(),
        };
        for (const client of sessionClientsBySessionId.get(parsed.data.sessionId) ?? []) {
          safeWsSend(client, legacy);
        }

        const requestId = `${parsed.data.sessionId}:turn:${userEvent.seq}`;
        const msg: EdgeToBrainRequest = {
          type: "session_send",
          requestId,
          organizationId: context.organizationId,
          userId: context.userId,
          sessionId: parsed.data.sessionId,
          userEventSeq: userEvent.seq,
        };
        await xaddJson(redis, streamToBrain(), msg);
        return;
      }
    });

    ws.on("close", () => {
      const state = clientStateByWs.get(ws);
      if (state?.joinedSessionId) removeClientFromSession(state.joinedSessionId, ws);
      clientStateByWs.delete(ws);
    });
  }

  const wssClient = new WebSocketServer({ noServer: true });
  const wssExec = new WebSocketServer({ noServer: true });

  function wireExecutorSocket(ws: WebSocket, executor: ConnectedExecutor) {
    ws.on("message", async (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const message = safeJsonParse(raw);
      if (!message || typeof message !== "object") return;

      const type = (message as any).type;
      if (type === "executor_hello_v2") {
        const parsed = z
          .object({
            type: z.literal("executor_hello_v2"),
            executorVersion: z.string().min(1),
            executorId: z.string().uuid(),
            pool: z.enum(["byon", "managed"]),
            organizationId: z.string().uuid().optional(),
            name: z.string().min(1).max(120).optional().nullable(),
            labels: z.array(z.string().min(1).max(64)).max(50),
            maxInFlight: z.number().int().min(1).max(200),
            kinds: z.array(z.enum(["connector.action", "agent.execute"])).min(1),
          })
          .safeParse(message) as { success: boolean; data?: GatewayExecutorHelloV2 };

        executor.lastSeenAtMs = Date.now();
        if (parsed.success && parsed.data) {
          executor.labels = parsed.data.labels ?? [];
          executor.maxInFlight = parsed.data.maxInFlight ?? 10;
          executor.kinds = parsed.data.kinds ?? ["agent.execute"];
          executor.name = parsed.data.name ?? null;
        }
        await touchExecutor(executor.organizationId, executor.executorId);
        await writeExecutorRoute(executor);
        return;
      }

      if (type === "tool_result_v2") {
        const parsed = z
          .object({
            type: z.literal("tool_result_v2"),
            requestId: z.string().min(1),
            status: z.enum(["succeeded", "failed"]),
            output: z.unknown().optional(),
            error: z.string().min(1).optional(),
            workspace: z.unknown().optional(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayToolResultV2 };
        if (!parsed.success || !parsed.data) return;

        executor.lastSeenAtMs = Date.now();
        await touchExecutor(executor.organizationId, executor.executorId);
        await writeExecutorRoute(executor);

        // Store tool result as a reply for brain awaiters.
        const payload: any = {
          status: parsed.data.status,
          ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
          ...(parsed.data.error ? { error: parsed.data.error } : {}),
          ...(parsed.data.workspace ? { workspace: parsed.data.workspace } : {}),
        };
        await redis.set(replyKey(parsed.data.requestId), safeJsonStringify(payload), "EX", resultsTtlSec);
        pendingToolResultByRequestId.delete(parsed.data.requestId);
        return;
      }

      if (type === "tool_event_v2") {
        const parsed = z
          .object({
            type: z.literal("tool_event_v2"),
            requestId: z.string().min(1),
            event: z.unknown(),
          })
          .safeParse(message) as { success: boolean; data?: GatewayToolEventV2 };
        if (!parsed.success || !parsed.data) return;
        const msg: EdgeToBrainRequest = { type: "executor_event", executorId: executor.executorId, event: parsed.data };
        await xaddJson(redis, streamToBrain(), msg);
      }
    });

    ws.on("close", () => {
      executorsById.delete(executor.executorId);
      try {
        redis.del(executorRouteKey(executor.executorId));
      } catch {
        // ignore
      }
    });
  }

  const httpSockets = new Set<Socket>();
  server.server.on("connection", (socket) => {
    httpSockets.add(socket);
    socket.on("close", () => {
      httpSockets.delete(socket);
    });
  });

  server.server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/ws/client") {
      const auth = await resolveClientAuth({ headers: req.headers as any });
      if (!auth) {
        socket.destroy();
        return;
      }

      const orgId = parseUuid(req.headers["x-org-id"]) ?? parseUuid(url.searchParams.get("orgId")) ?? null;
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

    if (url.pathname === "/ws/executor") {
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
      const row = await withTenantContext(pool, { organizationId: orgId }, async (db) =>
        getOrganizationExecutorByTokenHash(db, { organizationId: orgId, tokenHash })
      );
      if (!row || row.revokedAt) {
        socket.destroy();
        return;
      }

      const executor: ConnectedExecutor = {
        ws: null as unknown as WebSocket,
        executorId: row.id,
        organizationId: orgId,
        tokenHash,
        lastSeenAtMs: Date.now(),
        name: row.name ?? null,
        labels: Array.isArray((row as any).labels) ? ((row as any).labels as any) : [],
        maxInFlight: 10,
        kinds: ["agent.execute", "connector.action"],
      };

      wssExec.handleUpgrade(req, socket, head, (ws) => {
        executor.ws = ws;
        executorsById.set(executor.executorId, executor);
        void touchExecutor(executor.organizationId, executor.executorId);
        void writeExecutorRoute(executor);
        wireExecutorSocket(ws, executor);
      });
      return;
    }

    socket.destroy();
  });

  server.addHook("onClose", async () => {
    for (const ws of clientStateByWs.keys()) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    for (const exec of executorsById.values()) {
      try {
        exec.ws.terminate();
      } catch {
        // ignore
      }
    }
    for (const socket of httpSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
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
    if (ownsPool) {
      await pool.end();
    }
  });

  return server;
}

