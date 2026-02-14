import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import WebSocket from "ws";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";
import { getCommunityConnectorAction } from "@vespid/connectors";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

async function startGithubStub() {
  let lastAuth: string | null = null;
  let lastBody: unknown = null;
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
    lastAuth = req.headers.authorization ?? null;

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    lastBody = raw.length > 0 ? JSON.parse(raw) : null;

    if (req.headers.authorization !== `Bearer ${expectedToken}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "bad token" }));
      return;
    }

    res.statusCode = 201;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        number: 7,
        html_url: "https://github.local/issues/7",
      })
    );
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
    getLastAuth() {
      return lastAuth;
    },
    getLastBody() {
      return lastBody;
    },
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

async function startStubAgent(input: {
  gatewayWsUrl: string;
  agentToken: string;
  githubApiBaseUrl: string;
  capabilities?: Record<string, unknown>;
  failConnectorAction?: boolean;
  supportedConnectors?: string[];
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
        name: "stub-agent",
        capabilities: input.capabilities ?? { kinds: ["connector.action", "agent.execute"] },
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

    try {
      if (kind === "agent.execute") {
        const nodeId = typeof msg.payload?.nodeId === "string" ? msg.payload.nodeId : "node";
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "succeeded",
            output: { accepted: true, taskId: `${nodeId}-remote-task` },
          })
        );
        return;
      }

      if (input.failConnectorAction) {
        ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "CONNECTOR_ACTION_NOT_SUPPORTED" }));
        return;
      }

      const connectorId = msg.payload?.connectorId;
      const actionId = msg.payload?.actionId;
      if (Array.isArray(input.supportedConnectors) && typeof connectorId === "string") {
        if (!input.supportedConnectors.includes(connectorId)) {
          ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: "CONNECTOR_NOT_SUPPORTED" }));
          return;
        }
      }
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

describe("workflow node-agent integration", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let workerRuntime: Awaited<ReturnType<typeof startWorkflowWorker>> | null = null;
  let githubStub: Awaited<ReturnType<typeof startGithubStub>> | null = null;
  let stubAgent: Awaited<ReturnType<typeof startStubAgent>> | null = null;
  let gatewayBaseUrl: string | null = null;
  let gatewayWsUrl: string | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }
    if (!(await canConnectRedis(redisUrl))) {
      return;
    }

    await migrateUp(databaseUrl);

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");

    process.env.GATEWAY_SERVICE_TOKEN = "ci-gateway-token";

    githubStub = await startGithubStub();
    process.env.GITHUB_API_BASE_URL = githubStub.baseUrl;

    gateway = await buildGatewayServer();
    const address = await gateway.listen({ port: 0, host: "127.0.0.1" });
    const parsed = new URL(address);
    gatewayBaseUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
    gatewayWsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;

    process.env.GATEWAY_HTTP_URL = gatewayBaseUrl;
    process.env.GATEWAY_WS_URL = gatewayWsUrl;
    process.env.NODE_EXEC_TIMEOUT_MS = "60000";

    api = await buildServer();
    workerRuntime = await startWorkflowWorker();
    available = true;
  });

  afterAll(async () => {
    if (stubAgent) {
      await stubAgent.close();
    }
    if (workerRuntime) {
      await workerRuntime.close();
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
  });

  it("executes connector.action remotely via gateway + node-agent", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Node Agent Org",
        slug: randomSlug("node-agent-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const secretCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/secrets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        connectorId: "github",
        name: "token",
        value: githubStub.expectedToken,
      },
    });
    expect(secretCreate.statusCode).toBe(201);
    const secretId = (secretCreate.json() as { secret: { id: string } }).secret.id;

    const pairing = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(pairing.statusCode).toBe(201);
    const pairingToken = (pairing.json() as { token: string }).token;

    const pairRes = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: {
        pairingToken,
        name: "stub-agent",
        agentVersion: "test-agent",
        capabilities: { kinds: ["connector.action", "agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

    stubAgent = await startStubAgent({
      gatewayWsUrl,
      agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
    });

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Remote Execution Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: {
                  repo: "octo/test",
                  title: "Remote Exec Issue",
                  body: "Created by vespid remote execution test",
                },
                auth: {
                  secretId,
                },
                execution: {
                  mode: "node",
                },
              },
            },
            {
              id: "node-agent",
              type: "agent.execute",
              config: {
                execution: {
                  mode: "node",
                },
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
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publish.statusCode).toBe(200);

    const runCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        input: { key: "value" },
      },
    });
    expect(runCreate.statusCode).toBe(201);
    const runBody = runCreate.json() as { run: { id: string; status: string } };
    expect(runBody.run.status).toBe("queued");

    let finalStatus = runBody.run.status;
    for (let index = 0; index < 60; index += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });

      const runGet = await api.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runBody.run.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
      });
      expect(runGet.statusCode).toBe(200);
      const currentRun = runGet.json() as { run: { status: string } };
      finalStatus = currentRun.run.status;
      if (finalStatus === "succeeded" || finalStatus === "failed") {
        break;
      }
    }

    expect(finalStatus).toBe("succeeded");

    const eventsRes = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runBody.run.id}/events?limit=200`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json() as { events: Array<{ nodeId?: string; eventType: string; payload?: unknown }> };
    const serializedEvents = JSON.stringify(eventsBody.events);
    expect(serializedEvents).not.toContain(githubStub.expectedToken);
    expect(githubStub.getLastAuth()).toBe(`Bearer ${githubStub.expectedToken}`);

    const githubSuccess = eventsBody.events.find((event) => event.eventType === "node_succeeded" && event.nodeId === "node-github");
    expect(githubSuccess).toBeTruthy();
    const githubPayload = githubSuccess?.payload as { issueNumber?: unknown; url?: unknown } | undefined;
    expect(typeof githubPayload?.issueNumber).toBe("number");
    expect(typeof githubPayload?.url).toBe("string");

    const agentSuccess = eventsBody.events.find((event) => event.eventType === "node_succeeded" && event.nodeId === "node-agent");
    expect(agentSuccess).toBeTruthy();
    const agentPayload = agentSuccess?.payload as { taskId?: unknown } | undefined;
    expect(typeof agentPayload?.taskId).toBe("string");
    expect(String(agentPayload?.taskId)).toContain("-remote-task");
  });

  it("routes connector.action only to agents that declare support", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-cap-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Node Agent Cap Org",
        slug: randomSlug("node-agent-cap-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const secretCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/secrets`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { connectorId: "github", name: "token", value: githubStub.expectedToken },
    });
    expect(secretCreate.statusCode).toBe(201);
    const secretId = (secretCreate.json() as { secret: { id: string } }).secret.id;

    async function pair(name: string) {
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
        payload: { pairingToken, name, agentVersion: "test-agent", capabilities: { kinds: ["connector.action", "agent.execute"] } },
      });
      expect(pairRes.statusCode).toBe(201);
      return pairRes.json() as { agentToken: string };
    }

    // Connect an agent that does NOT support connector.action (and would fail if it receives it).
    const agentA = await pair("agent-exec-only");
    const wsA = await startStubAgent({
      gatewayWsUrl,
      agentToken: agentA.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
      capabilities: { kinds: ["agent.execute"] },
      failConnectorAction: true,
    });

    // Connect an agent that supports connector.action.
    const agentB = await pair("agent-connector");
    const wsB = await startStubAgent({
      gatewayWsUrl,
      agentToken: agentB.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
      capabilities: { kinds: ["connector.action", "agent.execute"] },
    });

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Cap Routing Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: { repo: "octo/test", title: "Capability Routing" },
                auth: { secretId },
                execution: { mode: "node" },
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

    const beforeCount = githubStub.getRequestCount();
    const runCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(runCreate.statusCode).toBe(201);
    const runId = (runCreate.json() as { run: { id: string } }).run.id;

    let finalStatus = "queued";
    for (let index = 0; index < 80; index += 1) {
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
    expect(githubStub.getRequestCount()).toBe(beforeCount + 1);

    await wsA.close();
    await wsB.close();
  });

  it("routes connector.action only to agents that support the connector", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-conn-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Node Agent Connector Org",
        slug: randomSlug("node-agent-conn-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const secretCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/secrets`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { connectorId: "github", name: "token", value: githubStub.expectedToken },
    });
    expect(secretCreate.statusCode).toBe(201);
    const secretId = (secretCreate.json() as { secret: { id: string } }).secret.id;

    async function pairWithCaps(name: string, capabilities: Record<string, unknown>) {
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
        payload: { pairingToken, name, agentVersion: "test-agent", capabilities },
      });
      expect(pairRes.statusCode).toBe(201);
      return pairRes.json() as { agentToken: string };
    }

    // Agent that supports connector.action but NOT github.
    const agentA = await pairWithCaps("agent-jira-only", { kinds: ["connector.action"], connectors: ["jira"] });
    const wsA = await startStubAgent({
      gatewayWsUrl,
      agentToken: agentA.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
      capabilities: { kinds: ["connector.action"], connectors: ["jira"] },
      supportedConnectors: ["jira"],
    });

    // Agent that supports github.
    const agentB = await pairWithCaps("agent-github", { kinds: ["connector.action"], connectors: ["github"] });
    const wsB = await startStubAgent({
      gatewayWsUrl,
      agentToken: agentB.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
      capabilities: { kinds: ["connector.action"], connectors: ["github"] },
      supportedConnectors: ["github"],
    });

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Connector Routing Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: { repo: "octo/test", title: "Connector Routing" },
                auth: { secretId },
                execution: { mode: "node" },
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

    const beforeCount = githubStub.getRequestCount();
    const runCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(runCreate.statusCode).toBe(201);
    const runId = (runCreate.json() as { run: { id: string } }).run.id;

    let finalStatus = "queued";
    for (let index = 0; index < 80; index += 1) {
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
    expect(githubStub.getRequestCount()).toBe(beforeCount + 1);

    await wsA.close();
    await wsB.close();
  });

  it("stores orphan execute_result for recovery (results endpoint)", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl || !gatewayBaseUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-orphan-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Node Agent Orphan Org",
        slug: randomSlug("node-agent-orphan-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

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
        name: "stub-agent-orphan",
        agentVersion: "test-agent",
        capabilities: { kinds: ["agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

    // Connect a raw WS client that sends an execute_result for an unknown requestId.
    const ws = new WebSocket(gatewayWsUrl, {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });
    ws.send(JSON.stringify({ type: "hello", agentVersion: "test-agent", name: "orphan-agent", capabilities: { kinds: ["agent.execute"] } }));

    const requestId = `${crypto.randomUUID()}:node:1`;
    ws.send(JSON.stringify({ type: "execute_result", requestId, status: "succeeded", output: { ok: true } }));

    // Poll results endpoint until stored.
    let found = false;
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${gatewayBaseUrl}/internal/v1/results/${encodeURIComponent(requestId)}`, {
        headers: { "x-gateway-token": "ci-gateway-token" },
      });
      if (res.status === 200) {
        const body = (await res.json()) as { status: string; output?: unknown };
        expect(body.status).toBe("succeeded");
        expect(body.output).toEqual({ ok: true });
        found = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(found).toBe(true);

    ws.close();
  });

  it("does not dispatch to revoked agents", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-revoke-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Node Agent Revoke Org",
        slug: randomSlug("node-agent-revoke-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const secretCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/secrets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        connectorId: "github",
        name: "token",
        value: githubStub.expectedToken,
      },
    });
    expect(secretCreate.statusCode).toBe(201);
    const secretId = (secretCreate.json() as { secret: { id: string } }).secret.id;

    const pairing = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(pairing.statusCode).toBe(201);
    const pairingToken = (pairing.json() as { token: string }).token;

    const pairRes = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: {
        pairingToken,
        name: "stub-agent-revoke",
        agentVersion: "test-agent",
        capabilities: { kinds: ["connector.action", "agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const pairBody = pairRes.json() as { agentId: string; agentToken: string };

    const localAgent = await startStubAgent({
      gatewayWsUrl,
      agentToken: pairBody.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
    });

    const revoke = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/${pairBody.agentId}/revoke`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(revoke.statusCode).toBe(200);

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Revoked Agent Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: {
                  repo: "octo/test",
                  title: "Should Not Run",
                  body: "Revoked agent must not run this",
                },
                auth: {
                  secretId,
                },
                execution: {
                  mode: "node",
                },
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
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publish.statusCode).toBe(200);

    const beforeCount = githubStub.getRequestCount();

    const runCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        input: { key: "value" },
      },
    });
    expect(runCreate.statusCode).toBe(201);
    const runId = (runCreate.json() as { run: { id: string } }).run.id;

    let finalStatus = "queued";
    for (let index = 0; index < 80; index += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      const runGet = await api.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
      });
      expect(runGet.statusCode).toBe(200);
      finalStatus = (runGet.json() as { run: { status: string } }).run.status;
      if (finalStatus === "succeeded" || finalStatus === "failed") {
        break;
      }
    }

    expect(finalStatus).toBe("failed");

    const afterCount = githubStub.getRequestCount();
    expect(afterCount).toBe(beforeCount);

    const eventsRes = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=200`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json() as { events: Array<unknown> };
    expect(JSON.stringify(eventsBody.events)).not.toContain(githubStub.expectedToken);

    await localAgent.close();
  });

  it("fails fast when agent disconnects before dispatch (no hang)", async () => {
    if (!available || !api || !githubStub || !gatewayWsUrl) {
      return;
    }

    process.env.NODE_EXEC_TIMEOUT_MS = "2000";

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `node-agent-disconnect-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Node Agent Disconnect Org",
        slug: randomSlug("node-agent-disconnect-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const secretCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/secrets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        connectorId: "github",
        name: "token",
        value: githubStub.expectedToken,
      },
    });
    expect(secretCreate.statusCode).toBe(201);
    const secretId = (secretCreate.json() as { secret: { id: string } }).secret.id;

    const pairing = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(pairing.statusCode).toBe(201);
    const pairingToken = (pairing.json() as { token: string }).token;

    const pairRes = await api.inject({
      method: "POST",
      url: "/v1/agents/pair",
      payload: {
        pairingToken,
        name: "stub-agent-disconnect",
        agentVersion: "test-agent",
        capabilities: { kinds: ["connector.action", "agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const pairBody = pairRes.json() as { agentToken: string };

    const localAgent = await startStubAgent({
      gatewayWsUrl,
      agentToken: pairBody.agentToken,
      githubApiBaseUrl: githubStub.baseUrl,
    });
    await localAgent.close();

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Disconnect Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: {
                  repo: "octo/test",
                  title: "Should Fail Fast",
                },
                auth: {
                  secretId,
                },
                execution: {
                  mode: "node",
                },
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
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publish.statusCode).toBe(200);

    const beforeCount = githubStub.getRequestCount();

    const runCreate = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(runCreate.statusCode).toBe(201);
    const runId = (runCreate.json() as { run: { id: string } }).run.id;

    let finalStatus = "queued";
    for (let index = 0; index < 80; index += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      const runGet = await api.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
      });
      expect(runGet.statusCode).toBe(200);
      finalStatus = (runGet.json() as { run: { status: string } }).run.status;
      if (finalStatus === "succeeded" || finalStatus === "failed") {
        break;
      }
    }

    expect(finalStatus).toBe("failed");
    expect(githubStub.getRequestCount()).toBe(beforeCount);
  });
});
