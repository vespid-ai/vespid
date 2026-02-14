import { Worker, type Job } from "bullmq";
import {
  createPool,
  appendWorkflowRunEvent,
  getConnectorSecretById,
  getWorkflowById,
  getWorkflowRunById,
  markWorkflowRunBlocked,
  markWorkflowRunFailed,
  markWorkflowRunQueuedForRetry,
  markWorkflowRunRunning,
  markWorkflowRunSucceeded,
  updateWorkflowRunProgress,
  withTenantContext,
} from "@vespid/db";
import {
  decryptSecret,
  loadEnterpriseProvider,
  parseKekFromEnv,
  REMOTE_EXEC_ERROR,
  resolveWorkflowNodeExecutors,
  type EnterpriseProvider,
  type WorkflowNodeExecutor,
  type WorkflowRunJobPayload,
} from "@vespid/shared";
import { workflowDslSchema, type WorkflowExecutionResult, type WorkflowExecutionStep } from "@vespid/workflow";
import { getCommunityConnectorAction } from "@vespid/connectors";
import {
  getRedisConnectionOptions,
  getWorkflowContinuationQueueName,
  getWorkflowQueueConcurrency,
  getWorkflowQueueName,
  getWorkflowRetryAttempts,
} from "./queue/config.js";
import { getCommunityWorkflowNodeExecutors } from "./executors/community-executors.js";
import { dispatchViaGatewayAsync } from "./gateway/client.js";
import { createWorkflowRunQueue } from "./queue/run-queue.js";
import { createContinuationQueue } from "./continuations/queue.js";
import { startContinuationWorker } from "./continuations/worker.js";

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

function parseStepsFromRunOutput(output: unknown): WorkflowExecutionStep[] {
  if (!output || typeof output !== "object") {
    return [];
  }
  const maybe = output as { steps?: unknown };
  return Array.isArray(maybe.steps) ? (maybe.steps as WorkflowExecutionStep[]) : [];
}

