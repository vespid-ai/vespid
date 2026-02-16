import { describe, expect, it } from "vitest";
import { buildGatewayServer } from "./server.js";

describe("gateway server", () => {
  it("requires REDIS_URL in production", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldRedisUrl = process.env.REDIS_URL;
    const oldDatabaseUrl = process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/vespid";
    try {
      await expect(buildGatewayServer()).rejects.toThrow(/REDIS_URL_REQUIRED/);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldRedisUrl) {
        process.env.REDIS_URL = oldRedisUrl;
      } else {
        delete process.env.REDIS_URL;
      }
      if (oldDatabaseUrl) {
        process.env.DATABASE_URL = oldDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  it("still requires REDIS_URL when resultsStore is injected", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldRedisUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    try {
      await expect(
        buildGatewayServer({
          // Avoid connecting to DB in this unit test; gateway won't touch DB unless WS/auth is exercised.
          pool: { end: async () => {} } as any,
        })
      ).rejects.toThrow(/REDIS_URL_REQUIRED/);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldRedisUrl) {
        process.env.REDIS_URL = oldRedisUrl;
      } else {
        delete process.env.REDIS_URL;
      }
    }
  });
});
