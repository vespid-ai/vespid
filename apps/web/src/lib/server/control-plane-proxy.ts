import { NextResponse } from "next/server";
import { cookies } from "next/headers";

type NetworkErrorPayload = {
  code: "NETWORK_ERROR" | "UPSTREAM_ERROR";
  message: string;
  base: string;
  status?: number;
};

function getControlPlaneBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
}

function parseErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function readSetCookieHeaders(upstream: Response): string[] {
  // Node.js fetch exposes getSetCookie(); some runtimes expose only set-cookie.
  const getSetCookie = (upstream.headers as any).getSetCookie?.bind(upstream.headers);
  if (typeof getSetCookie === "function") {
    return getSetCookie() as string[];
  }
  const single = upstream.headers.get("set-cookie");
  return single ? [single] : [];
}

function buildUpstreamUrl(request: Request, pathParts: string[]): string {
  const base = getControlPlaneBase();
  const url = new URL(request.url);
  const upstreamPath = `/${pathParts.map((part) => encodeURIComponent(part)).join("/")}`;
  return `${base}${upstreamPath}${url.search}`;
}

async function filterRequestHeaders(request: Request): Promise<Headers> {
  const headers = new Headers();
  const passthrough = ["content-type", "accept", "x-org-id", "authorization", "user-agent"];
  for (const key of passthrough) {
    const value = request.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }

  // Prefer forwarding the incoming cookie header as-is; fall back to Next's
  // cookies() helper when the request doesn't carry it (e.g. server-side calls).
  const incomingCookie = request.headers.get("cookie");
  if (incomingCookie && incomingCookie.trim().length > 0) {
    headers.set("cookie", incomingCookie);
    return headers;
  }

  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return headers;
}

export async function proxyControlPlaneRequest(request: Request, pathParts: string[]) {
  const base = getControlPlaneBase();
  const upstreamUrl = buildUpstreamUrl(request, pathParts);

  let upstream: Response;
  try {
    const init: RequestInit = {
      method: request.method,
      headers: await filterRequestHeaders(request),
      cache: "no-store",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }
    upstream = await fetch(upstreamUrl, init);
  } catch (err) {
    const payload: NetworkErrorPayload = { code: "NETWORK_ERROR", message: parseErrorMessage(err), base };
    return NextResponse.json(payload, { status: 503 });
  }

  if (upstream.status >= 500) {
    const payload: NetworkErrorPayload = {
      code: "UPSTREAM_ERROR",
      message: `Control plane API error (${upstream.status}).`,
      base,
      status: upstream.status,
    };
    return NextResponse.json(payload, { status: 503 });
  }

  const text = await upstream.text();
  const response = new NextResponse(text.length ? text : "{}", {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });

  // Preserve refresh cookie updates (Node.js fetch exposes getSetCookie()).
  const setCookies = readSetCookieHeaders(upstream);
  for (const value of setCookies) {
    response.headers.append("set-cookie", value);
  }

  // Bubble up the access token header for debugging (the UI does not rely on it).
  const accessToken = upstream.headers.get("x-access-token");
  if (accessToken) {
    response.headers.set("x-access-token", accessToken);
  }

  return response;
}

