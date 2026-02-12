import { describe, expect, it } from "vitest";
import { signAuthToken, verifyAuthToken } from "./auth.js";

describe("auth token", () => {
  it("signs and verifies token", () => {
    const session = signAuthToken({
      userId: "u_1",
      email: "user@example.com",
      ttlSec: 60,
      nowMs: 1_700_000_000_000,
      secret: "secret",
    });

    const payload = verifyAuthToken(session.token, "secret", 1_700_000_000);
    expect(payload?.userId).toBe("u_1");
    expect(payload?.email).toBe("user@example.com");
  });

  it("returns null for invalid signature", () => {
    const session = signAuthToken({
      userId: "u_1",
      email: "user@example.com",
      secret: "secret",
    });

    expect(verifyAuthToken(session.token, "other")).toBeNull();
  });
});
