export type ApiReachability = {
  base: string;
  unreachableAt?: number;
  lastError?: string;
};

const STORAGE_KEY = "vespid.ui.apiReachability.v1";
const EVENT_NAME = "vespid:api-reachability";

function safeNow(): number {
  return Date.now();
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readFromStorage(): ApiReachability | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const base = typeof (parsed as any).base === "string" ? (parsed as any).base : "";
    if (!base) return null;
    const unreachableAt = typeof (parsed as any).unreachableAt === "number" ? (parsed as any).unreachableAt : null;
    const lastError = typeof (parsed as any).lastError === "string" ? (parsed as any).lastError : null;

    const value: ApiReachability = { base };
    if (unreachableAt !== null) value.unreachableAt = unreachableAt;
    if (lastError !== null) value.lastError = lastError;
    return value;
  } catch {
    return null;
  }
}

function writeToStorage(value: ApiReachability): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function getApiReachability(): ApiReachability {
  return readFromStorage() ?? { base: "" };
}

export function subscribeApiReachability(cb: (value: ApiReachability) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(getApiReachability());
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}

export function markApiUnreachable(base: string, message: string): void {
  writeToStorage({ base, unreachableAt: safeNow(), lastError: message });
}

export function markApiReachable(base: string): void {
  const current = readFromStorage();
  if (!current || current.base !== base) {
    writeToStorage({ base });
    return;
  }
  if (typeof current.unreachableAt === "number" || typeof current.lastError === "string") {
    writeToStorage({ base });
  }
}
