import { getActiveOrgId } from "./org-context";

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
}

type ApiFetchOptions = {
  orgScoped?: boolean;
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

  return fetch(`${getApiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

export type ApiJsonError = {
  code?: string;
  message?: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ApiJsonError | null;

  constructor(status: number, payload: ApiJsonError | null) {
    super(payload?.message ?? `Request failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

export async function apiFetchJson<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T> {
  const response = await apiFetch(path, init, options);
  const text = await response.text();
  const payload = text.length ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiError(response.status, (payload as ApiJsonError | null) ?? null);
  }
  return payload as T;
}
