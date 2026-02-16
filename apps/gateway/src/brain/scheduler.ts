import type { Redis } from "ioredis";
import { z } from "zod";
import { executorInFlightKey, executorLastUsedKey, executorRouteKey, orgInFlightKey } from "../bus/keys.js";
import { safeJsonParse, safeJsonStringify } from "../bus/codec.js";

const routeSchema = z.object({
  edgeId: z.string().min(1),
  executorId: z.string().uuid(),
  pool: z.enum(["managed", "byon"]),
  organizationId: z.string().uuid().nullable().optional(),
  labels: z.array(z.string()).optional(),
  maxInFlight: z.number().int().min(1).optional(),
  kinds: z.array(z.enum(["connector.action", "agent.execute"])).optional(),
  lastSeenAtMs: z.number().optional(),
});

export type ExecutorRoute = z.infer<typeof routeSchema>;

export async function getExecutorRoute(redis: Redis, executorId: string): Promise<ExecutorRoute | null> {
  const raw = await redis.get(executorRouteKey(executorId));
  if (!raw) return null;
  const parsed = routeSchema.safeParse(safeJsonParse(raw));
  return parsed.success ? parsed.data : null;
}

async function scanKeys(redis: Redis, pattern: string, limit = 5000): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  for (;;) {
    const [next, keys] = (await redis.scan(cursor, "MATCH", pattern, "COUNT", "200")) as unknown as [string, string[]];
    for (const key of keys) {
      out.push(key);
      if (out.length >= limit) {
        return out;
      }
    }
    cursor = next;
    if (cursor === "0") {
      return out;
    }
  }
}

export async function listExecutorRoutes(
  redis: Redis,
  input?: { organizationId?: string | null; pool?: "managed" | "byon" | null }
): Promise<ExecutorRoute[]> {
  const keys = await scanKeys(redis, "executor:route:*");
  if (keys.length === 0) return [];
  const raw = await redis.mget(...keys);
  const out: ExecutorRoute[] = [];
  for (const value of raw) {
    if (!value) continue;
    const parsed = routeSchema.safeParse(safeJsonParse(value));
    if (!parsed.success) continue;
    if (input?.pool && parsed.data.pool !== input.pool) continue;
    if (input?.organizationId && parsed.data.organizationId !== input.organizationId) continue;
    out.push(parsed.data);
  }
  return out;
}

export async function markExecutorUsed(redis: Redis, executorId: string, nowMs = Date.now()): Promise<void> {
  // Best-effort: keep small LRU signal for tie-breaking.
  try {
    await redis.set(executorLastUsedKey(executorId), String(nowMs), "PX", 60 * 60 * 1000);
  } catch {
    // ignore
  }
}

const reserveLua = `
local execKey = KEYS[1]
local orgKey = KEYS[2]
local execMax = tonumber(ARGV[1])
local orgMax = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])

local execVal = tonumber(redis.call("GET", execKey) or "0")
local orgVal = tonumber(redis.call("GET", orgKey) or "0")

if execVal + 1 > execMax then
  return 1
end
if orgVal + 1 > orgMax then
  return 2
end

execVal = redis.call("INCR", execKey)
orgVal = redis.call("INCR", orgKey)
redis.call("PEXPIRE", execKey, ttlMs)
redis.call("PEXPIRE", orgKey, ttlMs)
return 0
`;

export type ReserveCapacityResult =
  | { ok: true }
  | { ok: false; reason: "EXECUTOR_OVER_CAPACITY" | "ORG_QUOTA_EXCEEDED" | "UNKNOWN" };

export async function reserveCapacity(
  redis: Redis,
  input: { executorId: string; organizationId: string; executorMaxInFlight: number; orgMaxInFlight: number; ttlMs: number }
): Promise<ReserveCapacityResult> {
  const out = await redis.eval(
    reserveLua,
    2,
    executorInFlightKey(input.executorId),
    orgInFlightKey(input.organizationId),
    String(input.executorMaxInFlight),
    String(input.orgMaxInFlight),
    String(input.ttlMs)
  );
  if (out === 0) return { ok: true };
  if (out === 1) return { ok: false, reason: "EXECUTOR_OVER_CAPACITY" };
  if (out === 2) return { ok: false, reason: "ORG_QUOTA_EXCEEDED" };
  return { ok: false, reason: "UNKNOWN" };
}

export async function releaseCapacity(redis: Redis, input: { executorId: string; organizationId: string }) {
  try {
    await redis.decr(executorInFlightKey(input.executorId));
  } catch {
    // ignore
  }
  try {
    await redis.decr(orgInFlightKey(input.organizationId));
  } catch {
    // ignore
  }
}

export async function getInFlight(redis: Redis, executorId: string): Promise<number> {
  try {
    const raw = await redis.get(executorInFlightKey(executorId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export async function getExecutorLastUsedMs(redis: Redis, executorId: string): Promise<number> {
  try {
    const raw = await redis.get(executorLastUsedKey(executorId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
