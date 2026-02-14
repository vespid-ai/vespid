import { describe, expect, it } from "vitest";
import { buildGatewayServer } from "./server.js";
import { createInMemoryResultsStore } from "./results-store.js";

describe("gateway server", () => {
  it("requires REDIS_URL in production when resultsStore is not injected", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldRedisUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    try {
      await expect(buildGatewayServer()).rejects.toThrow(/REDIS_URL_REQUIRED_IN_PRODUCTION/);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldRedisUrl) {
        process.env.REDIS_URL = oldRedisUrl;
      } else {
        delete process.env.REDIS_URL;
      }
    }
  });

  it("does not require REDIS_URL in production when resultsStore is injected", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldRedisUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    const server = await buildGatewayServer({
      resultsStore: createInMemoryResultsStore(),
      // Avoid connecting to DB in this unit test; gateway won't touch DB unless WS/auth is exercised.
      pool: { end: async () => {} } as any,
    });
    await server.close();
    process.env.NODE_ENV = oldNodeEnv;
    if (oldRedisUrl) {
      process.env.REDIS_URL = oldRedisUrl;
    } else {
      delete process.env.REDIS_URL;
    }
  });
});
