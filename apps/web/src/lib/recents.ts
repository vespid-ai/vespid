const RECENT_WORKFLOWS_KEY = "vespid.recent-workflow-ids";

function recentRunsKey(workflowId: string): string {
  return `vespid.recent-run-ids:${workflowId}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList(key: string): string[] {
  if (!canUseStorage()) {
    return [];
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[]): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(ids));
}

function addRecent(key: string, id: string, limit = 20): void {
  const trimmed = id.trim();
  if (!trimmed) {
    return;
  }
  const current = readList(key);
  const next = [trimmed, ...current.filter((x) => x !== trimmed)].slice(0, limit);
  writeList(key, next);
}

export function getRecentWorkflowIds(): string[] {
  return readList(RECENT_WORKFLOWS_KEY);
}

export function addRecentWorkflowId(workflowId: string): void {
  addRecent(RECENT_WORKFLOWS_KEY, workflowId);
}

export function getRecentRunIds(workflowId: string): string[] {
  return readList(recentRunsKey(workflowId));
}

export function addRecentRunId(workflowId: string, runId: string): void {
  addRecent(recentRunsKey(workflowId), runId);
}
