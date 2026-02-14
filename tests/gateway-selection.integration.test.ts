import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import crypto from "node:crypto";
import WebSocket from "ws";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

function randomSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

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

async function startEchoAgent(input: {
  gatewayWsUrl: string;
  agentToken: string;
  name: string;
  capabilities: Record<string, unknown>;
}) {
  const ws = new WebSocket(input.gatewayWsUrl, {
    headers: { authorization: `Bearer ${input.agentToken}` },
  });

  let executeCount = 0;

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        agentVersion: "test-agent",
        name: input.name,
        capabilities: input.capabilities,
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
    executeCount += 1;
    ws.send(
      JSON.stringify({
        type: "execute_result",
        requestId: msg.requestId,
        status: "succeeded",
        output: { agentName: input.name },
      })
    );
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  return {
    getExecuteCount() {
      return executeCount;
    },
    async close() {
      ws.close();
    },
  };
}

describe("gateway selection integration", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let gatewayBaseUrl: string | null = null;
  let gatewayWsUrl: string | null = null;
  let agentA: Awaited<ReturnType<typeof startEchoAgent>> | null = null;
  let agentB: Awaited<ReturnType<typeof startEchoAgent>> | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }
    if (!(await canConnectRedis(redisUrl))) {
      return;
    }

    await migrateUp({ databaseUrl });

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
    process.env.GATEWAY_SERVICE_TOKEN = "ci-gateway-token";
    process.env.GATEWAY_AGENT_SELECTION = "round_robin";

    gateway = await buildGatewayServer();
    const address = await gateway.listen({ port: 0, host: "127.0.0.1" });
    const parsed = new URL(address);
    gatewayBaseUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
    gatewayWsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;

    api = await buildServer();
    available = true;
  });

  afterAll(async () => {
    if (agentA) {
      await agentA.close();
    }
    if (agentB) {
      await agentB.close();
    }
    if (api) {
      await api.close();
    }
    if (gateway) {
      await gateway.close();
    }
  });

  it("round robin alternates between eligible agents", async () => {
    if (!available || !api || !gatewayBaseUrl || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `rr-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "RR Org", slug: randomSlug("rr-org") },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    async function pairAgent(name: string, tags?: string[]) {
      const pairing = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(pairing.statusCode).toBe(201);
      const pairingToken = (pairing.json() as { token: string }).token;

      const pairRes = await api.inject({
        method: "POST",
        url: "/v1/agents/pair",
        payload: {
          pairingToken,
          name,
          agentVersion: "test-agent",
          capabilities: { kinds: ["agent.execute"], ...(tags ? { tags } : {}) },
        },
      });
      expect(pairRes.statusCode).toBe(201);
      return pairRes.json() as { agentToken: string };
    }

    const a = await pairAgent("agent-a");
    const b = await pairAgent("agent-b");

    agentA = await startEchoAgent({
      gatewayWsUrl,
      agentToken: a.agentToken,
      name: "agent-a",
      capabilities: { kinds: ["agent.execute"] },
    });
    agentB = await startEchoAgent({
      gatewayWsUrl,
      agentToken: b.agentToken,
      name: "agent-b",
      capabilities: { kinds: ["agent.execute"] },
    });

    const seen: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const runId = crypto.randomUUID();
      const nodeId = `n${index}`;
      const response = await fetch(`${gatewayBaseUrl}/internal/v1/dispatch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gateway-token": "ci-gateway-token",
        },
        body: JSON.stringify({
          organizationId: orgId,
          requestedByUserId: crypto.randomUUID(),
          runId,
          workflowId: crypto.randomUUID(),
          nodeId,
          nodeType: "agent.execute",
          attemptCount: 1,
          kind: "agent.execute",
          payload: { nodeId, node: { id: nodeId, type: "agent.execute" } },
          timeoutMs: 10_000,
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; output?: { agentName?: string } };
      expect(body.status).toBe("succeeded");
      const name = body.output?.agentName ?? "unknown";
      seen.push(name);
    }

    expect(seen).toEqual(["agent-a", "agent-b", "agent-a", "agent-b", "agent-a", "agent-b"]);
  });

  it("routes using selectorTag when provided", async () => {
    if (!available || !api || !gatewayBaseUrl || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `tag-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Tag Org", slug: randomSlug("tag-org") },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const pairingA = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(pairingA.statusCode).toBe(201);
    const tokenA = (pairingA.json() as { token: string }).token;
    const pairA = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: {
        pairingToken: tokenA,
        name: "east-agent",
        agentVersion: "test-agent",
        capabilities: { kinds: ["agent.execute"], tags: ["east"] },
      },
    });
    expect(pairA.statusCode).toBe(201);
    const eastToken = (pairA.json() as { agentToken: string }).agentToken;

    const pairingB = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(pairingB.statusCode).toBe(201);
    const tokenB = (pairingB.json() as { token: string }).token;
    const pairB = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: {
        pairingToken: tokenB,
        name: "west-agent",
        agentVersion: "test-agent",
        capabilities: { kinds: ["agent.execute"], tags: ["west"] },
      },
    });
    expect(pairB.statusCode).toBe(201);
    const westToken = (pairB.json() as { agentToken: string }).agentToken;

    const east = await startEchoAgent({
      gatewayWsUrl,
      agentToken: eastToken,
      name: "east-agent",
      capabilities: { kinds: ["agent.execute"], tags: ["east"] },
    });
    const west = await startEchoAgent({
      gatewayWsUrl,
      agentToken: westToken,
      name: "west-agent",
      capabilities: { kinds: ["agent.execute"], tags: ["west"] },
    });

    const runId = crypto.randomUUID();
    const nodeId = "n1";
    const response = await fetch(`${gatewayBaseUrl}/internal/v1/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": "ci-gateway-token" },
      body: JSON.stringify({
        organizationId: orgId,
        requestedByUserId: crypto.randomUUID(),
        runId,
        workflowId: crypto.randomUUID(),
        nodeId,
        nodeType: "agent.execute",
        attemptCount: 1,
        kind: "agent.execute",
        payload: { nodeId, node: { id: nodeId, type: "agent.execute" } },
        selectorTag: "west",
        timeoutMs: 10_000,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; output?: { agentName?: string } };
    expect(body.output?.agentName).toBe("west-agent");

    expect(west.getExecuteCount()).toBeGreaterThanOrEqual(1);
    expect(east.getExecuteCount()).toBe(0);

    await east.close();
    await west.close();
  });
});

