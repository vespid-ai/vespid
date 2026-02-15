import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const base = getControlPlaneBase();
  let cookie = "";
  try {
    // In Next.js runtime this is always available. In unit tests it may be called
    // outside a request scope; treat that as "anonymous browsing".
    const jar = await cookies();
    cookie = jar
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    cookie = "";
  }

  let upstream: Response;
  try {
    const init: RequestInit = {
      method: "POST",
      // Avoid caching refresh results in edge/CDN layers.
      cache: "no-store",
    };
    if (cookie) {
      init.headers = { cookie };
    }

    upstream = await fetch(`${base}/v1/auth/refresh`, {
      ...init,
    });
  } catch (err) {
    const payload: NetworkErrorPayload = { code: "NETWORK_ERROR", message: parseErrorMessage(err), base };
    return NextResponse.json(payload, { status: 503 });
  }

  // Anonymous browsing: expected outcome. Return OK so the browser doesn't
  // log "Failed to load resource" noise for a 401.
  if (upstream.status === 401 || upstream.status === 403) {
    return NextResponse.json({}, { status: 200 });
  }

  // If the control plane API is unhealthy, surface a soft error that the UI
  // can treat as "anonymous" without taking down the shell.
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
    status: upstream.ok ? 200 : upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });

  // Preserve refresh cookie updates.
  const getSetCookie = (upstream.headers as any).getSetCookie?.bind(upstream.headers);
  const setCookies: string[] = typeof getSetCookie === "function" ? getSetCookie() : [];
  for (const value of setCookies) {
    response.headers.append("set-cookie", value);
  }

  return response;
}
