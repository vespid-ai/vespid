import { Worker, type Job } from "bullmq";
import {
  createDb,
  createPool,
  getWorkflowById,
  getWorkflowRunById,
  markWorkflowRunFailed,
  markWorkflowRunQueuedForRetry,
  markWorkflowRunRunning,
  markWorkflowRunSucceeded,
  withTenantContext,
} from "@vespid/db";
import type { WorkflowRunJobPayload } from "@vespid/shared";
import { executeWorkflow, workflowDslSchema } from "@vespid/workflow";
import {
  getRedisConnectionOptions,
  getWorkflowQueueConcurrency,
  getWorkflowQueueName,
  getWorkflowRetryAttempts,
} from "./queue/config.js";

type WorkflowRunJobLike = Pick<Job<WorkflowRunJobPayload>, "data" | "attemptsMade" | "opts">;

export async function processWorkflowRunJob(
  pool: ReturnType<typeof createPool>,
  job: WorkflowRunJobLike
): Promise<void> {
  const configuredAttempts =
    typeof job.opts.attempts === "number" && Number.isFinite(job.opts.attempts)
      ? Math.max(1, job.opts.attempts)
      : getWorkflowRetryAttempts();
  const attemptCount = job.attemptsMade + 1;
  const actor = {
    userId: job.data.requestedByUserId,
    organizationId: job.data.organizationId,
  };

  const run = await withTenantContext(pool, actor, async (tenantDb) =>
    getWorkflowRunById(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
      runId: job.data.runId,
    })
  );

  if (!run) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "workflow_run_orphaned",
        reasonCode: "RUN_NOT_FOUND",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
      })
    );
    return;
  }

  const workflow = await withTenantContext(pool, actor, async (tenantDb) =>
    getWorkflowById(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
    })
  );

  if (!workflow) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "workflow_run_orphaned",
        reasonCode: "WORKFLOW_NOT_FOUND",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
      })
    );
    return;
  }

  if (workflow.status !== "published") {
    await withTenantContext(pool, actor, async (tenantDb) =>
      markWorkflowRunFailed(tenantDb, {
        organizationId: job.data.organizationId,
        workflowId: job.data.workflowId,
        runId: job.data.runId,
        error: "WORKFLOW_NOT_PUBLISHED",
      })
    );
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "workflow_run_failed",
        reasonCode: "WORKFLOW_NOT_PUBLISHED",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
        attemptCount,
      })
    );
    return;
  }

  const running = await withTenantContext(pool, actor, async (tenantDb) =>
    markWorkflowRunRunning(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
      runId: job.data.runId,
      attemptCount,
    })
  );

  if (!running) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "workflow_run_orphaned",
        reasonCode: "RUN_NOT_FOUND_ON_START",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
      })
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: "workflow_run_started",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
    })
  );

  try {
    const execution = executeWorkflow({
      dsl: workflowDslSchema.parse(workflow.dsl),
      runInput: run.input ?? undefined,
    });

    if (execution.status !== "succeeded") {
      throw new Error("WORKFLOW_EXECUTION_FAILED");
    }

    await withTenantContext(pool, actor, async (tenantDb) =>
      markWorkflowRunSucceeded(tenantDb, {
        organizationId: job.data.organizationId,
        workflowId: job.data.workflowId,
        runId: job.data.runId,
        output: execution,
      })
    );

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        event: "workflow_run_succeeded",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
        attemptCount,
      })
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKFLOW_EXECUTION_FAILED";
    const isFinalAttempt = attemptCount >= configuredAttempts;

    if (!isFinalAttempt) {
      await withTenantContext(pool, actor, async (tenantDb) =>
        markWorkflowRunQueuedForRetry(tenantDb, {
          organizationId: job.data.organizationId,
          workflowId: job.data.workflowId,
          runId: job.data.runId,
          error: message,
          nextAttemptAt: null,
        })
      );
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "workflow_run_retried",
          runId: job.data.runId,
          workflowId: job.data.workflowId,
          orgId: job.data.organizationId,
          attemptCount,
          maxAttempts: configuredAttempts,
          error: message,
        })
      );
      throw error instanceof Error ? error : new Error(message);
    }

    await withTenantContext(pool, actor, async (tenantDb) =>
      markWorkflowRunFailed(tenantDb, {
        organizationId: job.data.organizationId,
        workflowId: job.data.workflowId,
        runId: job.data.runId,
        error: message,
      })
    );

    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "workflow_run_failed",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
        attemptCount,
        maxAttempts: configuredAttempts,
        error: message,
      })
    );
  }
}

export async function startWorkflowWorker(input?: {
  queueName?: string;
  concurrency?: number;
  pool?: ReturnType<typeof createPool>;
  connection?: ReturnType<typeof getRedisConnectionOptions>;
}) {
  const queueName = input?.queueName ?? getWorkflowQueueName();
  const concurrency = input?.concurrency ?? getWorkflowQueueConcurrency();
  const pool = input?.pool ?? createPool(process.env.DATABASE_URL);
  const connection = input?.connection ?? getRedisConnectionOptions();
  const ownsPool = !input?.pool;

  const worker = new Worker<WorkflowRunJobPayload>(
    queueName,
    async (job) => processWorkflowRunJob(pool, job),
    {
      connection,
      concurrency,
    }
  );

  worker.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "worker_runtime_error",
        error: error instanceof Error ? error.message : String(error),
      })
    );
  });

  return {
    worker,
    async close() {
      await worker.close();
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

async function main(): Promise<void> {
  const queueName = getWorkflowQueueName();
  const concurrency = getWorkflowQueueConcurrency();
  const runtime = await startWorkflowWorker({ queueName, concurrency });
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: "workflow_worker_ready",
      queueName,
      concurrency,
    })
  );

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
