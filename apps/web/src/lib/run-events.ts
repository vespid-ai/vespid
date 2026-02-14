import type { WorkflowRunEvent } from "./hooks/use-workflows";

export type AttemptGroup = {
  attempt: number | null;
  events: WorkflowRunEvent[];
};

function attemptOf(event: WorkflowRunEvent): number | null {
  const value = event.attemptCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createdAtOf(event: WorkflowRunEvent): string {
  const value = event.createdAt;
  return typeof value === "string" ? value : "";
}

export function groupEventsByAttempt(events: WorkflowRunEvent[]): AttemptGroup[] {
  const map = new Map<string, WorkflowRunEvent[]>();

  for (const event of events) {
    const attempt = attemptOf(event);
    const key = attempt === null ? "unknown" : String(attempt);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      map.set(key, [event]);
    }
  }

  const groups: AttemptGroup[] = [];
  for (const [key, items] of map.entries()) {
    const attempt = key === "unknown" ? null : Number(key);
    items.sort((a, b) => createdAtOf(a).localeCompare(createdAtOf(b)));
    groups.push({ attempt: Number.isFinite(attempt) ? attempt : null, events: items });
  }

  groups.sort((a, b) => {
    if (a.attempt === null && b.attempt === null) return 0;
    if (a.attempt === null) return 1;
    if (b.attempt === null) return -1;
    return a.attempt - b.attempt;
  });

  return groups;
}
