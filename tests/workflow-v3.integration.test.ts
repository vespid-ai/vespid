import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import { buildServer } from "../apps/api/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";
import { startWorkflowWorker } from "../apps/worker/src/main.js";

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

async function waitForRun(input: {
  server: Awaited<ReturnType<typeof buildServer>>;
  orgId: string;
  workflowId: string;
  runId: string;
  token: string;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 5000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await input.server.inject({
      method: "GET",
      url: `/v1/orgs/${input.orgId}/workflows/${input.workflowId}/runs/${input.runId}`,
      headers: { authorization: `Bearer ${input.token}`, "x-org-id": input.orgId },
    });
    if (res.statusCode !== 200) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const body = res.json() as any;
    const status = body?.run?.status;
    if (status === "succeeded" || status === "failed") {
      return body.run;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("RUN_TIMEOUT");
}

function bearerToken(body: { session: { token: string } }) {
  return body.session.token;
}

function randomSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

describe("workflow v3 integration", () => {
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

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");

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

  it("executes a v3 condition branch and skips the other branch", async () => {
    if (!available || !server) {
      return;
    }

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `v3-cond-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    const token = bearerToken(signup.json() as any);

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "V3 Cond Org", slug: randomSlug("v3-cond") },
    });
    const orgId = (orgRes.json() as any).organization.id as string;

    const wfRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {
        name: "V3 condition",
        dsl: {
          version: "v3",
          trigger: { type: "trigger.manual" },
          graph: {
            nodes: {
              root: { id: "root", type: "http.request" },
              cond: { id: "cond", type: "condition", config: { path: "flag", op: "eq", value: true } },
              yes: { id: "yes", type: "http.request" },
              no: { id: "no", type: "http.request" },
            },
            edges: [
              { id: "e1", from: "root", to: "cond" },
              { id: "e2", from: "cond", to: "yes", kind: "cond_true" },
              { id: "e3", from: "cond", to: "no", kind: "cond_false" },
            ],
          },
        },
      },
    });
    expect(wfRes.statusCode).toBe(201);
    const workflowId = (wfRes.json() as any).workflow.id as string;

    const publish = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(publish.statusCode).toBe(200);

    const runRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: { input: { flag: true } },
    });
    expect(runRes.statusCode).toBe(201);
    const runId = (runRes.json() as any).run.id as string;

    const run = await waitForRun({ server, orgId, workflowId, runId, token, timeoutMs: 5000 });
    expect(run.status).toBe("succeeded");

    const steps = (run.output?.steps ?? []) as Array<{ nodeId: string }>;
    expect(steps.some((s) => s.nodeId === "yes")).toBe(true);
    expect(steps.some((s) => s.nodeId === "no")).toBe(false);
  });

  it("executes a v3 parallel fan-out and join (sequential execution, correct barrier)", async () => {
    if (!available || !server) {
      return;
    }

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `v3-par-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    const token = bearerToken(signup.json() as any);

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "V3 Par Org", slug: randomSlug("v3-par") },
    });
    const orgId = (orgRes.json() as any).organization.id as string;

    const wfRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: {
        name: "V3 parallel",
        dsl: {
          version: "v3",
          trigger: { type: "trigger.manual" },
          graph: {
            nodes: {
              root: { id: "root", type: "http.request" },
              a: { id: "a", type: "http.request" },
              b: { id: "b", type: "http.request" },
              join: { id: "join", type: "parallel.join", config: { mode: "all", failFast: true } },
              end: { id: "end", type: "http.request" },
            },
            edges: [
              { id: "e1", from: "root", to: "a" },
              { id: "e2", from: "root", to: "b" },
              { id: "e3", from: "a", to: "join" },
              { id: "e4", from: "b", to: "join" },
              { id: "e5", from: "join", to: "end" },
            ],
          },
        },
      },
    });
    expect(wfRes.statusCode).toBe(201);
    const workflowId = (wfRes.json() as any).workflow.id as string;

    const publish = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(publish.statusCode).toBe(200);

    const runRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      payload: { input: { any: true } },
    });
    expect(runRes.statusCode).toBe(201);
    const runId = (runRes.json() as any).run.id as string;

    const run = await waitForRun({ server, orgId, workflowId, runId, token, timeoutMs: 5000 });
    expect(run.status).toBe("succeeded");

    const steps = (run.output?.steps ?? []) as Array<{ nodeId: string }>;
    for (const id of ["root", "a", "b", "join", "end"]) {
      expect(steps.some((s) => s.nodeId === id)).toBe(true);
    }
  });
});

