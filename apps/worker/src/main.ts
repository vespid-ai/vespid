import { Worker, type Job } from "bullmq";
import {
  createPool,
  appendWorkflowRunEvent,
  getConnectorSecretById,
  getWorkflowById,
  getWorkflowRunById,
  markWorkflowRunFailed,
  markWorkflowRunQueuedForRetry,
  markWorkflowRunRunning,
  markWorkflowRunSucceeded,
  withTenantContext,
} from "@vespid/db";
import {
  decryptSecret,
  loadEnterpriseProvider,
  parseKekFromEnv,
  resolveWorkflowNodeExecutors,
  type EnterpriseProvider,
  type WorkflowNodeExecutor,
  type WorkflowRunJobPayload,
} from "@vespid/shared";
import { workflowDslSchema, type WorkflowExecutionResult, type WorkflowExecutionStep } from "@vespid/workflow";
import {
  getRedisConnectionOptions,
  getWorkflowQueueConcurrency,
  getWorkflowQueueName,
  getWorkflowRetryAttempts,
} from "./queue/config.js";
import { getCommunityWorkflowNodeExecutors } from "./executors/community-executors.js";

type WorkflowRunJobLike = Pick<Job<WorkflowRunJobPayload>, "data" | "attemptsMade" | "opts">;
type ExecutorRegistry = Map<string, WorkflowNodeExecutor>;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

const WORKFLOW_EVENT_PAYLOAD_MAX_CHARS = Math.min(
  200_000,
  Math.max(256, envNumber("WORKFLOW_EVENT_PAYLOAD_MAX_CHARS", 4000))
);
function getGithubApiBaseUrl(): string {
  return process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "WORKFLOW_EXECUTION_FAILED";
}

function summarizeForEvent(value: unknown, maxChars = WORKFLOW_EVENT_PAYLOAD_MAX_CHARS): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) {
      return value;
    }
    return {
      truncated: true,
      preview: json.slice(0, maxChars),
      originalLength: json.length,
    };
  } catch {
    return {
      truncated: true,
      preview: String(value).slice(0, maxChars),
      originalLength: null,
    };
  }
}

function buildExecutorRegistry(input: {
  communityExecutors: WorkflowNodeExecutor[];
  enterpriseExecutors?: WorkflowNodeExecutor[] | null;
}): ExecutorRegistry {
  const registry: ExecutorRegistry = new Map();
  for (const executor of input.communityExecutors) {
    registry.set(executor.nodeType, executor);
  }
  for (const executor of input.enterpriseExecutors ?? []) {
    registry.set(executor.nodeType, executor);
  }
  return registry;
}

