import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import { buildServer } from "../apps/api/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

async function startGithubStub() {
  let lastAuth: string | null = null;
  let lastBody: unknown = null;
  const expectedToken = `ghp_${crypto.randomBytes(12).toString("hex")}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "POST" || !url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues$/)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

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
        number: 42,
        html_url: "https://github.local/issues/42",
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

describe("workflow async integration", () => {
  let available = false;
  let server: Awaited<ReturnType<typeof buildServer>> | null = null;
  let workerRuntime: Awaited<ReturnType<typeof startWorkflowWorker>> | null = null;
  let githubStub: Awaited<ReturnType<typeof startGithubStub>> | null = null;

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

    githubStub = await startGithubStub();
    process.env.GITHUB_API_BASE_URL = githubStub.baseUrl;

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
    if (githubStub) {
      await githubStub.close();
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

    if (!githubStub) {
      throw new Error("GitHub stub server is not available");
    }

    const secretCreate = await server.inject({
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
            {
              id: "node-github",
              type: "connector.action",
              config: {
                connectorId: "github",
                actionId: "issue.create",
                input: {
                  repo: "octo/test",
                  title: "Vespid CI Issue",
                  body: "Created by vespid workflow runtime test",
                },
                auth: {
                  secretId,
                },
              },
            },
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
    const eventsBody = eventsRes.json() as {
      events: Array<{ eventType: string; nodeType?: string | null; payload?: unknown }>;
    };
    const eventTypes = eventsBody.events.map((event) => event.eventType);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("run_succeeded");
    expect(eventTypes).toContain("node_started");
    expect(eventTypes).toContain("node_succeeded");

    const githubSuccess = eventsBody.events.find(
      (event) => event.eventType === "node_succeeded" && event.nodeId === "node-github"
    );
    expect(githubSuccess).toBeTruthy();
    const githubPayload = githubSuccess?.payload as { issueNumber?: unknown; url?: unknown } | undefined;
    expect(typeof githubPayload?.issueNumber).toBe("number");
    expect(typeof githubPayload?.url).toBe("string");

    const agentSuccess = eventsBody.events.find(
      (event) => event.eventType === "node_succeeded" && event.nodeType === "agent.execute"
    );
    expect(agentSuccess).toBeTruthy();

    const payload = agentSuccess?.payload as { taskId?: unknown } | undefined;
    const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
    expect(taskId).not.toBeNull();

    const serializedEvents = JSON.stringify(eventsBody.events);
    expect(serializedEvents).not.toContain(githubStub.expectedToken);
    expect(githubStub.getLastAuth()).toBe(`Bearer ${githubStub.expectedToken}`);
    expect(githubStub.getLastBody()).toEqual(
      expect.objectContaining({
        title: "Vespid CI Issue",
      })
    );

    const expectsEnterprise = Boolean(process.env.VESPID_ENTERPRISE_PROVIDER_MODULE);
    if (expectsEnterprise) {
      expect(taskId).toContain("enterprise-task");
    } else {
      expect(taskId).toContain("-task");
      expect(taskId).not.toContain("enterprise-task");
    }
  });
});
