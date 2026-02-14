import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
  getWorkflowRunById: vi.fn(),
  getWorkflowById: vi.fn(),
  appendWorkflowRunEvent: vi.fn(),
  clearWorkflowRunBlock: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunQueuedForRetry: vi.fn(),
}));

vi.mock("@vespid/db", () => ({
  createPool: vi.fn(),
  withTenantContext: dbMocks.withTenantContext,
  getWorkflowRunById: dbMocks.getWorkflowRunById,
  getWorkflowById: dbMocks.getWorkflowById,
  appendWorkflowRunEvent: dbMocks.appendWorkflowRunEvent,
  clearWorkflowRunBlock: dbMocks.clearWorkflowRunBlock,
  markWorkflowRunFailed: dbMocks.markWorkflowRunFailed,
  markWorkflowRunQueuedForRetry: dbMocks.markWorkflowRunQueuedForRetry,
}));

const gatewayMocks = vi.hoisted(() => ({
  fetchGatewayResult: vi.fn(),
}));

vi.mock("../gateway/client.js", () => ({
  fetchGatewayResult: gatewayMocks.fetchGatewayResult,
}));

import { processContinuationPayload } from "./worker.js";

describe("continuation worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.withTenantContext.mockImplementation(async (_pool: unknown, _ctx: unknown, fn: Function) => fn({}));
    dbMocks.appendWorkflowRunEvent.mockResolvedValue({ id: "evt-1" });
    dbMocks.clearWorkflowRunBlock.mockResolvedValue({ id: "run-1" });
    dbMocks.markWorkflowRunFailed.mockResolvedValue({ id: "run-1" });
    dbMocks.markWorkflowRunQueuedForRetry.mockResolvedValue({ id: "run-1" });

    dbMocks.getWorkflowRunById.mockResolvedValue({
      id: "run-1",
      organizationId: "org-1",
      workflowId: "wf-1",
      status: "running",
      attemptCount: 1,
      cursorNodeIndex: 0,
      blockedRequestId: "req-1",
      blockedTimeoutAt: null,
      requestedByUserId: "user-1",
      maxAttempts: 3,
      output: { status: "succeeded", steps: [], output: { completedNodeCount: 0, failedNodeId: null } },
    });

    dbMocks.getWorkflowById.mockResolvedValue({
      id: "wf-1",
      organizationId: "org-1",
      status: "published",
      dsl: {
        version: "v2",
        trigger: { type: "trigger.manual" },
        nodes: [{ id: "n1", type: "agent.execute" }],
      },
    });

    gatewayMocks.fetchGatewayResult.mockResolvedValue({
      ok: true,
      result: { status: "succeeded", output: { ok: true } },
    });
  });

  it("stores remote result in runtime and re-enqueues the run without advancing the cursor", async () => {
    const runQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const pool = {} as any;

    await processContinuationPayload({
      pool,
      runQueue,
      payload: {
        type: "remote.poll",
        organizationId: "org-1",
        workflowId: "wf-1",
        runId: "run-1",
        requestId: "req-1",
        attemptCount: 1,
      },
    });

    expect(dbMocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "remote_result_received", nodeId: "n1" })
    );
    expect(dbMocks.clearWorkflowRunBlock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRequestId: "req-1",
        output: expect.objectContaining({
          runtime: expect.objectContaining({
            pendingRemoteResult: expect.objectContaining({
              requestId: "req-1",
            }),
          }),
        }),
      })
    );
    expect(runQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ runId: "run-1", organizationId: "org-1", workflowId: "wf-1" }),
      })
    );
  });

  it("stores remote events without clearing the block", async () => {
    const runQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const pool = {} as any;

    await processContinuationPayload({
      pool,
      runQueue,
      payload: {
        type: "remote.event",
        organizationId: "org-1",
        workflowId: "wf-1",
        runId: "run-1",
        requestId: "req-1",
        attemptCount: 1,
        event: { seq: 1, ts: Date.now(), kind: "agent.assistant", level: "info", payload: { content: "hi" } },
      },
    });

    expect(dbMocks.appendWorkflowRunEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "remote_event", nodeId: "n1", message: "agent.assistant" })
    );
    expect(dbMocks.clearWorkflowRunBlock).not.toHaveBeenCalled();
    expect(runQueue.enqueue).not.toHaveBeenCalled();
  });
});
