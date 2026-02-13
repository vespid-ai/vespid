import { describe, expect, it } from "vitest";
import { toBearerTokenHeader, VespidClient } from "./index.js";

describe("sdk client", () => {
  it("creates bearer header", () => {
    expect(toBearerTokenHeader("token-123")).toEqual({
      authorization: "Bearer token-123",
    });
  });

  it("normalizes base url", () => {
    const client = new VespidClient({
      baseUrl: "https://vespid.example/",
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true }))) as typeof fetch,
    });

    expect((client as unknown as { baseUrl: string }).baseUrl).toBe("https://vespid.example");
  });
});
