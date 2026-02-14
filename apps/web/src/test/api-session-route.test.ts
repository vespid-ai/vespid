import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../app/api/session/route";

describe("/api/session route", () => {
  const base = "http://control-plane.test";

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE = base;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps upstream 401 to 200 {}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401, headers: { "content-type": "application/json" } }))
    );

    const res = await GET(new Request("http://localhost/api/session"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("maps upstream 500 to 503 UPSTREAM_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500, headers: { "content-type": "text/plain" } }))
    );

    const res = await GET(new Request("http://localhost/api/session"));
    expect(res.status).toBe(503);
    const payload = (await res.json()) as any;
    expect(payload.code).toBe("UPSTREAM_ERROR");
    expect(payload.base).toBe(base);
  });
});

