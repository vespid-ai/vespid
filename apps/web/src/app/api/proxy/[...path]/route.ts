import { NextResponse } from "next/server";

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

function buildUpstreamUrl(request: Request, pathParts: string[]): string {
  const base = getControlPlaneBase();
  const url = new URL(request.url);
  const upstreamPath = `/${pathParts.map((part) => encodeURIComponent(part)).join("/")}`;
  return `${base}${upstreamPath}${url.search}`;
}

function filterRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  const passthrough = [
    "content-type",
    "accept",
    "x-org-id",
    "authorization",
    "cookie",
    "user-agent",
  ];
  for (const key of passthrough) {
    const value = request.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function proxy(request: Request, pathParts: string[]) {
  const base = getControlPlaneBase();
  const upstreamUrl = buildUpstreamUrl(request, pathParts);

  let upstream: Response;
  try {
    const init: RequestInit = {
      method: request.method,
      headers: filterRequestHeaders(request),
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
  const getSetCookie = (upstream.headers as any).getSetCookie?.bind(upstream.headers);
  const setCookies: string[] = typeof getSetCookie === "function" ? getSetCookie() : [];
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

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxy(request, params.path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxy(request, params.path);
}

export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxy(request, params.path);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxy(request, params.path);
}
