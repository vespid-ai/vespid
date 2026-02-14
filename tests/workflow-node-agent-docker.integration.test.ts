import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";
import { startNodeAgent } from "../apps/node-agent/src/runtime.js";

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

function dockerAvailable(): boolean {
  const result = spawnSync("docker", ["version"], { stdio: "ignore" });
  return result.status === 0;
}

describe("workflow node-agent docker integration", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let workerRuntime: Awaited<ReturnType<typeof startWorkflowWorker>> | null = null;
  let nodeAgent: Awaited<ReturnType<typeof startNodeAgent>> | null = null;
  let gatewayWsUrl: string | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }
    if (!(await canConnectRedis(redisUrl))) {
      return;
    }
    if (!dockerAvailable()) {
      if (process.env.DOCKER_REQUIRED === "1") {
        throw new Error("DOCKER_NOT_AVAILABLE");
      }
      return;
    }

    process.env.GATEWAY_SERVICE_TOKEN = process.env.GATEWAY_SERVICE_TOKEN ?? "dev-gateway-token";
    process.env.GATEWAY_HTTP_URL = process.env.GATEWAY_HTTP_URL ?? "http://127.0.0.1:3002";
    process.env.GATEWAY_WS_URL = process.env.GATEWAY_WS_URL ?? "ws://127.0.0.1:3002/ws";
    gatewayWsUrl = process.env.GATEWAY_WS_URL;

    await migrateUp({ databaseUrl });
    gateway = await buildGatewayServer();
    await gateway.listen({ port: 3002, host: "127.0.0.1" });

    api = await buildServer();
    await api.listen({ port: 3001, host: "127.0.0.1" });

    workerRuntime = await startWorkflowWorker();
    available = true;
  });

  afterAll(async () => {
    if (nodeAgent) {
      await nodeAgent.close();
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
  });

  it("executes agent.execute in docker sandbox", async () => {
    if (!available || !api || !gatewayWsUrl) {
      return;
    }

    const workdirRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vespid-agent-workdir-"));
    process.env.VESPID_AGENT_EXEC_BACKEND = "docker";
    process.env.VESPID_AGENT_WORKDIR_ROOT = workdirRoot;
    process.env.VESPID_AGENT_DOCKER_IMAGE = process.env.VESPID_AGENT_DOCKER_IMAGE ?? "node:24-alpine";
    process.env.VESPID_AGENT_DOCKER_NETWORK_DEFAULT = "none";

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `docker-owner-${Date.now()}@example.com`,
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
        name: "Docker Agent Org",
        slug: randomSlug("docker-agent-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

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
        name: "docker-agent",
        agentVersion: "test-agent",
        capabilities: { kinds: ["agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

    nodeAgent = await startNodeAgent({
      agentId: (pairRes.json() as { agentId: string }).agentId,
      agentToken,
      organizationId: orgId,
      gatewayWsUrl,
      apiBaseUrl: "http://127.0.0.1:3001",
      name: "docker-agent",
      agentVersion: "test-agent",
      capabilities: { kinds: ["agent.execute"] },
    });
    await nodeAgent.ready;

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Docker Execution Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-agent",
              type: "agent.execute",
              config: {
                execution: { mode: "node" },
                task: { type: "shell", script: "echo hello", shell: "sh" },
                sandbox: { backend: "docker", network: "none", timeoutMs: 30_000 },
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

    let finalStatus = runBody.run.status;
    for (let index = 0; index < 120; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
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
    const eventsBody = eventsRes.json() as { events: Array<{ eventType: string; nodeId?: string; payload?: any }> };

    const dispatched = eventsBody.events.find((e) => e.eventType === "node_dispatched" && e.nodeId === "node-agent");
    expect(dispatched).toBeTruthy();

    const succeeded = eventsBody.events.find((e) => e.eventType === "node_succeeded" && e.nodeId === "node-agent");
    expect(succeeded).toBeTruthy();
    const stdout = String(succeeded?.payload?.stdout ?? "");
    expect(stdout).toContain("hello");
  });

  it("maps docker timeouts to NODE_EXECUTION_TIMEOUT", async () => {
    if (!available || !api || !gatewayWsUrl) {
      return;
    }

    const workdirRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vespid-agent-timeout-workdir-"));
    process.env.VESPID_AGENT_EXEC_BACKEND = "docker";
    process.env.VESPID_AGENT_WORKDIR_ROOT = workdirRoot;
    process.env.VESPID_AGENT_DOCKER_IMAGE = process.env.VESPID_AGENT_DOCKER_IMAGE ?? "node:24-alpine";
    process.env.VESPID_AGENT_DOCKER_NETWORK_DEFAULT = "none";

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `docker-timeout-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await api.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Docker Timeout Org", slug: randomSlug("docker-timeout-org") },
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
        name: "docker-agent-timeout",
        agentVersion: "test-agent",
        capabilities: { kinds: ["agent.execute"] },
      },
    });
    expect(pairRes.statusCode).toBe(201);
    const agentToken = (pairRes.json() as { agentToken: string }).agentToken;

    if (nodeAgent) {
      await nodeAgent.close();
      nodeAgent = null;
    }

    nodeAgent = await startNodeAgent({
      agentId: (pairRes.json() as { agentId: string }).agentId,
      agentToken,
      organizationId: orgId,
      gatewayWsUrl,
      apiBaseUrl: "http://127.0.0.1:3001",
      name: "docker-agent-timeout",
      agentVersion: "test-agent",
      capabilities: { kinds: ["agent.execute"] },
    });
    await nodeAgent.ready;

    const createWorkflow = await api.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Docker Timeout Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "node-timeout",
              type: "agent.execute",
              config: {
                execution: { mode: "node" },
                task: { type: "shell", script: "sleep 3; echo done", shell: "sh" },
                sandbox: { backend: "docker", network: "none", timeoutMs: 1000 },
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
    for (let index = 0; index < 180; index += 1) {
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
    expect(finalStatus).toBe("failed");

    const eventsRes = await api.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=200`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json() as { events: Array<{ eventType: string; message?: string | null }> };
    const nodeFailed = eventsBody.events.find((e) => e.eventType === "node_failed");
    expect(nodeFailed?.message).toBe("NODE_EXECUTION_TIMEOUT");
  });
});