export async function processWorkflowRunJob(
  pool: ReturnType<typeof createPool>,
  job: WorkflowRunJobLike,
  input?: {
    executorRegistry?: ExecutorRegistry;
    enterpriseProvider?: EnterpriseProvider;
  }
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
  const executorRegistry =
    input?.executorRegistry ??
    (() => {
      const enterpriseExecutors = input?.enterpriseProvider
        ? resolveWorkflowNodeExecutors(input.enterpriseProvider)
        : null;

      const loadConnectorSecretValue = async (secretInput: {
        organizationId: string;
        userId: string;
        secretId: string;
      }): Promise<string> => {
        const secret = await withTenantContext(pool, { userId: secretInput.userId, organizationId: secretInput.organizationId }, async (tenantDb) =>
          getConnectorSecretById(tenantDb, { organizationId: secretInput.organizationId, secretId: secretInput.secretId })
        );

        if (!secret) {
          throw new Error("SECRET_NOT_FOUND");
        }

        const kek = parseKekFromEnv();
        return decryptSecret({
          encrypted: {
            kekId: secret.kekId,
            dekCiphertext: secret.dekCiphertext,
            dekIv: secret.dekIv,
            dekTag: secret.dekTag,
            secretCiphertext: secret.secretCiphertext,
            secretIv: secret.secretIv,
            secretTag: secret.secretTag,
          },
          resolveKek(kekId) {
            return kekId === kek.kekId ? kek.kekKeyBytes : null;
          },
        });
      };

      const communityExecutors = getCommunityWorkflowNodeExecutors({
        githubApiBaseUrl: getGithubApiBaseUrl(),
        loadConnectorSecretValue,
      });

      return buildExecutorRegistry({
        communityExecutors,
        enterpriseExecutors,
      });
    })();

  async function appendEvent(event: {
    eventType: string;
    level: "info" | "warn" | "error";
    message?: string | null;
    nodeId?: string | null;
    nodeType?: string | null;
    payload?: unknown;
  }) {
    await withTenantContext(pool, actor, async (tenantDb) =>
      appendWorkflowRunEvent(tenantDb, {
        organizationId: job.data.organizationId,
        workflowId: job.data.workflowId,
        runId: job.data.runId,
        attemptCount,
        eventType: event.eventType,
        nodeId: event.nodeId ?? null,
        nodeType: event.nodeType ?? null,
        level: event.level,
        message: event.message ?? null,
        payload: event.payload ?? null,
      })
    );
  }

  const run = await withTenantContext(pool, actor, async (tenantDb) =>
    getWorkflowRunById(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
      runId: job.data.runId,
    })
  );

  if (!run) {
    jsonLog("warn", {
      event: "workflow_run_orphaned",
      reasonCode: "RUN_NOT_FOUND",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
    });
    return;
  }

  const workflow = await withTenantContext(pool, actor, async (tenantDb) =>
    getWorkflowById(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
    })
  );

  if (!workflow) {
    jsonLog("warn", {
      event: "workflow_run_orphaned",
      reasonCode: "WORKFLOW_NOT_FOUND",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
    });
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
    await appendEvent({
      eventType: "run_failed",
      level: "error",
      message: "WORKFLOW_NOT_PUBLISHED",
      payload: { reasonCode: "WORKFLOW_NOT_PUBLISHED" },
    });
    jsonLog("error", {
      event: "workflow_run_failed",
      reasonCode: "WORKFLOW_NOT_PUBLISHED",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
    });
    return;
  }

  await appendEvent({
    eventType: "run_started",
    level: "info",
    payload: {
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
    },
  });

  const running = await withTenantContext(pool, actor, async (tenantDb) =>
    markWorkflowRunRunning(tenantDb, {
      organizationId: job.data.organizationId,
      workflowId: job.data.workflowId,
      runId: job.data.runId,
      attemptCount,
    })
  );

  if (!running) {
    jsonLog("warn", {
      event: "workflow_run_orphaned",
      reasonCode: "RUN_NOT_FOUND_ON_START",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
    });
    return;
  }

  jsonLog("info", {
    event: "workflow_run_started",
    runId: job.data.runId,
    workflowId: job.data.workflowId,
    orgId: job.data.organizationId,
    attemptCount,
  });

  try {
    const dsl = workflowDslSchema.parse(workflow.dsl);
    const steps: WorkflowExecutionStep[] = [];

    for (const node of dsl.nodes) {
      await appendEvent({
        eventType: "node_started",
        level: "info",
        nodeId: node.id,
        nodeType: node.type,
      });

      const executor = executorRegistry.get(node.type);
      if (!executor) {
        const message = `EXECUTOR_NOT_FOUND:${node.type}`;
        await appendEvent({
          eventType: "node_failed",
          level: "error",
          nodeId: node.id,
          nodeType: node.type,
          message,
        });
        steps.push({
          nodeId: node.id,
          nodeType: node.type,
          status: "failed",
          error: message,
        });
        throw new Error(message);
      }

      let nodeResult: { status: "succeeded" | "failed"; output?: unknown; error?: string };
      try {
        nodeResult = await executor.execute({
          organizationId: job.data.organizationId,
          workflowId: job.data.workflowId,
          runId: job.data.runId,
          attemptCount,
          requestedByUserId: job.data.requestedByUserId,
          nodeId: node.id,
          nodeType: node.type,
          node,
          runInput: run.input ?? undefined,
        });
      } catch (error) {
        nodeResult = { status: "failed", error: errorMessage(error) };
      }

      if (nodeResult.status === "failed") {
        const message = nodeResult.error ?? "NODE_EXECUTION_FAILED";
        await appendEvent({
          eventType: "node_failed",
          level: "error",
          nodeId: node.id,
          nodeType: node.type,
          message,
          payload: summarizeForEvent(nodeResult.output ?? null),
        });
        steps.push({
          nodeId: node.id,
          nodeType: node.type,
          status: "failed",
          error: message,
        });
        throw new Error(message);
      }

      await appendEvent({
        eventType: "node_succeeded",
        level: "info",
        nodeId: node.id,
        nodeType: node.type,
        payload: summarizeForEvent(nodeResult.output ?? null),
      });
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        status: "succeeded",
        output: nodeResult.output,
      });
    }

    const execution: WorkflowExecutionResult = {
      status: "succeeded",
      steps,
      output: {
        completedNodeCount: steps.length,
        failedNodeId: null,
      },
    };

    await withTenantContext(pool, actor, async (tenantDb) =>
      markWorkflowRunSucceeded(tenantDb, {
        organizationId: job.data.organizationId,
        workflowId: job.data.workflowId,
        runId: job.data.runId,
        output: execution,
      })
    );

    await appendEvent({
      eventType: "run_succeeded",
      level: "info",
      payload: { completedNodeCount: execution.output.completedNodeCount },
    });

    jsonLog("info", {
      event: "workflow_run_succeeded",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
    });
    return;
  } catch (error) {
    const message = errorMessage(error);
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
      await appendEvent({
        eventType: "run_retried",
        level: "warn",
        message,
        payload: {
          attemptCount,
          maxAttempts: configuredAttempts,
          error: message,
        },
      });
      jsonLog("warn", {
        event: "workflow_run_retried",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
        attemptCount,
        maxAttempts: configuredAttempts,
        error: message,
      });
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

    await appendEvent({
      eventType: "run_failed",
      level: "error",
      message,
      payload: {
        attemptCount,
        maxAttempts: configuredAttempts,
        error: message,
      },
    });

    jsonLog("error", {
      event: "workflow_run_failed",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
      maxAttempts: configuredAttempts,
      error: message,
    });
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

  const enterpriseProvider = await loadEnterpriseProvider({
    logger: {
      info(payload) {
        jsonLog("info", typeof payload === "object" && payload ? (payload as Record<string, unknown>) : { payload });
      },
      warn(payload) {
        jsonLog("warn", typeof payload === "object" && payload ? (payload as Record<string, unknown>) : { payload });
      },
    },
  });
  const enterpriseExecutors = resolveWorkflowNodeExecutors(enterpriseProvider);

  const loadConnectorSecretValue = async (secretInput: {
    organizationId: string;
    userId: string;
    secretId: string;
  }): Promise<string> => {
    const secret = await withTenantContext(
      pool,
      { userId: secretInput.userId, organizationId: secretInput.organizationId },
      async (tenantDb) =>
        getConnectorSecretById(tenantDb, {
          organizationId: secretInput.organizationId,
          secretId: secretInput.secretId,
        })
    );

    if (!secret) {
      throw new Error("SECRET_NOT_FOUND");
    }

    const kek = parseKekFromEnv();
    return decryptSecret({
      encrypted: {
        kekId: secret.kekId,
        dekCiphertext: secret.dekCiphertext,
        dekIv: secret.dekIv,
        dekTag: secret.dekTag,
        secretCiphertext: secret.secretCiphertext,
        secretIv: secret.secretIv,
        secretTag: secret.secretTag,
      },
      resolveKek(kekId) {
        return kekId === kek.kekId ? kek.kekKeyBytes : null;
      },
    });
  };

  const communityExecutors = getCommunityWorkflowNodeExecutors({
    githubApiBaseUrl: getGithubApiBaseUrl(),
    loadConnectorSecretValue,
  });

  const executorRegistry = buildExecutorRegistry({ communityExecutors, enterpriseExecutors });

  const worker = new Worker<WorkflowRunJobPayload>(
    queueName,
    async (job) => processWorkflowRunJob(pool, job, { executorRegistry }),
    {
      connection,
      concurrency,
    }
  );

  worker.on("error", (error) => {
    jsonLog("error", {
      event: "worker_runtime_error",
      error: error instanceof Error ? error.message : String(error),
    });
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
