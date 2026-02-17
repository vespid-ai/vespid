import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import WebSocket from "ws";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

async function canConnectRedis(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const port = Number(parsed.port || 6379);
  const host = parsed.hostname || "localhost";
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await sleep(25);
  }
  return false;
}

async function startStubExecutor(input: {
  gatewayWsUrl: string;
  executorToken: string;
  executorId: string;
  pool: "byon" | "managed";
  organizationId?: string;
  name: string;
}) {
  const ws = new WebSocket(input.gatewayWsUrl, {
    headers: {
      authorization: `Bearer ${input.executorToken}`,
    },
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "executor_hello_v2",
        executorVersion: "test-executor",
        executorId: input.executorId,
        pool: input.pool,
        ...(input.pool === "byon" && input.organizationId ? { organizationId: input.organizationId } : {}),
        name: input.name,
        labels: [],
        maxInFlight: 10,
        kinds: ["agent.run"],
      })
    );
  });

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    let msg: any = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") {
      return;
    }

    if (msg.type === "session_open") {
      ws.send(
        JSON.stringify({
          type: "session_opened",
          requestId: msg.requestId,
          sessionId: msg.sessionId,
        })
      );
      return;
    }

    if (msg.type === "session_turn") {
      ws.send(
        JSON.stringify({
          type: "turn_delta",
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          content: `(${input.pool})`,
        })
      );
      ws.send(
        JSON.stringify({
          type: "turn_final",
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          content: `reply-from-${input.pool}`,
          payload: { pool: input.pool },
        })
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  return {
    ws,
    async close() {
      await new Promise<void>((resolve) => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws.once("close", () => resolve());
        setTimeout(() => resolve(), 250).unref?.();
      });
    },
  };
}

