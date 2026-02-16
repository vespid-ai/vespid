import type { Redis } from "ioredis";
import { safeJsonParse, safeJsonStringify } from "./codec.js";

export async function ensureConsumerGroup(redis: Redis, stream: string, group: string): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, group, "$", "MKSTREAM");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("BUSYGROUP")) {
      return;
    }
    throw error;
  }
}

export async function xaddJson(redis: Redis, stream: string, message: unknown): Promise<string> {
  const id = await redis.xadd(stream, "*", "json", safeJsonStringify(message));
  return typeof id === "string" ? id : "";
}

export async function xreadGroupJson(input: {
  redis: Redis;
  stream: string;
  group: string;
  consumer: string;
  count: number;
  blockMs: number;
}): Promise<Array<{ id: string; message: unknown }>> {
  const raw = (await input.redis.xreadgroup(
    "GROUP",
    input.group,
    input.consumer,
    "COUNT",
    String(input.count),
    "BLOCK",
    String(input.blockMs),
    "STREAMS",
    input.stream,
    ">"
  )) as unknown;

  // ioredis returns: [[stream, [[id, [k1, v1, ...]], ...]]]
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const streamEntry = raw[0] as any;
  const records = Array.isArray(streamEntry?.[1]) ? (streamEntry[1] as any[]) : [];
  const out: Array<{ id: string; message: unknown }> = [];
  for (const rec of records) {
    const id = typeof rec?.[0] === "string" ? (rec[0] as string) : "";
    const fields = Array.isArray(rec?.[1]) ? (rec[1] as any[]) : [];
    const jsonIndex = fields.findIndex((v) => v === "json");
    const jsonValue = jsonIndex >= 0 ? fields[jsonIndex + 1] : null;
    const parsed = typeof jsonValue === "string" ? safeJsonParse(jsonValue) : null;
    out.push({ id, message: parsed });
  }
  return out;
}
