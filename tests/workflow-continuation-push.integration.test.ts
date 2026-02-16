import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import WebSocket from "ws";
import { Redis } from "ioredis";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";
import { getCommunityConnectorAction } from "@vespid/connectors";

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

async function startGithubStub(delayMs: number) {
  let requestCount = 0;
  const expectedToken = `ghp_${crypto.randomBytes(12).toString("hex")}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "POST" || !url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues$/)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

    if (req.headers.authorization !== `Bearer ${expectedToken}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "bad token" }));
      return;
    }

    res.statusCode = 201;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ number: 12, html_url: "https://github.local/issues/12" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start github stub server");
  }

  return {
    expectedToken,
    baseUrl: `http://127.0.0.1:${address.port}`,
    getRequestCount() {
      return requestCount;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startDelayedStubAgent(input: {
  gatewayWsUrl: string;
  agentToken: string;
  githubApiBaseUrl: string;
  delayMs: number;
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
        name: "delayed-stub-agent",
        capabilities: { kinds: ["connector.action"], connectors: ["github"], maxInFlight: 10 },
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
    try {
      if (msg.kind !== "connector.action") {
        ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "KIND_NOT_SUPPORTED" }));
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, Math.max(0, input.delayMs)));

      const connectorId = msg.payload?.connectorId;
      const actionId = msg.payload?.actionId;
      const action = getCommunityConnectorAction({ connectorId, actionId });
      if (!action) {
        ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "ACTION_NOT_SUPPORTED" }));
        return;
      }

      const actionInputParsed = action.inputSchema.safeParse(msg.payload?.input);
      if (!actionInputParsed.success) {
        ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "INVALID_ACTION_INPUT" }));
        return;
      }

      const secret = action.requiresSecret ? (typeof msg.secret === "string" ? msg.secret : null) : null;
      if (action.requiresSecret && !secret) {
        ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "SECRET_REQUIRED" }));
        return;
      }

      const result = await action.execute({
        organizationId: msg.organizationId,
        userId: msg.userId,
        connectorId,
        actionId,
        input: actionInputParsed.data,
        secret,
        env: {
          githubApiBaseUrl: input.githubApiBaseUrl,
        },
        fetchImpl: fetch,
      });

      ws.send(
        JSON.stringify({
          type: "execute_result",
          requestId,
          status: result.status,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.status === "failed" ? { error: result.error } : {}),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "EXECUTION_FAILED";
      ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  return {
    async close() {
      ws.close();
    },
  };
}

describe("workflow continuation push integration", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let githubStub: Awaited<ReturnType<typeof startGithubStub>> | null = null;
  let stubAgent: Awaited<ReturnType<typeof startDelayedStubAgent>> | null = null;
  let gatewayBaseUrl: string | null = null;
  let gatewayWsUrl: string | null = null;
  let redis: Redis | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }
    if (!(await canConnectRedis(redisUrl))) {
      return;
    }

    const suffix = crypto.randomBytes(4).toString("hex");
    process.env.WORKFLOW_QUEUE_NAME = `workflow-runs-${suffix}`;
    process.env.WORKFLOW_CONTINUATION_QUEUE_NAME = `workflow-continuations-${suffix}`;

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
    process.env.GATEWAY_SERVICE_TOKEN = "ci-gateway-token";

    githubStub = await startGithubStub(0);
    process.env.GITHUB_API_BASE_URL = githubStub.baseUrl;

    await migrateUp(databaseUrl);

    gateway = await buildGatewayServer();
    const address = await gateway.listen({ port: 0, host: "127.0.0.1" });
    const parsed = new URL(address);
    gatewayBaseUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
    gatewayWsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;
    process.env.GATEWAY_HTTP_URL = gatewayBaseUrl;
    process.env.GATEWAY_WS_URL = gatewayWsUrl;

    api = await buildServer();

    redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });

    available = true;
  });

  afterAll(async () => {
    if (stubAgent) {
      await stubAgent.close();
    }
    if (api) {
      await api.close();
    }
    if (gateway) {
      await gateway.close();
    }
    if (githubStub) {
      await githubStub.close();
    }
    if (redis) {
      await redis.quit();
    }
  });

  it("applies remote results via gateway push even when polling interval is large", async () => {
    if (!available || !api || !gatewayWsUrl || !githubStub) {
      return;
    }

    process.env.WORKFLOW_CONTINUATION_POLL_MS = "60000";
    const workerRuntime = await startWorkflowWorker();

    try {
      const signup = await api.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { email: `push-owner-${Date.now()}@example.com`, password: "Password123" },
      });
      expect(signup.statusCode).toBe(201);
      const ownerToken = (signup.json() as { session: { token: string } }).session.token;

      const orgRes = await api.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Push Org", slug: randomSlug("push-org") },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

      const secretRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "github", name: "token", value: githubStub.expectedToken },
      });
      expect(secretRes.statusCode).toBe(201);
      const secretId = (secretRes.json() as { secret: { id: string } }).secret.id;

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
          name: "delayed-agent",
          agentVersion: "test-agent",
          capabilities: { kinds: ["connector.action"], connectors: ["github"] },
        },
      });
      expect(pairRes.statusCode).toBe(201);
      const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

      // Ensure the first poll attempt happens before result is ready; without push this would stall for 60s.
      stubAgent = await startDelayedStubAgent({
        gatewayWsUrl,
        agentToken,
        githubApiBaseUrl: githubStub.baseUrl,
        delayMs: 1500,
      });

      const createWorkflow = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          name: "Push Workflow",
          dsl: {
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes: [
              {
                id: "n1",
                type: "connector.action",
                config: {
                  connectorId: "github",
                  actionId: "issue.create",
                  input: { repo: "octo/test", title: "Push", body: "push test" },
                  auth: { secretId },
                  execution: { mode: "executor" },
                },
              },
            ],
          },
        },
      });
      expect(createWorkflow.statusCode).toBe(201);
      const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

      const publish = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(publish.statusCode).toBe(200);

      const runCreate = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { input: { key: "value" } },
      });
      expect(runCreate.statusCode).toBe(201);
      const runId = (runCreate.json() as { run: { id: string } }).run.id;

      let finalStatus: string | null = null;
      for (let index = 0; index < 40; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const runGet = await api.inject({
          method: "GET",
          url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
          headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        });
        expect(runGet.statusCode).toBe(200);
        finalStatus = (runGet.json() as { run: { status: string } }).run.status;
        if (finalStatus === "succeeded" || finalStatus === "failed") {
          break;
        }
      }
      expect(finalStatus).toBe("succeeded");
      expect(githubStub.getRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await workerRuntime.close();
      if (stubAgent) {
        await stubAgent.close();
        stubAgent = null;
      }
    }
  });

  it("falls back to polling when gateway meta is missing", async () => {
    if (!available || !api || !gatewayWsUrl || !githubStub || !redis) {
      return;
    }

    process.env.WORKFLOW_CONTINUATION_POLL_MS = "250";
    const workerRuntime = await startWorkflowWorker();

    try {
      const signup = await api.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { email: `poll-owner-${Date.now()}@example.com`, password: "Password123" },
      });
      expect(signup.statusCode).toBe(201);
      const ownerToken = (signup.json() as { session: { token: string } }).session.token;

      const orgRes = await api.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Poll Org", slug: randomSlug("poll-org") },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

      const secretRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "github", name: "token", value: githubStub.expectedToken },
      });
      expect(secretRes.statusCode).toBe(201);
      const secretId = (secretRes.json() as { secret: { id: string } }).secret.id;

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
          name: "delayed-agent-poll",
          agentVersion: "test-agent",
          capabilities: { kinds: ["connector.action"], connectors: ["github"] },
        },
      });
      expect(pairRes.statusCode).toBe(201);
      const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

      if (stubAgent) {
        await stubAgent.close();
        stubAgent = null;
      }
      stubAgent = await startDelayedStubAgent({
        gatewayWsUrl,
        agentToken,
        githubApiBaseUrl: githubStub.baseUrl,
        delayMs: 1500,
      });

      const createWorkflow = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          name: "Poll Workflow",
          dsl: {
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes: [
              {
                id: "n1",
                type: "connector.action",
                config: {
                  connectorId: "github",
                  actionId: "issue.create",
                  input: { repo: "octo/test", title: "Poll", body: "poll test" },
                  auth: { secretId },
                  execution: { mode: "executor" },
                },
              },
            ],
          },
        },
      });
      expect(createWorkflow.statusCode).toBe(201);
      const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

      const publish = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(publish.statusCode).toBe(200);

      const runCreate = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { input: { key: "value" } },
      });
      expect(runCreate.statusCode).toBe(201);
      const runId = (runCreate.json() as { run: { id: string } }).run.id;

      let requestId: string | null = null;
      for (let index = 0; index < 60; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const events = await api.inject({
          method: "GET",
          url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=200`,
          headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        });
        expect(events.statusCode).toBe(200);
        const body = events.json() as { events: Array<{ eventType: string; payload?: any }> };
        const dispatched = body.events.find((e) => e.eventType === "node_dispatched");
        const maybe = dispatched?.payload?.requestId;
        if (typeof maybe === "string" && maybe.length > 0) {
          requestId = maybe;
          break;
        }
      }

      expect(requestId).toBeTruthy();
      if (requestId) {
        await redis.del(`gateway:meta:${requestId}`);
      }

      let finalStatus: string | null = null;
      for (let index = 0; index < 120; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const runGet = await api.inject({
          method: "GET",
          url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
          headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        });
        expect(runGet.statusCode).toBe(200);
        finalStatus = (runGet.json() as { run: { status: string } }).run.status;
        if (finalStatus === "succeeded" || finalStatus === "failed") {
          break;
        }
      }
      expect(finalStatus).toBe("succeeded");
    } finally {
      await workerRuntime.close();
      if (stubAgent) {
        await stubAgent.close();
        stubAgent = null;
      }
    }
  });
});
