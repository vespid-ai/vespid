import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mocks = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
  getWorkflowRunById: vi.fn(),
  getWorkflowById: vi.fn(),
  getConnectorSecretById: vi.fn(),
  appendWorkflowRunEvent: vi.fn(),
  markWorkflowRunRunning: vi.fn(),
  markWorkflowRunQueuedForRetry: vi.fn(),
  markWorkflowRunSucceeded: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  parseDsl: vi.fn((input: unknown) => input),
}));

vi.mock("@vespid/db", () => ({
  createPool: vi.fn(),
  withTenantContext: mocks.withTenantContext,
  getWorkflowRunById: mocks.getWorkflowRunById,
  getWorkflowById: mocks.getWorkflowById,
  getConnectorSecretById: mocks.getConnectorSecretById,
  appendWorkflowRunEvent: mocks.appendWorkflowRunEvent,
  markWorkflowRunRunning: mocks.markWorkflowRunRunning,
  markWorkflowRunQueuedForRetry: mocks.markWorkflowRunQueuedForRetry,
  markWorkflowRunSucceeded: mocks.markWorkflowRunSucceeded,
  markWorkflowRunFailed: mocks.markWorkflowRunFailed,
}));

vi.mock("@vespid/workflow", () => ({
  workflowDslSchema: {
    parse: mocks.parseDsl,
  },
}));

import { processWorkflowRunJob } from "./main.js";
import type { EnterpriseProvider, WorkflowNodeExecutor } from "@vespid/shared";

const pool = {} as ReturnType<typeof import("@vespid/db").createPool>;
const jobBase = {
  data: {
    runId: "run-1",
    organizationId: "org-1",
    workflowId: "wf-1",
    requestedByUserId: "user-1",
  },
  attemptsMade: 0,
  opts: {
    attempts: 3,
  },
};

describe("workflow worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withTenantContext.mockImplementation(async (_pool: unknown, _ctx: unknown, fn: Function) => fn({}));
    mocks.getWorkflowRunById.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      workflowId: "wf-1",
      input: { k: "v" },
    });
    mocks.getWorkflowById.mockResolvedValue({
      id: "wf-1",
      organizationId: "org-1",
      status: "published",
      dsl: { version: "v2", trigger: { type: "trigger.manual" }, nodes: [{ id: "n1", type: "agent.execute" }] },
    });
    mocks.markWorkflowRunRunning.mockResolvedValue({ id: "run-1" });
    mocks.markWorkflowRunQueuedForRetry.mockResolvedValue({ id: "run-1" });
    mocks.markWorkflowRunSucceeded.mockResolvedValue({ id: "run-1" });
    mocks.markWorkflowRunFailed.mockResolvedValue({ id: "run-1" });
    mocks.appendWorkflowRunEvent.mockResolvedValue({ id: "evt-1" });
  });

  it("marks run succeeded on happy path", async () => {
    const executor: WorkflowNodeExecutor = {
      nodeType: "agent.execute",
      async execute() {
        return { status: "succeeded", output: { ok: true } };
      },
    };
    const executorRegistry = new Map<string, WorkflowNodeExecutor>([[executor.nodeType, executor]]);

    await processWorkflowRunJob(pool, jobBase, { executorRegistry });

    expect(mocks.markWorkflowRunRunning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        attemptCount: 1,
      })
    );
    expect(mocks.markWorkflowRunSucceeded).toHaveBeenCalledTimes(1);
    expect(mocks.markWorkflowRunQueuedForRetry).not.toHaveBeenCalled();
    expect(mocks.markWorkflowRunFailed).not.toHaveBeenCalled();
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "run_started" })
    );
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "node_started" })
    );
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "node_succeeded" })
    );
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "run_succeeded" })
    );
  });

  it("requeues and throws when execution fails before final attempt", async () => {
    const executor: WorkflowNodeExecutor = {
      nodeType: "agent.execute",
      async execute() {
        return { status: "failed", error: "boom" };
      },
    };
    const executorRegistry = new Map<string, WorkflowNodeExecutor>([[executor.nodeType, executor]]);

    await expect(processWorkflowRunJob(pool, { ...jobBase, attemptsMade: 0 }, { executorRegistry })).rejects.toThrow(
      "boom"
    );

    expect(mocks.markWorkflowRunQueuedForRetry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        error: "boom",
      })
    );
    expect(mocks.markWorkflowRunFailed).not.toHaveBeenCalled();
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "run_retried" })
    );
  });

  it("marks failed on final attempt", async () => {
    const executor: WorkflowNodeExecutor = {
      nodeType: "agent.execute",
      async execute() {
        return { status: "failed", error: "fatal" };
      },
    };
    const executorRegistry = new Map<string, WorkflowNodeExecutor>([[executor.nodeType, executor]]);

    await processWorkflowRunJob(
      pool,
      {
        ...jobBase,
        attemptsMade: 2,
        opts: { attempts: 3 },
      },
      { executorRegistry }
    );

    expect(mocks.markWorkflowRunQueuedForRetry).not.toHaveBeenCalled();
    expect(mocks.markWorkflowRunFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        error: "fatal",
      })
    );
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "run_failed" })
    );
  });

  it("prefers enterprise executors when provided via enterpriseProvider", async () => {
    const enterpriseExecutor: WorkflowNodeExecutor = {
      nodeType: "agent.execute",
      async execute() {
        return { status: "succeeded", output: { enterprise: true } };
      },
    };

    const enterpriseProvider: EnterpriseProvider = {
      edition: "enterprise",
      name: "test-enterprise",
      getCapabilities() {
        return [];
      },
      getWorkflowNodeExecutors() {
        return [enterpriseExecutor];
      },
    };

    await processWorkflowRunJob(pool, jobBase, { enterpriseProvider });

    expect(mocks.markWorkflowRunSucceeded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        output: expect.objectContaining({
          steps: [
            expect.objectContaining({
              nodeType: "agent.execute",
              status: "succeeded",
              output: { enterprise: true },
            }),
          ],
        }),
      })
    );
  });

  it("loads enterprise provider module dynamically and applies executor override", async () => {
    const fixturePath = path.resolve(process.cwd(), "../../tests/fixtures/enterprise-provider.mjs");
    const fixtureUrl = pathToFileURL(fixturePath).toString();
    const { loadEnterpriseProvider } = await import("@vespid/shared");

    const provider = await loadEnterpriseProvider({ modulePath: fixtureUrl });

    await processWorkflowRunJob(pool, jobBase, { enterpriseProvider: provider });

    expect(mocks.markWorkflowRunSucceeded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        output: expect.objectContaining({
          steps: [
            expect.objectContaining({
              nodeType: "agent.execute",
              status: "succeeded",
              output: expect.objectContaining({
                taskId: "n1-enterprise-task",
              }),
            }),
          ],
        }),
      })
    );
  });
});
