import { describe, expect, it } from "vitest";
import { isExecutorOauthVerified } from "./scheduler.js";

describe("scheduler oauth verification", () => {
  it("returns true only when executor reports oauthVerified=true", () => {
    expect(
      isExecutorOauthVerified(
        {
          engineAuth: {
            "gateway.codex.v2": {
              oauthVerified: true,
              checkedAt: "2026-01-01T00:00:00.000Z",
              reason: "verified",
            },
          },
        },
        "gateway.codex.v2"
      )
    ).toBe(true);

    expect(
      isExecutorOauthVerified(
        {
          engineAuth: {
            "gateway.codex.v2": {
              oauthVerified: false,
              checkedAt: "2026-01-01T00:00:00.000Z",
              reason: "unauthenticated",
            },
          },
        },
        "gateway.codex.v2"
      )
    ).toBe(false);

    expect(isExecutorOauthVerified({ engineAuth: {} }, "gateway.codex.v2")).toBe(false);
  });
});
