import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
  getWorkflowRunById: vi.fn(),
  getWorkflowById: vi.fn(),
  markWorkflowRunRunning: vi.fn(),
  markWorkflowRunQueuedForRetry: vi.fn(),
  markWorkflowRunSucceeded: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  executeWorkflow: vi.fn(),
  parseDsl: vi.fn((input: unknown) => input),
}));

vi.mock("@vespid/db", () => ({
  createDb: vi.fn(),
  createPool: vi.fn(),
  withTenantContext: mocks.withTenantContext,
  getWorkflowRunById: mocks.getWorkflowRunById,
  getWorkflowById: mocks.getWorkflowById,
  markWorkflowRunRunning: mocks.markWorkflowRunRunning,
  markWorkflowRunQueuedForRetry: mocks.markWorkflowRunQueuedForRetry,
  markWorkflowRunSucceeded: mocks.markWorkflowRunSucceeded,
  markWorkflowRunFailed: mocks.markWorkflowRunFailed,
}));

vi.mock("@vespid/workflow", () => ({
  executeWorkflow: mocks.executeWorkflow,
  workflowDslSchema: {
    parse: mocks.parseDsl,
  },
}));

import { processWorkflowRunJob } from "./main.js";

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
  });

  it("marks run succeeded on happy path", async () => {
    mocks.executeWorkflow.mockReturnValue({
      status: "succeeded",
      steps: [],
      output: { completedNodeCount: 1, failedNodeId: null },
    });

    await processWorkflowRunJob(pool, jobBase);

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
  });

  it("requeues and throws when execution fails before final attempt", async () => {
    mocks.executeWorkflow.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(processWorkflowRunJob(pool, { ...jobBase, attemptsMade: 0 })).rejects.toThrow("boom");

    expect(mocks.markWorkflowRunQueuedForRetry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        error: "boom",
      })
    );
    expect(mocks.markWorkflowRunFailed).not.toHaveBeenCalled();
  });

  it("marks failed on final attempt", async () => {
    mocks.executeWorkflow.mockImplementation(() => {
      throw new Error("fatal");
    });

    await processWorkflowRunJob(pool, {
      ...jobBase,
      attemptsMade: 2,
      opts: { attempts: 3 },
    });

    expect(mocks.markWorkflowRunQueuedForRetry).not.toHaveBeenCalled();
    expect(mocks.markWorkflowRunFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "run-1",
        error: "fatal",
      })
    );
  });
});