describe("sessions node-host connectivity (integration)", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let gatewayWsUrl: string | null = null;
  let orgId: string | null = null;
  let token: string | null = null;
  let byonExecutor: Awaited<ReturnType<typeof startStubExecutor>> | null = null;
  let byonExecutorId: string | null = null;
  let managedExecutor: Awaited<ReturnType<typeof startStubExecutor>> | null = null;
  let managedExecutorId: string | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) return;
    if (!(await canConnectRedis(redisUrl))) return;

    await migrateUp(databaseUrl);

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
    process.env.GATEWAY_SERVICE_TOKEN = "ci-gateway-token";

    gateway = await buildGatewayServer();
    const address = await gateway.listen({ port: 0, host: "127.0.0.1" });
    const parsed = new URL(address);
    gatewayWsUrl = `ws://${parsed.hostname}:${parsed.port}/ws/executor`;

    process.env.GATEWAY_HTTP_URL = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
    process.env.GATEWAY_WS_URL = gatewayWsUrl;

    api = await buildServer();
    available = true;

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `sessions-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    token = (signup.json() as { session: { token: string } }).session.token;

    const me = await api.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    orgId = (me.json() as any).defaultOrgId;
    expect(typeof orgId).toBe("string");

    const pairing = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/executors/pairing-tokens`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {},
    });
    expect(pairing.statusCode).toBe(201);
    const pairingToken = (pairing.json() as any).token as string;

    const paired = await api.inject({
      method: "POST",
      url: "/v1/executors/pair",
      payload: { pairingToken, name: "stub-byon", capabilities: { kinds: ["agent.run"] } },
    });
    expect(paired.statusCode).toBe(201);
    const pairedBody = paired.json() as {
      executorId: string;
      executorToken: string;
      organizationId: string;
    };

    byonExecutorId = pairedBody.executorId;
    byonExecutor = await startStubExecutor({
      gatewayWsUrl: gatewayWsUrl!,
      executorToken: pairedBody.executorToken,
      executorId: pairedBody.executorId,
      pool: "byon",
      organizationId: pairedBody.organizationId,
      name: "stub-byon",
    });

    const issued = await api.inject({
      method: "POST",
      url: "/internal/v1/managed-executors/issue",
      headers: { "x-service-token": "ci-gateway-token" },
      payload: {
        name: "stub-managed",
        maxInFlight: 10,
        capabilities: { kinds: ["agent.run"] },
        runtimeClass: "container",
      },
    });
    expect(issued.statusCode).toBe(201);
    const issuedBody = issued.json() as {
      executorId: string;
      executorToken: string;
    };

    managedExecutorId = issuedBody.executorId;
    managedExecutor = await startStubExecutor({
      gatewayWsUrl: gatewayWsUrl!,
      executorToken: issuedBody.executorToken,
      executorId: issuedBody.executorId,
      pool: "managed",
      name: "stub-managed",
    });
  });

  afterAll(async () => {
    if (byonExecutor) await byonExecutor.close();
    if (managedExecutor) await managedExecutor.close();
    if (api) await api.close();
    if (gateway) await gateway.close();
  });

  it("pins BYON first and automatically fails over to managed pool when BYON goes offline", async () => {
    if (!available || !api || !gatewayWsUrl || !orgId || !token || !byonExecutorId || !managedExecutorId) return;

    const create = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {
        title: "Managed failover session",
        engineId: "gateway.loop.v2",
        llm: { provider: "openai", model: "gpt-4.1-mini" },
        prompt: { instructions: "Say ok." },
        tools: { allow: [] },
        executorSelector: { pool: "byon" },
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = (create.json() as any).session.id as string;

    const client = new WebSocket(`ws://${new URL(gatewayWsUrl).host}/ws/client?orgId=${encodeURIComponent(orgId)}`, {
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });

    const received: any[] = [];
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", (err) => reject(err));
    });

    client.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      try {
        received.push(JSON.parse(raw));
      } catch {
        // ignore
      }
    });

    client.send(JSON.stringify({ type: "client_hello", clientVersion: "test" }));
    client.send(JSON.stringify({ type: "session_join", sessionId }));

    client.send(JSON.stringify({ type: "session_send", sessionId, message: "hi", idempotencyKey: "k1" }));
    expect(await waitFor(() => received.some((m) => m?.type === "agent_final"), 5000)).toBe(true);

    const afterFirst = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(afterFirst.statusCode).toBe(200);
    const firstSession = (afterFirst.json() as any).session;
    expect(firstSession.pinnedExecutorPool).toBe("byon");
    expect(firstSession.pinnedExecutorId).toBe(byonExecutorId);

    if (byonExecutor) {
      await byonExecutor.close();
      byonExecutor = null;
    }

    const countBeforeSecond = received.length;
    const finalsBeforeSecond = received.filter((m) => m?.type === "agent_final").length;

    client.send(JSON.stringify({ type: "session_send", sessionId, message: "second", idempotencyKey: "k2" }));

    expect(await waitFor(() => received.filter((m) => m?.type === "agent_final").length > finalsBeforeSecond, 5000)).toBe(true);

    const secondWave = received.slice(countBeforeSecond);
    const secondErrors = secondWave.filter((m) => m?.type === "session_error");
    expect(secondErrors.length).toBe(0);
    expect(secondWave.some((m) => m?.type === "agent_final" && typeof m.content === "string" && m.content.includes("managed"))).toBe(true);
    expect(secondWave.some((m) => m?.type === "session_state" && m.pinnedExecutorPool === "managed")).toBe(true);

    const afterSecond = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(afterSecond.statusCode).toBe(200);
    const secondSession = (afterSecond.json() as any).session;
    expect(secondSession.pinnedExecutorPool).toBe("managed");
    expect(secondSession.pinnedExecutorId).toBe(managedExecutorId);

    const events = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}/events?limit=200`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(events.statusCode).toBe(200);
    const rows = (events.json() as any).events as any[];
    expect(
      rows.some(
        (e) =>
          e.eventType === "system" &&
          e.payload &&
          typeof e.payload === "object" &&
          (e.payload as any).action === "session_executor_failover" &&
          (e.payload as any).to?.pool === "managed"
      )
    ).toBe(true);

    await new Promise<void>((resolve) => {
      client.close();
      client.once("close", () => resolve());
      setTimeout(() => resolve(), 250).unref?.();
    });
  });
});
