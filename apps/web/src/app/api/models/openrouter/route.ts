import { NextResponse } from "next/server";
import { parseOpenRouterModelsResponse } from "../../../../lib/models/openrouter";

type ModelsOk = {
  source: "openrouter";
  fetchedAt: string;
  data: ReturnType<typeof parseOpenRouterModelsResponse>;
  error?: {
    code: "UPSTREAM_UNAVAILABLE" | "UPSTREAM_ERROR" | "UPSTREAM_INVALID";
    message: string;
    status?: number;
  };
};

function safeInt(value: string | null, fallback: number, opts: { min: number; max: number }): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(opts.min, Math.min(opts.max, n));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = (url.searchParams.get("category") ?? "programming").trim() || "programming";
  const limit = safeInt(url.searchParams.get("limit"), 200, { min: 1, max: 500 });

  const upstream = new URL("https://openrouter.ai/api/v1/models");
  upstream.searchParams.set("category", category);

  const headers: Record<string, string> = {
    accept: "application/json",
  };

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey.trim().length > 0) {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }

  let resp: Response;
  try {
    resp = await fetch(upstream.toString(), {
      method: "GET",
      headers,
      next: { revalidate: 3600 },
    });
  } catch (err) {
    const payload: ModelsOk = {
      source: "openrouter",
      fetchedAt: new Date().toISOString(),
      data: [],
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: err instanceof Error ? err.message : String(err),
      },
    };
    return NextResponse.json(payload, { status: 200 });
  }

  if (!resp.ok) {
    const payload: ModelsOk = {
      source: "openrouter",
      fetchedAt: new Date().toISOString(),
      data: [],
      error: {
        code: resp.status >= 500 ? "UPSTREAM_ERROR" : "UPSTREAM_UNAVAILABLE",
        message: `OpenRouter request failed (${resp.status}).`,
        status: resp.status,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    const payload: ModelsOk = {
      source: "openrouter",
      fetchedAt: new Date().toISOString(),
      data: [],
      error: {
        code: "UPSTREAM_INVALID",
        message: "OpenRouter response is not valid JSON.",
      },
    };
    return NextResponse.json(payload, { status: 200 });
  }

  const mapped = parseOpenRouterModelsResponse(json).slice(0, limit);
  const payload: ModelsOk = {
    source: "openrouter",
    fetchedAt: new Date().toISOString(),
    data: mapped,
  };

  return NextResponse.json(payload, { status: 200 });
}

