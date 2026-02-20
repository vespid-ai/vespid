import { describe, expect, it } from "vitest";
import { findPendingRemoteDispatch } from "./run-pending-remote";
import type { WorkflowRunEvent } from "./hooks/use-workflows";

function event(input: Partial<WorkflowRunEvent> & { type?: string; eventType?: string }): WorkflowRunEvent {
  return {
    id: input.id,
    type: input.type,
    nodeId: input.nodeId,
    createdAt: input.createdAt,
    attemptCount: input.attemptCount,
    ...(input.eventType ? { eventType: input.eventType } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
  } as WorkflowRunEvent;
}

describe("findPendingRemoteDispatch", () => {
  it("returns pending dispatch when callback has not arrived", () => {
    const events: WorkflowRunEvent[] = [
      event({ id: "e1", eventType: "node_started", nodeId: "n1", createdAt: "2026-02-19T12:00:00.000Z" }),
      event({
        id: "e2",
        eventType: "node_dispatched",
        nodeId: "n1",
        createdAt: "2026-02-19T12:00:01.000Z",
        payload: { requestId: "req-1", kind: "agent.run" },
      }),
    ];
    const pending = findPendingRemoteDispatch(events, "running", Date.parse("2026-02-19T12:00:05.000Z"));
    expect(pending).toBeTruthy();
    expect(pending?.requestId).toBe("req-1");
    expect(pending?.nodeId).toBe("n1");
    expect(pending?.elapsedMs).toBe(4000);
  });

  it("returns null when remote result is received", () => {
    const events: WorkflowRunEvent[] = [
      event({
        id: "e1",
        eventType: "node_dispatched",
        nodeId: "n1",
        createdAt: "2026-02-19T12:00:01.000Z",
        payload: { requestId: "req-1", kind: "agent.run" },
      }),
      event({
        id: "e2",
        eventType: "remote_result_received",
        nodeId: "n1",
        createdAt: "2026-02-19T12:00:03.000Z",
      }),
    ];
    const pending = findPendingRemoteDispatch(events, "running", Date.parse("2026-02-19T12:00:05.000Z"));
    expect(pending).toBeNull();
  });

  it("returns null when run is no longer running", () => {
    const events: WorkflowRunEvent[] = [
      event({
        id: "e1",
        eventType: "node_dispatched",
        nodeId: "n1",
        createdAt: "2026-02-19T12:00:01.000Z",
        payload: { requestId: "req-1" },
      }),
    ];
    expect(findPendingRemoteDispatch(events, "succeeded", Date.parse("2026-02-19T12:00:05.000Z"))).toBeNull();
  });

  it("returns null when run terminal event is emitted after dispatch", () => {
    const events: WorkflowRunEvent[] = [
      event({
        id: "e1",
        eventType: "node_dispatched",
        nodeId: "n1",
        createdAt: "2026-02-19T12:00:01.000Z",
        payload: { requestId: "req-1" },
      }),
      event({
        id: "e2",
        eventType: "run_failed",
        createdAt: "2026-02-19T12:00:02.000Z",
      }),
    ];
    expect(findPendingRemoteDispatch(events, "running", Date.parse("2026-02-19T12:00:05.000Z"))).toBeNull();
  });
});
