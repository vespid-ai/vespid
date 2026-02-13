import type { ConnectionOptions } from "bullmq";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function getWorkflowQueueName(): string {
  return process.env.WORKFLOW_QUEUE_NAME ?? "workflow-runs";
}

export function getWorkflowQueueConcurrency(): number {
  return Math.max(1, envNumber("WORKFLOW_QUEUE_CONCURRENCY", 5));
}

export function getWorkflowRetryAttempts(): number {
  return Math.max(1, envNumber("WORKFLOW_RETRY_ATTEMPTS", 3));
}

export function getWorkflowRetryBackoffMs(): number {
  return Math.max(1000, envNumber("WORKFLOW_RETRY_BACKOFF_MS", 5000));
}

export function getRedisConnectionOptions(redisUrl = getRedisUrl()): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const dbValue = parsed.pathname && parsed.pathname !== "/" ? Number(parsed.pathname.slice(1)) : null;
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
  };
  if (parsed.username) {
    connection.username = parsed.username;
  }
  if (parsed.password) {
    connection.password = parsed.password;
  }
  if (dbValue !== null && Number.isFinite(dbValue)) {
    connection.db = dbValue;
  }
  if (parsed.protocol === "rediss:") {
    connection.tls = {};
  }
  return connection;
}