function buildProgressOutput(steps: WorkflowExecutionStep[]): WorkflowExecutionResult {
  const completedNodeCount = steps.filter((step) => step.status === "succeeded").length;
  const failedNodeId = steps.find((step) => step.status === "failed")?.nodeId ?? null;
  return {
    status: failedNodeId ? "failed" : "succeeded",
    steps,
    output: {
      completedNodeCount,
      failedNodeId,
    },
  };
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
    enqueueContinuationPoll?: (input: {
      organizationId: string;
      workflowId: string;
      runId: string;
      requestId: string;
      attemptCount: number;
    }) => Promise<void>;
  }
): Promise<void> {
  const actor = {
    userId: job.data.requestedByUserId,
    organizationId: job.data.organizationId,
  };

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

  const executorRegistry =
    input?.executorRegistry ??
    (() => {
      const enterpriseExecutors = input?.enterpriseProvider
        ? resolveWorkflowNodeExecutors(input.enterpriseProvider)
        : null;

      const communityExecutors = getCommunityWorkflowNodeExecutors({
        githubApiBaseUrl: getGithubApiBaseUrl(),
        loadConnectorSecretValue,
      });

      return buildExecutorRegistry({
        communityExecutors,
        enterpriseExecutors,
      });
    })();

  let attemptCount = 0;

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

  if (run.status === "succeeded" || run.status === "failed") {
    return;
  }

  if (run.status === "running" && run.blockedRequestId) {
    // Another worker already dispatched a remote node for this attempt.
    return;
  }

  const maxAttempts = typeof run.maxAttempts === "number" && Number.isFinite(run.maxAttempts) ? run.maxAttempts : getWorkflowRetryAttempts();
  const isStartingAttempt = run.status === "queued";
  attemptCount = isStartingAttempt ? Math.max(1, (run.attemptCount ?? 0) + 1) : Math.max(1, run.attemptCount ?? 1);
  const initialCursorNodeIndex = isStartingAttempt ? 0 : Math.max(0, run.cursorNodeIndex ?? 0);
  const initialSteps = isStartingAttempt ? [] : parseStepsFromRunOutput(run.output);

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

  let cursorNodeIndex = initialCursorNodeIndex;
  const steps: WorkflowExecutionStep[] = [...initialSteps];

  if (isStartingAttempt) {
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

    cursorNodeIndex = 0;
    steps.length = 0;
    jsonLog("info", {
      event: "workflow_run_started",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
    });
  } else {
    jsonLog("info", {
      event: "workflow_run_resumed",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
      cursorNodeIndex,
    });
  }

  try {
    const dsl = workflowDslSchema.parse(workflow.dsl);
    const nodeExecTimeoutMs = envNumber("NODE_EXEC_TIMEOUT_MS", 60_000);

    for (let index = cursorNodeIndex; index < dsl.nodes.length; index += 1) {
      const node = dsl.nodes[index];
      if (!node) {
        break;
      }
      await appendEvent({
        eventType: "node_started",
        level: "info",
        nodeId: node.id,
        nodeType: node.type,
      });

      const executionMode =
        node.type === "agent.execute"
          ? (node.config?.execution?.mode ?? "cloud")
          : node.type === "connector.action"
            ? (node.config.execution?.mode ?? "cloud")
            : "cloud";

      if (executionMode === "node") {
        if (!input?.enqueueContinuationPoll) {
          throw new Error("CONTINUATION_QUEUE_NOT_CONFIGURED");
        }

        if (node.type === "agent.execute") {
          const nodeTimeoutMs =
            typeof node.config?.sandbox?.timeoutMs === "number" && Number.isFinite(node.config.sandbox.timeoutMs)
              ? node.config.sandbox.timeoutMs
              : nodeExecTimeoutMs;

          const selectorTag =
            typeof node.config?.execution?.selector?.tag === "string" && node.config.execution.selector.tag.trim().length > 0
              ? node.config.execution.selector.tag.trim()
              : undefined;

          const dispatchInput = {
            organizationId: job.data.organizationId,
            requestedByUserId: job.data.requestedByUserId,
            runId: job.data.runId,
            workflowId: job.data.workflowId,
            nodeId: node.id,
            nodeType: node.type,
            attemptCount,
            kind: "agent.execute" as const,
            payload: {
              nodeId: node.id,
              node,
              runId: job.data.runId,
              workflowId: job.data.workflowId,
              attemptCount,
            },
            ...(selectorTag ? { selectorTag } : {}),
            timeoutMs: nodeTimeoutMs,
          };

          const dispatched = await dispatchViaGatewayAsync(dispatchInput);
          if (!dispatched.ok) {
            throw new Error(dispatched.error);
          }

          await appendEvent({
            eventType: "node_dispatched",
            level: "info",
            nodeId: node.id,
            nodeType: node.type,
            payload: { requestId: dispatched.requestId, kind: "agent.execute" },
          });

          await withTenantContext(pool, actor, async (tenantDb) =>
            markWorkflowRunBlocked(tenantDb, {
              organizationId: job.data.organizationId,
              workflowId: job.data.workflowId,
              runId: job.data.runId,
              cursorNodeIndex: index,
              blockedRequestId: dispatched.requestId,
              blockedNodeId: node.id,
              blockedNodeType: node.type,
              blockedKind: "agent.execute",
              blockedTimeoutAt: new Date(Date.now() + nodeTimeoutMs),
              output: buildProgressOutput(steps),
            })
          );

          await input.enqueueContinuationPoll({
            organizationId: job.data.organizationId,
            workflowId: job.data.workflowId,
            runId: job.data.runId,
            requestId: dispatched.requestId,
            attemptCount,
          });

          jsonLog("info", {
            event: "workflow_node_dispatched",
            runId: job.data.runId,
            workflowId: job.data.workflowId,
            orgId: job.data.organizationId,
            attemptCount,
            nodeId: node.id,
            nodeType: node.type,
            requestId: dispatched.requestId,
          });

          return;
        }

        if (node.type === "connector.action") {
          const action = getCommunityConnectorAction({
            connectorId: node.config.connectorId as any,
            actionId: node.config.actionId,
          });
          if (!action) {
            throw new Error(`ACTION_NOT_SUPPORTED:${node.config.connectorId}:${node.config.actionId}`);
          }

          const actionInputParsed = action.inputSchema.safeParse(node.config.input);
          if (!actionInputParsed.success) {
            throw new Error("INVALID_ACTION_INPUT");
          }

          const secret = action.requiresSecret
            ? await loadConnectorSecretValue({
                organizationId: job.data.organizationId,
                userId: job.data.requestedByUserId,
                secretId: node.config.auth.secretId,
              })
            : null;

          const selectorTag =
            typeof node.config.execution?.selector?.tag === "string" && node.config.execution.selector.tag.trim().length > 0
              ? node.config.execution.selector.tag.trim()
              : undefined;

          const dispatchInput = {
            organizationId: job.data.organizationId,
            requestedByUserId: job.data.requestedByUserId,
            runId: job.data.runId,
            workflowId: job.data.workflowId,
            nodeId: node.id,
            nodeType: node.type,
            attemptCount,
            kind: "connector.action" as const,
            payload: {
              connectorId: node.config.connectorId,
              actionId: node.config.actionId,
              input: actionInputParsed.data,
              env: {
                githubApiBaseUrl: getGithubApiBaseUrl(),
              },
            },
            ...(selectorTag ? { selectorTag } : {}),
            ...(secret ? { secret } : {}),
            timeoutMs: nodeExecTimeoutMs,
          };

          const dispatched = await dispatchViaGatewayAsync(dispatchInput);
          if (!dispatched.ok) {
            throw new Error(dispatched.error);
          }

          await appendEvent({
            eventType: "node_dispatched",
            level: "info",
            nodeId: node.id,
            nodeType: node.type,
            payload: { requestId: dispatched.requestId, kind: "connector.action" },
          });

          await withTenantContext(pool, actor, async (tenantDb) =>
            markWorkflowRunBlocked(tenantDb, {
              organizationId: job.data.organizationId,
              workflowId: job.data.workflowId,
              runId: job.data.runId,
              cursorNodeIndex: index,
              blockedRequestId: dispatched.requestId,
              blockedNodeId: node.id,
              blockedNodeType: node.type,
              blockedKind: "connector.action",
              blockedTimeoutAt: new Date(Date.now() + nodeExecTimeoutMs),
              output: buildProgressOutput(steps),
            })
          );

          await input.enqueueContinuationPoll({
            organizationId: job.data.organizationId,
            workflowId: job.data.workflowId,
            runId: job.data.runId,
            requestId: dispatched.requestId,
            attemptCount,
          });

          jsonLog("info", {
            event: "workflow_node_dispatched",
            runId: job.data.runId,
            workflowId: job.data.workflowId,
            orgId: job.data.organizationId,
            attemptCount,
            nodeId: node.id,
            nodeType: node.type,
            requestId: dispatched.requestId,
          });

          return;
        }
      }

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
        const message = nodeResult.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed;
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

      cursorNodeIndex = index + 1;
      await withTenantContext(pool, actor, async (tenantDb) =>
        updateWorkflowRunProgress(tenantDb, {
          organizationId: job.data.organizationId,
          workflowId: job.data.workflowId,
          runId: job.data.runId,
          cursorNodeIndex,
          output: buildProgressOutput(steps),
        })
      );
    }

    const execution = buildProgressOutput(steps);

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
    const isFinalAttempt = attemptCount >= maxAttempts;

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
          maxAttempts,
          error: message,
        },
      });
      jsonLog("warn", {
        event: "workflow_run_retried",
        runId: job.data.runId,
        workflowId: job.data.workflowId,
        orgId: job.data.organizationId,
        attemptCount,
        maxAttempts,
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
        maxAttempts,
        error: message,
      },
    });

    jsonLog("error", {
      event: "workflow_run_failed",
      runId: job.data.runId,
      workflowId: job.data.workflowId,
      orgId: job.data.organizationId,
      attemptCount,
      maxAttempts,
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
  const continuationQueueName = getWorkflowContinuationQueueName();
  const continuationPollMs = Math.max(250, envNumber("WORKFLOW_CONTINUATION_POLL_MS", 2000));

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

  const runQueue = createWorkflowRunQueue({ queueName, connection });
  const continuationQueue = createContinuationQueue({ queueName: continuationQueueName, connection });
  const continuationRuntime = startContinuationWorker({
    pool,
    connection,
    queueName: continuationQueueName,
    runQueue,
  });

  async function enqueueContinuationPoll(payload: {
    organizationId: string;
    workflowId: string;
    runId: string;
    requestId: string;
    attemptCount: number;
  }) {
    await continuationQueue.queue.add(
      "continuation",
      {
        type: "remote.poll",
        organizationId: payload.organizationId,
        workflowId: payload.workflowId,
        runId: payload.runId,
        requestId: payload.requestId,
        attemptCount: payload.attemptCount,
      },
      {
        jobId: payload.requestId,
        attempts: 500,
        backoff: { type: "fixed", delay: continuationPollMs },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      }
    );
  }

  const worker = new Worker<WorkflowRunJobPayload>(
    queueName,
    async (job) =>
      processWorkflowRunJob(pool, job, {
        executorRegistry,
        enqueueContinuationPoll,
      }),
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
      await continuationRuntime.close();
      await continuationQueue.close();
      await runQueue.close();
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
