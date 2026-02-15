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

async function startStubAgent(input: {
  gatewayWsUrl: string;
  agentToken: string;
  capabilities?: Record<string, unknown>;
}) {
  const ws = new WebSocket(input.gatewayWsUrl, {
    headers: {
      authorization: `Bearer ${input.agentToken}`,
    },
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        agentVersion: "test-agent",
        name: "stub-session-agent",
        capabilities: input.capabilities ?? { kinds: ["agent.run"] },
      })
    );
  });

  ws.on("message", async (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    let msg: any = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || msg.type !== "execute") {
      return;
    }

    const requestId = msg.requestId;
    const kind = msg.kind;
    if (kind !== "agent.run") {
      ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "KIND_NOT_SUPPORTED" }));
      return;
    }

    const toolset = msg.payload?.toolset ?? null;
    if (toolset && typeof toolset === "object" && typeof toolset.id === "string") {
      ws.send(
        JSON.stringify({
          type: "execute_event",
          requestId,
          event: {
            ts: Date.now(),
            kind: "toolset_skills_applied",
            level: "info",
            payload: { toolsetId: toolset.id, count: Array.isArray(toolset.agentSkills) ? toolset.agentSkills.length : 0 },
          },
        })
      );
    }

    ws.send(
      JSON.stringify({
        type: "execute_event",
        requestId,
        event: {
          ts: Date.now(),
          kind: "agent.assistant_message",
          level: "info",
          payload: { text: "ok" },
        },
      })
    );

    ws.send(
      JSON.stringify({
        type: "execute_result",
        requestId,
        status: "succeeded",
        output: { ok: true },
      })
    );
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
  let stubAgent: Awaited<ReturnType<typeof startStubAgent>> | null = null;

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
    gatewayWsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;

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
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {},
    });
    expect(pairing.statusCode).toBe(201);
    const pairingToken = (pairing.json() as any).token as string;

    const paired = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: { pairingToken, name: "stub", agentVersion: "test", capabilities: { kinds: ["agent.run"] } },
    });
    expect(paired.statusCode).toBe(201);
    const agentToken = (paired.json() as any).agentToken as string;

    if (!gatewayWsUrl) {
      throw new Error("missing gateway ws url");
    }
    stubAgent = await startStubAgent({
      gatewayWsUrl,
      agentToken,
      capabilities: { kinds: ["agent.run"] },
    });
  });

  afterAll(async () => {
    if (stubAgent) await stubAgent.close();
    if (api) await api.close();
    if (gateway) await gateway.close();
  });

  it("creates a session, pins an agent on first send, streams and persists events, and rejects sends when pinned agent is offline", async () => {
    if (!available || !api || !gatewayWsUrl || !orgId || !token) return;

    const toolsetCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {
        name: "Session Toolset",
        visibility: "private",
        mcpServers: [],
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "hello",
            name: "Hello",
            entry: "SKILL.md",
            files: [{ path: "SKILL.md", content: "# Hello Skill" }],
          },
        ],
      },
    });
    expect(toolsetCreate.statusCode).toBe(201);
    const toolsetId = (toolsetCreate.json() as any).toolset.id as string;

    const create = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {
        title: "Test session",
        engineId: "vespid.loop.v1",
        toolsetId,
        llm: { provider: "openai", model: "gpt-4.1-mini" },
        prompt: { instructions: "Say ok." },
        tools: { allow: [] },
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

    await new Promise((r) => setTimeout(r, 200));

    const get1 = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(get1.statusCode).toBe(200);
    const pinned = (get1.json() as any).session.pinnedAgentId as string | null;
    expect(typeof pinned === "string").toBe(true);

    const events = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}/events?limit=200`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(events.statusCode).toBe(200);
    const rows = (events.json() as any).events as any[];
    expect(rows.some((e) => e.eventType === "user_message")).toBe(true);
    expect(rows.some((e) => e.eventType === "agent_message")).toBe(true);
    expect(rows.some((e) => e.eventType === "agent_final")).toBe(true);
    expect(
      rows.some(
        (e) =>
          e.payload &&
          typeof e.payload === "object" &&
          (e.payload as any).payload &&
          typeof (e.payload as any).payload === "object" &&
          (e.payload as any).payload.toolsetId === toolsetId
      )
    ).toBe(true);

    // Simulate pinned agent going offline and ensure gateway errors deterministically.
    if (stubAgent) {
      await stubAgent.close();
      stubAgent = null;
    }

    client.send(JSON.stringify({ type: "session_send", sessionId, message: "second", idempotencyKey: "k2" }));
    await new Promise((r) => setTimeout(r, 200));

    const errors = received.filter((m) => m && m.type === "session_error");
    expect(errors.some((e) => e.code === "PINNED_AGENT_OFFLINE" || e.code === "NO_AGENT_AVAILABLE")).toBe(true);

    await new Promise<void>((resolve) => {
      client.close();
      client.once("close", () => resolve());
      setTimeout(() => resolve(), 250).unref?.();
    });
  });
});
