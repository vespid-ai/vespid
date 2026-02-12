import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../apps/api/src/server.js";

describe("api smoke", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  it("responds to healthz", async () => {
    server = await buildServer();
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });
});
