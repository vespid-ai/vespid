import { defineConfig } from "vitest/config";

// Integration tests spin up real Postgres + Redis + BullMQ + Fastify services.
// Default Vitest timeouts are too tight, especially on cold CI runners.
export default defineConfig({
  test: {
    setupFiles: ["./setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
  },
});
