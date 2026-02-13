import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import { buildServer } from "../apps/api/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";

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

describe("workflow async integration", () => {
  let available = false;
  let server: Awaited<ReturnType<typeof buildServer>> | null = null;
  let workerRuntime: Awaited<ReturnType<typeof startWorkflowWorker>> | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }

    if (!(await canConnectRedis(redisUrl))) {
      return;
    }

    await migrateUp(databaseUrl);
    server = await buildServer();
    workerRuntime = await startWorkflowWorker();
    available = true;
  });

  afterAll(async () => {
    if (workerRuntime) {
      await workerRuntime.close();
    }
    if (server) {
      await server.close();
    }
  });

  it("processes workflow run from queue to succeeded", async () => {
    if (!available || !server) {
      return;
    }

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `async-int-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = (signup.json() as { session: { token: string } }).session.token;

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Async Integration Org",
        slug: randomSlug("async-int-org"),
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Async Integration Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            { id: "node-http", type: "http.request" },
            { id: "node-agent", type: "agent.execute" },
          ],
        },
      },
    });
    expect(createWorkflow.statusCode).toBe(201);
    const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

    const publish = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publish.statusCode).toBe(200);

    const runCreate = await server.inject({
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
    let finalAttemptCount = 0;
    for (let index = 0; index < 40; index += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });

      const runGet = await server.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runBody.run.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
      });
      expect(runGet.statusCode).toBe(200);
      const currentRun = runGet.json() as { run: { status: string; attemptCount: number } };
      finalStatus = currentRun.run.status;
      finalAttemptCount = currentRun.run.attemptCount;
      if (finalStatus === "succeeded" || finalStatus === "failed") {
        break;
      }
    }

    expect(finalStatus).toBe("succeeded");
    expect(finalAttemptCount).toBeGreaterThanOrEqual(1);

    const eventsRes = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runBody.run.id}/events?limit=200`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json() as { events: Array<{ eventType: string; nodeId?: string | null }> };
    const eventTypes = eventsBody.events.map((event) => event.eventType);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("run_succeeded");
    expect(eventTypes).toContain("node_started");
    expect(eventTypes).toContain("node_succeeded");
  });
});
