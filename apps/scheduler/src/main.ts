import { Queue, type ConnectionOptions } from "bullmq";
import {
  createPool,
  createDb,
  createWorkflowRun,
  deleteQueuedWorkflowRun,
  listDueWorkflowTriggerSubscriptions,
  updateWorkflowTriggerSubscriptionSchedule,
} from "@vespid/db";
import type { DbWorkflowTriggerSubscription, DbWorkflow } from "@vespid/db";
import type { WorkflowRunJobPayload } from "@vespid/shared";

type CronField = {
  values: Set<number>;
  wildcard: boolean;
};

type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

type DueSubscriptionRow = {
  subscription: DbWorkflowTriggerSubscription;
  workflow: DbWorkflow;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function jsonLog(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify(payload);
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
    return;
  }
  if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.info(line);
}

function readPgErrorCode(error: unknown): string | null {
  let cursor: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof cursor !== "object" || cursor === null) {
      return null;
    }
    const record = cursor as Record<string, unknown>;
    if (typeof record.code === "string") {
      return record.code;
    }
    cursor = record.cause ?? record.originalError ?? record.driverError ?? null;
  }
  return null;
}

function isPgUniqueViolation(error: unknown): boolean {
  return readPgErrorCode(error) === "23505";
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

function parseFieldPart(part: string, min: number, max: number): number[] | null {
  const trimmed = part.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [baseRaw = "", stepRaw] = trimmed.split("/");
  const step = stepRaw === undefined ? 1 : Number(stepRaw);
  if (!Number.isInteger(step) || step <= 0) {
    return null;
  }

  let start = min;
  let end = max;

  if (baseRaw !== "*") {
    if (baseRaw.includes("-")) {
      const [startRaw, endRaw] = baseRaw.split("-");
      const parsedStart = Number(startRaw);
      const parsedEnd = Number(endRaw);
      if (!Number.isInteger(parsedStart) || !Number.isInteger(parsedEnd) || parsedStart > parsedEnd) {
        return null;
      }
      start = parsedStart;
      end = parsedEnd;
    } else {
      const parsed = Number(baseRaw);
      if (!Number.isInteger(parsed)) {
        return null;
      }
      start = parsed;
      end = parsed;
    }
  }

  if (start < min || end > max) {
    return null;
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function parseCronField(raw: string, min: number, max: number, normalize?: (value: number) => number): CronField | null {
  const wildcard = raw.trim() === "*";
  const parts = raw.split(",");
  const values = new Set<number>();
  for (const part of parts) {
    const parsed = parseFieldPart(part, min, max);
    if (!parsed) {
      return null;
    }
    for (const value of parsed) {
      const normalized = normalize ? normalize(value) : value;
      if (normalized < min || normalized > max) {
        return null;
      }
      values.add(normalized);
    }
  }
  return { values, wildcard };
}

function parseCronExpression(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const minute = parseCronField(fields[0] ?? "", 0, 59);
  const hour = parseCronField(fields[1] ?? "", 0, 23);
  const dayOfMonth = parseCronField(fields[2] ?? "", 1, 31);
  const month = parseCronField(fields[3] ?? "", 1, 12);
  const dayOfWeek = parseCronField(fields[4] ?? "", 0, 6, (value) => (value === 7 ? 0 : value));
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null;
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function cronFieldMatches(field: CronField, value: number): boolean {
  return field.values.has(value);
}

function cronDayMatches(dayOfMonthField: CronField, dayOfWeekField: CronField, date: Date): boolean {
  const dayOfMonthMatch = cronFieldMatches(dayOfMonthField, date.getUTCDate());
  const dayOfWeekMatch = cronFieldMatches(dayOfWeekField, date.getUTCDay());

  if (dayOfMonthField.wildcard && dayOfWeekField.wildcard) {
    return true;
  }
  if (dayOfMonthField.wildcard) {
    return dayOfWeekMatch;
  }
  if (dayOfWeekField.wildcard) {
    return dayOfMonthMatch;
  }
  return dayOfMonthMatch || dayOfWeekMatch;
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  return (
    cronFieldMatches(parsed.minute, date.getUTCMinutes()) &&
    cronFieldMatches(parsed.hour, date.getUTCHours()) &&
    cronFieldMatches(parsed.month, date.getUTCMonth() + 1) &&
    cronDayMatches(parsed.dayOfMonth, parsed.dayOfWeek, date)
  );
}

function nextCronFireAt(expression: string, from: Date): Date | null {
  const parsed = parseCronExpression(expression);
  if (!parsed) {
    return null;
  }

  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Upper bound: two years of minute-level scan.
  const maxIterations = 1_051_200;
  for (let i = 0; i < maxIterations; i += 1) {
    if (cronMatches(parsed, candidate)) {
      return new Date(candidate.getTime());
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

function randomJitterSec(maxJitterSec: number): number {
  if (!Number.isFinite(maxJitterSec) || maxJitterSec <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * (Math.floor(maxJitterSec) + 1));
}

function computeHeartbeatNextFireAt(input: {
  base: Date;
  intervalSec: number;
  jitterSec: number;
}): Date {
  const intervalMs = Math.max(1, Math.floor(input.intervalSec)) * 1000;
  const jitterMs = randomJitterSec(input.jitterSec) * 1000;
  return new Date(input.base.getTime() + intervalMs + jitterMs);
}

async function withSystemDb<T>(
  pool: ReturnType<typeof createPool>,
  fn: (db: ReturnType<typeof createDb>) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("set local row_security = off");
    const db = createDb(client);
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const queueName = process.env.WORKFLOW_QUEUE_NAME ?? "workflow-runs";
  const pollMs = Math.max(500, envNumber("TRIGGER_SCHEDULER_POLL_MS", 5000));
  const batchSize = Math.max(1, envNumber("TRIGGER_SCHEDULER_BATCH_SIZE", 100));
  const defaultBackoffMs = Math.max(1000, envNumber("WORKFLOW_RETRY_BACKOFF_MS", 5000));

  const pool = createPool(databaseUrl);
  const queue = new Queue<WorkflowRunJobPayload, unknown, "workflow-run">(queueName, {
    connection: toConnectionOptions(redisUrl),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });

  let shuttingDown = false;
  let processing = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await queue.close();
    } catch {
      // ignore
    }
    try {
      await pool.end();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

async function processDueSubscription(item: DueSubscriptionRow, now: Date) {
  const subscription = item.subscription;
  if (subscription.triggerType !== "cron" && subscription.triggerType !== "heartbeat") {
    return;
  }
  const triggerType = subscription.triggerType as "cron" | "heartbeat";

    const currentNextFireAt = subscription.nextFireAt ? new Date(subscription.nextFireAt) : null;
    if (!currentNextFireAt) {
      if (subscription.triggerType === "cron") {
        const cronExpr = subscription.cronExpr ?? "";
        const nextFireAt = nextCronFireAt(cronExpr, now);
        if (!nextFireAt) {
          await withSystemDb(pool, async (db) =>
            updateWorkflowTriggerSubscriptionSchedule(db, {
              subscriptionId: subscription.id,
              nextFireAt: new Date(now.getTime() + 5 * 60 * 1000),
              lastError: "INVALID_CRON_EXPRESSION",
            })
          );
          jsonLog("warn", {
            event: "trigger_subscription_invalid_cron",
            subscriptionId: subscription.id,
            workflowId: subscription.workflowId,
            orgId: subscription.organizationId,
          });
          return;
        }
        await withSystemDb(pool, async (db) =>
          updateWorkflowTriggerSubscriptionSchedule(db, {
            subscriptionId: subscription.id,
            nextFireAt,
            lastError: null,
          })
        );
        return;
      }

      const intervalSec = subscription.heartbeatIntervalSec ?? 60;
      const jitterSec = subscription.heartbeatJitterSec ?? 0;
      const nextFireAt = computeHeartbeatNextFireAt({
        base: now,
        intervalSec,
        jitterSec,
      });
      await withSystemDb(pool, async (db) =>
        updateWorkflowTriggerSubscriptionSchedule(db, {
          subscriptionId: subscription.id,
          nextFireAt,
          lastError: null,
        })
      );
      return;
    }

    if (currentNextFireAt.getTime() > now.getTime()) {
      return;
    }

    const slotTime = currentNextFireAt;
    const triggerKey = `${triggerType}:${subscription.id}:${slotTime.toISOString()}`;
    const runInput = {
      __trigger: {
        type: triggerType,
        subscriptionId: subscription.id,
        scheduledAt: slotTime.toISOString(),
      },
    };

    let run:
      | {
          id: string;
          organizationId: string;
          workflowId: string;
          requestedByUserId: string;
          maxAttempts: number;
        }
      | null = null;
    let duplicate = false;
    try {
      const created = await withSystemDb(pool, async (db) =>
        createWorkflowRun(db, {
          organizationId: subscription.organizationId,
          workflowId: subscription.workflowId,
          triggerType,
          requestedByUserId: subscription.requestedByUserId,
          input: runInput,
          triggerKey,
          triggeredAt: slotTime,
          triggerSource: `scheduler.${triggerType}`,
        })
      );
      run = {
        id: created.id,
        organizationId: created.organizationId,
        workflowId: created.workflowId,
        requestedByUserId: created.requestedByUserId,
        maxAttempts: created.maxAttempts,
      };
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        duplicate = true;
      } else {
        throw error;
      }
    }

    if (run) {
      try {
        await queue.add(
          "workflow-run",
          {
            runId: run.id,
            organizationId: run.organizationId,
            workflowId: run.workflowId,
            requestedByUserId: run.requestedByUserId,
          },
          {
            jobId: run.id,
            attempts: Math.max(1, run.maxAttempts),
            backoff: {
              type: "exponential",
              delay: defaultBackoffMs,
            },
          }
        );
      } catch (error) {
        await withSystemDb(pool, async (db) =>
          deleteQueuedWorkflowRun(db, {
            organizationId: run.organizationId,
            workflowId: run.workflowId,
            runId: run.id,
          })
        );
        jsonLog("error", {
          event: "trigger_queue_unavailable",
          subscriptionId: subscription.id,
          runId: run.id,
          workflowId: subscription.workflowId,
          orgId: subscription.organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    let nextFireAt: Date | null = null;
    if (triggerType === "cron") {
      const cronExpr = subscription.cronExpr ?? "";
      nextFireAt = nextCronFireAt(cronExpr, slotTime);
      if (!nextFireAt) {
        nextFireAt = new Date(now.getTime() + 5 * 60 * 1000);
      }
    } else {
      const intervalSec = subscription.heartbeatIntervalSec ?? 60;
      const jitterSec = subscription.heartbeatJitterSec ?? 0;
      const maxSkewSec = subscription.heartbeatMaxSkewSec ?? 0;
      const skewExceeded = now.getTime() - slotTime.getTime() > Math.max(0, maxSkewSec) * 1000;
      const base = skewExceeded ? now : slotTime;
      nextFireAt = computeHeartbeatNextFireAt({
        base,
        intervalSec,
        jitterSec,
      });
    }

    await withSystemDb(pool, async (db) =>
      updateWorkflowTriggerSubscriptionSchedule(db, {
        subscriptionId: subscription.id,
        nextFireAt,
        lastTriggeredAt: slotTime,
        lastTriggerKey: triggerKey,
        lastError: null,
      })
    );

    jsonLog("info", {
      event: "trigger_subscription_fired",
      duplicate,
      subscriptionId: subscription.id,
      runId: run?.id ?? null,
      triggerType,
      workflowId: subscription.workflowId,
      orgId: subscription.organizationId,
    });
  }

  async function tick() {
    if (processing || shuttingDown) {
      return;
    }
    processing = true;
    const now = new Date();
    try {
      const due = await withSystemDb(pool, async (db) =>
        listDueWorkflowTriggerSubscriptions(db, {
          now,
          limit: batchSize,
        })
      );

      for (const item of due as DueSubscriptionRow[]) {
        if (shuttingDown) {
          break;
        }
        try {
          await processDueSubscription(item, now);
        } catch (error) {
          jsonLog("error", {
            event: "trigger_subscription_processing_failed",
            subscriptionId: item.subscription.id,
            workflowId: item.subscription.workflowId,
            orgId: item.subscription.organizationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      processing = false;
    }
  }

  await tick();
  const timer: ReturnType<typeof setInterval> = setInterval(() => {
    void tick();
  }, pollMs);
  if (typeof (timer as any).unref === "function") {
    (timer as any).unref();
  }

  // Keep process alive.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (shuttingDown) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
