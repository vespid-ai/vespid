import { clearActiveOrgId, getActiveOrgId, setActiveOrgId } from "./org-context";
import { markApiReachable, markApiUnreachable } from "./api-reachability";

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
}

type ApiFetchOptions = {
  orgScoped?: boolean;
  skipOrgRecovery?: boolean;
};

type NetworkErrorPayload = {
  code: "NETWORK_ERROR";
  message: string;
  details?: unknown;
};

export async function apiFetch(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<Response> {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }

  if (options?.orgScoped) {
    const orgId = getActiveOrgId();
    if (orgId) {
      headers.set("x-org-id", orgId);
    }
  }

  try {
    const base = getApiBase();
    // In browsers, route through the Next.js BFF proxy so cookie-based auth works
    // without cross-origin SameSite edge cases (localhost port differences).
    const url = typeof window === "undefined" ? `${base}${path}` : `/api/proxy${path}`;
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });
    markApiReachable(base);
    return response;
  } catch (err) {
    // `fetch()` throws TypeError on network errors and on CORS rejections.
    const message = err instanceof Error ? err.message : String(err);
    const payload: NetworkErrorPayload = { code: "NETWORK_ERROR", message };
    markApiUnreachable(getApiBase(), message);

    return new Response(JSON.stringify(payload), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

export type ApiJsonError = {
  code?: string;
  message?: string;
  details?: unknown;
};

let orgRecoveryInFlight: Promise<string | null> | null = null;

function parseJsonSafe<T>(text: string): T | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isRecoverableOrgError(status: number, payload: ApiJsonError | null): boolean {
  if (![400, 403].includes(status)) {
    return false;
  }
  const code = payload?.code ?? "";
  if (code === "INVALID_ORG_CONTEXT" || code === "ORG_CONTEXT_REQUIRED" || code === "ORG_ACCESS_DENIED") {
    return true;
  }
  const message = (payload?.message ?? "").toLowerCase();
  return message.includes("x-org-id") || message.includes("organization context");
}

async function recoverDefaultOrgId(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }
  if (orgRecoveryInFlight) {
    return orgRecoveryInFlight;
  }
  orgRecoveryInFlight = (async () => {
    try {
      const response = await fetch("/api/proxy/v1/me", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        return null;
      }
      const payload = parseJsonSafe<{ defaultOrgId?: string | null }>(await response.text());
      const defaultOrgId = typeof payload?.defaultOrgId === "string" ? payload.defaultOrgId : null;
      if (defaultOrgId) {
        setActiveOrgId(defaultOrgId);
        return defaultOrgId;
      }
      clearActiveOrgId();
      return null;
    } catch {
      return null;
    } finally {
      orgRecoveryInFlight = null;
    }
  })();
  return orgRecoveryInFlight;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiJsonError | null;

  constructor(status: number, payload: ApiJsonError | null) {
    super(payload?.message ?? `Request failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403;
  }
  if (error && typeof error === "object") {
    const status = (error as any).status;
    if (status === 401 || status === 403) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = message.toLowerCase();
  return normalized.includes("401") || normalized.includes("403") || normalized.includes("unauthorized") || normalized.includes("forbidden");
}

export async function apiFetchJson<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T> {
  const response = await apiFetch(path, init, options);
  const text = await response.text();
  let payload: unknown = null;
  if (text.length) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { code: "INVALID_JSON", message: "Server returned a non-JSON response.", details: { preview: text.slice(0, 512) } };
    }
  }
  if (!response.ok) {
    const apiPayload = (payload as ApiJsonError | null) ?? null;
    if (options?.orgScoped && !options?.skipOrgRecovery && isRecoverableOrgError(response.status, apiPayload)) {
      const previousOrgId = getActiveOrgId();
      const recoveredOrgId = await recoverDefaultOrgId();
      if (recoveredOrgId && recoveredOrgId !== previousOrgId) {
        return apiFetchJson<T>(path, init, { ...options, skipOrgRecovery: true });
      }
      throw new ApiError(response.status, {
        code: apiPayload?.code ?? "ORG_CONTEXT_INVALID",
        message: "Organization context is out of date. Please try again.",
      });
    }
    throw new ApiError(response.status, apiPayload);
  }
  return payload as T;
}
