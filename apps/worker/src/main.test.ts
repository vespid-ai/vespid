import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
  getWorkflowRunById: vi.fn(),
  getWorkflowById: vi.fn(),
  getConnectorSecretById: vi.fn(),
  getOrganizationById: vi.fn(),
  appendWorkflowRunEvent: vi.fn(),
  markWorkflowRunRunning: vi.fn(),
  markWorkflowRunBlocked: vi.fn(),
  updateWorkflowRunProgress: vi.fn(),
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
  getOrganizationById: mocks.getOrganizationById,
  appendWorkflowRunEvent: mocks.appendWorkflowRunEvent,
  markWorkflowRunRunning: mocks.markWorkflowRunRunning,
  markWorkflowRunBlocked: mocks.markWorkflowRunBlocked,
  updateWorkflowRunProgress: mocks.updateWorkflowRunProgress,
  markWorkflowRunQueuedForRetry: mocks.markWorkflowRunQueuedForRetry,
  markWorkflowRunSucceeded: mocks.markWorkflowRunSucceeded,
  markWorkflowRunFailed: mocks.markWorkflowRunFailed,
}));

vi.mock("@vespid/workflow", () => ({
  workflowDslAnySchema: {
    parse: mocks.parseDsl,
  },
  validateV3GraphConstraints: vi.fn(() => ({ ok: true })),
}));

const gatewayMocks = vi.hoisted(() => ({
  dispatchViaGatewayAsync: vi.fn(),
}));

vi.mock("./gateway/client.js", () => ({
  dispatchViaGatewayAsync: gatewayMocks.dispatchViaGatewayAsync,
}));

import { processWorkflowRunJob } from "./main.js";
import type { WorkflowNodeExecutor } from "@vespid/shared";

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
    gatewayMocks.dispatchViaGatewayAsync.mockResolvedValue({ ok: true, requestId: "req-1", dispatched: true });
    mocks.withTenantContext.mockImplementation(async (_pool: unknown, _ctx: unknown, fn: Function) => fn({}));
    mocks.getOrganizationById.mockResolvedValue({ id: "org-1", settings: {} });
    mocks.getWorkflowRunById.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      workflowId: "wf-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      cursorNodeIndex: 0,
      blockedRequestId: null,
      output: null,
      input: { k: "v" },
    });
    mocks.getWorkflowById.mockResolvedValue({
      id: "wf-1",
      organizationId: "org-1",
      status: "published",
      dsl: { version: "v2", trigger: { type: "trigger.manual" }, nodes: [{ id: "n1", type: "agent.execute" }] },
    });
    mocks.markWorkflowRunRunning.mockResolvedValue({ id: "run-1" });
    mocks.markWorkflowRunBlocked.mockResolvedValue({ id: "run-1" });
    mocks.updateWorkflowRunProgress.mockResolvedValue({ id: "run-1" });
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

  it("blocks and dispatches when executor returns blocked", async () => {
    const executor: WorkflowNodeExecutor = {
      nodeType: "agent.execute",
      async execute() {
        return {
          status: "blocked",
          block: { kind: "agent.execute", payload: { hello: "world" }, dispatchNodeId: "n1:tool:1" },
          runtime: { agentRuns: { n1: { toolCalls: 1, turns: 1 } } },
        };
      },
    };
    const executorRegistry = new Map<string, WorkflowNodeExecutor>([[executor.nodeType, executor]]);

    const enqueueContinuationPoll = vi.fn().mockResolvedValue(undefined);

    await processWorkflowRunJob(pool, jobBase, { executorRegistry, enqueueContinuationPoll });

    expect(gatewayMocks.dispatchViaGatewayAsync).toHaveBeenCalledTimes(1);
    expect(mocks.markWorkflowRunBlocked).toHaveBeenCalledTimes(1);
    expect(mocks.markWorkflowRunSucceeded).not.toHaveBeenCalled();
    expect(enqueueContinuationPoll).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1", attemptCount: 1 })
    );
    expect(mocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "node_dispatched" })
    );
  });

  it("executes a v3 condition graph and only runs the selected branch", async () => {
    const exec: WorkflowNodeExecutor = {
      nodeType: "http.request",
      async execute() {
        return { status: "succeeded", output: { ok: true } };
      },
    };
    const executorRegistry = new Map<string, WorkflowNodeExecutor>([[exec.nodeType, exec]]);

    mocks.getWorkflowRunById.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      workflowId: "wf-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      cursorNodeIndex: 0,
      blockedRequestId: null,
      output: null,
      input: { flag: true },
    });

    mocks.getWorkflowById.mockResolvedValue({
      id: "wf-1",
      organizationId: "org-1",
      status: "published",
      dsl: {
        version: "v3",
        trigger: { type: "trigger.manual" },
        graph: {
          nodes: {
            root: { id: "root", type: "http.request" },
            cond: { id: "cond", type: "condition", config: { path: "flag", op: "eq", value: true } },
            a: { id: "a", type: "http.request" },
            b: { id: "b", type: "http.request" },
          },
          edges: [
            { id: "e1", from: "root", to: "cond" },
            { id: "e2", from: "cond", to: "a", kind: "cond_true" },
            { id: "e3", from: "cond", to: "b", kind: "cond_false" },
          ],
        },
      },
    });

    await processWorkflowRunJob(pool, jobBase, { executorRegistry });

    expect(mocks.markWorkflowRunSucceeded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        output: expect.objectContaining({
          steps: expect.arrayContaining([
            expect.objectContaining({ nodeId: "root", status: "succeeded" }),
            expect.objectContaining({ nodeId: "cond", status: "succeeded" }),
            expect.objectContaining({ nodeId: "a", status: "succeeded" }),
          ]),
        }),
      })
    );

    const call = mocks.markWorkflowRunSucceeded.mock.calls[mocks.markWorkflowRunSucceeded.mock.calls.length - 1]?.[1];
    const steps = call?.output?.steps ?? [];
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.some((s: any) => s.nodeId === "b")).toBe(false);
  });

  it("requeues when execution fails before final attempt", async () => {
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

    mocks.getWorkflowRunById.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      workflowId: "wf-1",
      status: "queued",
      attemptCount: 2,
      maxAttempts: 3,
      cursorNodeIndex: 0,
      blockedRequestId: null,
      output: null,
      input: { k: "v" },
    });

    await processWorkflowRunJob(pool, { ...jobBase, attemptsMade: 0 }, { executorRegistry });

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

});
