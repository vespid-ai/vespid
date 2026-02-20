import type { WorkflowRunEvent } from "./hooks/use-workflows";

const RUN_TERMINAL_EVENT_TYPES = new Set(["run_succeeded", "run_failed"]);
const NODE_REMOTE_RESOLVED_EVENT_TYPES = new Set(["remote_result_received", "node_succeeded", "node_failed"]);

function eventKind(event: WorkflowRunEvent): string {
  const type = typeof event.type === "string" ? event.type : null;
  const eventType = typeof (event as Record<string, unknown>).eventType === "string" ? ((event as Record<string, unknown>).eventType as string) : null;
  const legacy = typeof (event as Record<string, unknown>).event === "string" ? ((event as Record<string, unknown>).event as string) : null;
  return type ?? eventType ?? legacy ?? "event";
}

function eventNodeId(event: WorkflowRunEvent): string {
  const value = typeof event.nodeId === "string" ? event.nodeId : null;
  const legacy = typeof (event as Record<string, unknown>).node_id === "string" ? ((event as Record<string, unknown>).node_id as string) : null;
  return value ?? legacy ?? "";
}

function eventCreatedAt(event: WorkflowRunEvent): string {
  const value = typeof event.createdAt === "string" ? event.createdAt : null;
  const legacy = typeof (event as Record<string, unknown>).created_at === "string"
    ? ((event as Record<string, unknown>).created_at as string)
    : null;
  return value ?? legacy ?? "";
}

function eventRequestId(event: WorkflowRunEvent): string | null {
  const payload = (event as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.trim().length > 0 ? requestId : null;
}

function isRunStatusRunning(runStatus: string | null | undefined): boolean {
  return typeof runStatus === "string" && runStatus.toLowerCase() === "running";
}

export type PendingRemoteDispatch = {
  nodeId: string;
  requestId: string | null;
  dispatchedAt: string;
  elapsedMs: number | null;
  eventId: string | null;
  kind: string | null;
};

export function findPendingRemoteDispatch(
  events: WorkflowRunEvent[],
  runStatus: string | null | undefined,
  nowMs = Date.now()
): PendingRemoteDispatch | null {
  if (!isRunStatusRunning(runStatus) || events.length === 0) {
    return null;
  }

  const ordered = [...events].sort((a, b) => eventCreatedAt(a).localeCompare(eventCreatedAt(b)));

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const candidate = ordered[i];
    if (!candidate) {
      continue;
    }
    if (eventKind(candidate) !== "node_dispatched") {
      continue;
    }

    const nodeId = eventNodeId(candidate);
    if (!nodeId) {
      continue;
    }
    const requestId = eventRequestId(candidate);
    const createdAt = eventCreatedAt(candidate);

    let resolved = false;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const next = ordered[j];
      if (!next) {
        continue;
      }
      const nextKind = eventKind(next);
      if (RUN_TERMINAL_EVENT_TYPES.has(nextKind)) {
        resolved = true;
        break;
      }
      if (eventNodeId(next) !== nodeId) {
        continue;
      }
      if (NODE_REMOTE_RESOLVED_EVENT_TYPES.has(nextKind)) {
        resolved = true;
        break;
      }
    }

    if (resolved) {
      continue;
    }

    const dispatchedAtMs = Date.parse(createdAt);
    const elapsedMs = Number.isFinite(dispatchedAtMs) ? Math.max(0, nowMs - dispatchedAtMs) : null;
    const payload = (candidate as Record<string, unknown>).payload;
    const kind =
      payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).kind === "string"
        ? ((payload as Record<string, unknown>).kind as string)
        : null;

    return {
      nodeId,
      requestId,
      dispatchedAt: createdAt,
      elapsedMs,
      eventId: typeof candidate.id === "string" ? candidate.id : null,
      kind,
    };
  }

  return null;
}
