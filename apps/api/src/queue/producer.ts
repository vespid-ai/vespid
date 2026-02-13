import { Queue, type ConnectionOptions } from "bullmq";
import type { WorkflowRunJobPayload } from "@vespid/shared";

export type EnqueueWorkflowRunInput = {
  payload: WorkflowRunJobPayload;
  maxAttempts?: number;
};

export interface WorkflowRunQueueProducer {
  enqueueWorkflowRun(input: EnqueueWorkflowRunInput): Promise<void>;
  close(): Promise<void>;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toConnectionOptions(redisUrl: string): ConnectionOptions {
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

export function createBullMqWorkflowRunQueueProducer(input?: {
  redisUrl?: string;
  queueName?: string;
  defaultAttempts?: number;
  defaultBackoffMs?: number;
}): WorkflowRunQueueProducer {
  const redisUrl = input?.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const queueName = input?.queueName ?? process.env.WORKFLOW_QUEUE_NAME ?? "workflow-runs";
  const defaultAttempts = Math.max(1, input?.defaultAttempts ?? envNumber("WORKFLOW_RETRY_ATTEMPTS", 3));
  const defaultBackoffMs = Math.max(1000, input?.defaultBackoffMs ?? envNumber("WORKFLOW_RETRY_BACKOFF_MS", 5000));

  const queue = new Queue<WorkflowRunJobPayload, unknown, "workflow-run">(queueName, {
    connection: toConnectionOptions(redisUrl),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });

  return {
    async enqueueWorkflowRun(job) {
      const attempts = Math.max(1, job.maxAttempts ?? defaultAttempts);
      await queue.add("workflow-run" as const, job.payload, {
        jobId: job.payload.runId,
        attempts,
        backoff: {
          type: "exponential",
          delay: defaultBackoffMs,
        },
      });
    },
    async close() {
      await queue.close();
    },
  };
}

export function createInMemoryWorkflowRunQueueProducer(): WorkflowRunQueueProducer & {
  jobs: WorkflowRunJobPayload[];
} {
  const jobs: WorkflowRunJobPayload[] = [];
  return {
    jobs,
    async enqueueWorkflowRun(input) {
      jobs.push(input.payload);
    },
    async close() {
      return;
    },
  };
}
