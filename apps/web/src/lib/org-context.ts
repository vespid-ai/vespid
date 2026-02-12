const ACTIVE_ORG_STORAGE_KEY = "vespid.active-org-id";
const KNOWN_ORGS_STORAGE_KEY = "vespid.known-org-ids";

let activeOrgIdMemory: string | null = null;
const listeners = new Set<(value: string | null) => void>();

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readKnownOrgIds(): string[] {
  if (!canUseStorage()) {
    return [];
  }
  const raw = window.localStorage.getItem(KNOWN_ORGS_STORAGE_KEY);
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

function writeKnownOrgIds(ids: string[]): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(KNOWN_ORGS_STORAGE_KEY, JSON.stringify(ids));
}

function notifyListeners(value: string | null): void {
  for (const listener of listeners) {
    listener(value);
  }
}

export function getActiveOrgId(): string | null {
  if (activeOrgIdMemory) {
    return activeOrgIdMemory;
  }
  if (!canUseStorage()) {
    return null;
  }
  const fromStorage = window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
  if (!fromStorage) {
    return null;
  }
  activeOrgIdMemory = fromStorage;
  return fromStorage;
}

export function getKnownOrgIds(): string[] {
  return readKnownOrgIds();
}

export function setActiveOrgId(value: string): void {
  activeOrgIdMemory = value;
  if (canUseStorage()) {
    window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, value);
  }

  const known = readKnownOrgIds();
  if (!known.includes(value)) {
    known.unshift(value);
    writeKnownOrgIds(known.slice(0, 20));
  }

  notifyListeners(value);
}

export function clearActiveOrgId(): void {
  activeOrgIdMemory = null;
  if (canUseStorage()) {
    window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  }
  notifyListeners(null);
}

export function subscribeActiveOrg(listener: (value: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
