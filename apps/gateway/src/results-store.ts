import { Redis } from "ioredis";

export type GatewayStoredResult = {
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
};

export type ResultsStore = {
  get(requestId: string): Promise<GatewayStoredResult | null>;
  set(requestId: string, value: GatewayStoredResult, ttlSec: number): Promise<void>;
  close(): Promise<void>;
};

function keyFor(requestId: string): string {
  return `gateway:results:${requestId}`;
}

export function createInMemoryResultsStore(): ResultsStore {
  const map = new Map<string, { value: GatewayStoredResult; expiresAtMs: number }>();

  return {
    async get(requestId) {
      const entry = map.get(requestId);
      if (!entry) {
        return null;
      }
      if (Date.now() >= entry.expiresAtMs) {
        map.delete(requestId);
        return null;
      }
      return entry.value;
    },
    async set(requestId, value, ttlSec) {
      map.set(requestId, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
    },
    async close() {
      map.clear();
    },
  };
}

export function createRedisResultsStore(redisUrl: string): ResultsStore {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  async function safeCloseRedis() {
    // quit() can hang if the connection is unhealthy; disconnect() is best-effort.
    const timeoutMs = 2000;
    try {
      await Promise.race([
        redis.quit(),
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), timeoutMs).unref?.();
        }),
      ]);
    } finally {
      try {
        redis.disconnect();
      } catch {
        // ignore
      }
    }
  }

  return {
    async get(requestId) {
      const raw = await redis.get(keyFor(requestId));
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as GatewayStoredResult;
      } catch {
        return null;
      }
    },
    async set(requestId, value, ttlSec) {
      await redis.set(keyFor(requestId), JSON.stringify(value), "EX", ttlSec);
    },
    async close() {
      await safeCloseRedis();
    },
  };
}
