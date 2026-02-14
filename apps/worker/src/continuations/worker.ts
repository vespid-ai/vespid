import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  appendWorkflowRunEvent,
  clearWorkflowRunBlockAndAdvanceCursor,
  createPool,
  getWorkflowById,
  getWorkflowRunById,
  markWorkflowRunFailed,
  markWorkflowRunQueuedForRetry,
  withTenantContext,
} from "@vespid/db";
import type { WorkflowExecutionResult, WorkflowExecutionStep } from "@vespid/workflow";
import { workflowDslSchema } from "@vespid/workflow";
import type { WorkflowRunJobPayload } from "@vespid/shared";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";
import { fetchGatewayResult } from "../gateway/client.js";
import type { WorkflowContinuationJobPayload } from "./types.js";
import { getWorkflowRetryBackoffMs } from "../queue/config.js";

type WorkflowRunQueue = {
  enqueue: (input: { payload: WorkflowRunJobPayload; delayMs?: number }) => Promise<void>;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function retryDelayMs(attemptCount: number): number {
  const base = getWorkflowRetryBackoffMs();
  const cappedAttempt = Math.min(10, Math.max(1, attemptCount));
  return Math.min(60_000, Math.floor(base * Math.pow(2, cappedAttempt - 1)));
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

const WORKFLOW_EVENT_PAYLOAD_MAX_CHARS = Math.min(
  200_000,
  Math.max(256, envNumber("WORKFLOW_EVENT_PAYLOAD_MAX_CHARS", 4000))
);

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

export function startContinuationWorker(input: {
  pool?: ReturnType<typeof createPool>;
  connection: ConnectionOptions;
  queueName: string;
  runQueue: WorkflowRunQueue;
}) {
  const pool = input.pool ?? createPool(process.env.DATABASE_URL);
  const ownsPool = !input.pool;

  const worker = new Worker<WorkflowContinuationJobPayload>(
    input.queueName,
    async (job: Job<WorkflowContinuationJobPayload>) => {
      const payload = job.data;
      if (payload.type !== "remote.poll") {
        return;
      }

      const run = await withTenantContext(pool, { organizationId: payload.organizationId }, async (tenantDb) =>
        getWorkflowRunById(tenantDb, {
          organizationId: payload.organizationId,
          workflowId: payload.workflowId,
          runId: payload.runId,
        })
      );
      if (!run) {
        return;
      }
      if (run.status !== "running") {
        return;
      }
      if (!run.blockedRequestId || run.blockedRequestId !== payload.requestId) {
        return;
      }
      if (run.attemptCount !== payload.attemptCount) {
        return;
      }

      const actor = { userId: run.requestedByUserId, organizationId: payload.organizationId };

      const workflow = await withTenantContext(pool, actor, async (tenantDb) =>
        getWorkflowById(tenantDb, {
          organizationId: payload.organizationId,
          workflowId: payload.workflowId,
        })
      );
      if (!workflow) {
        return;
      }

      const dsl = workflowDslSchema.parse(workflow.dsl);
      const cursorNodeIndex = Math.max(0, run.cursorNodeIndex ?? 0);
      const node = dsl.nodes[cursorNodeIndex];
      if (!node) {
        await withTenantContext(pool, actor, async (tenantDb) =>
          markWorkflowRunFailed(tenantDb, {
            organizationId: payload.organizationId,
            workflowId: payload.workflowId,
            runId: payload.runId,
            error: "REMOTE_RESULT_APPLY_FAILED",
          })
        );
        return;
      }

      const timeoutAtMs = run.blockedTimeoutAt ? new Date(run.blockedTimeoutAt).getTime() : null;
      const timedOut = timeoutAtMs !== null && Date.now() >= timeoutAtMs;

      const result = timedOut
        ? { ok: true as const, result: { status: "failed" as const, error: REMOTE_EXEC_ERROR.NodeExecutionTimeout } }
        : await fetchGatewayResult(payload.requestId);

      if (!result.ok) {
        if (result.error === "RESULT_NOT_READY" || result.error === "GATEWAY_UNAVAILABLE") {
          throw new Error(result.error);
        }

        await applyRemoteFailure({
          pool,
          actor,
          runQueue: input.runQueue,
          payload,
          node,
          cursorNodeIndex,
          errorMessage: result.error,
          output: null,
          maxAttempts: run.maxAttempts,
        });
        return;
      }

      if (result.result.status === "failed") {
        await applyRemoteFailure({
          pool,
          actor,
          runQueue: input.runQueue,
          payload,
          node,
          cursorNodeIndex,
          errorMessage: result.result.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed,
          output: result.result.output ?? null,
          maxAttempts: run.maxAttempts,
        });
        return;
      }

      const steps = parseStepsFromRunOutput(run.output);
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        status: "succeeded",
        output: result.result.output,
      });
      const progress = buildProgressOutput(steps);

      await withTenantContext(pool, actor, async (tenantDb) =>
        appendWorkflowRunEvent(tenantDb, {
          organizationId: payload.organizationId,
          workflowId: payload.workflowId,
          runId: payload.runId,
          attemptCount: payload.attemptCount,
          eventType: "node_succeeded",
          nodeId: node.id,
          nodeType: node.type,
          level: "info",
          payload: summarizeForEvent(result.result.output ?? null),
        })
      );

      const advanced = await withTenantContext(pool, actor, async (tenantDb) =>
        clearWorkflowRunBlockAndAdvanceCursor(tenantDb, {
          organizationId: payload.organizationId,
          workflowId: payload.workflowId,
          runId: payload.runId,
          expectedRequestId: payload.requestId,
          nextCursorNodeIndex: cursorNodeIndex + 1,
          output: progress,
        })
      );
      if (!advanced) {
        return;
      }

      await input.runQueue.enqueue({
        payload: {
          runId: payload.runId,
          organizationId: payload.organizationId,
          workflowId: payload.workflowId,
          requestedByUserId: run.requestedByUserId,
        },
      });
    },
    {
      connection: input.connection,
      concurrency: Math.max(1, envNumber("WORKFLOW_CONTINUATION_CONCURRENCY", 10)),
    }
  );

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

async function applyRemoteFailure(input: {
  pool: ReturnType<typeof createPool>;
  actor: { userId: string; organizationId: string };
  runQueue: WorkflowRunQueue;
  payload: Extract<WorkflowContinuationJobPayload, { type: "remote.poll" }>;
  node: { id: string; type: string };
  cursorNodeIndex: number;
  errorMessage: string;
  output: unknown;
  maxAttempts: number;
}) {
  const steps = await withTenantContext(input.pool, input.actor, async (tenantDb) => {
    const run = await getWorkflowRunById(tenantDb, {
      organizationId: input.payload.organizationId,
      workflowId: input.payload.workflowId,
      runId: input.payload.runId,
    });
    return parseStepsFromRunOutput(run?.output);
  });

  await withTenantContext(input.pool, input.actor, async (tenantDb) =>
    appendWorkflowRunEvent(tenantDb, {
      organizationId: input.payload.organizationId,
      workflowId: input.payload.workflowId,
      runId: input.payload.runId,
      attemptCount: input.payload.attemptCount,
      eventType: "node_failed",
      nodeId: input.node.id,
      nodeType: input.node.type,
      level: "error",
      message: input.errorMessage,
      payload: summarizeForEvent(input.output),
    })
  );

  steps.push({
    nodeId: input.node.id,
    nodeType: input.node.type as any,
    status: "failed",
    error: input.errorMessage,
  });

  const isFinalAttempt = input.payload.attemptCount >= input.maxAttempts;
  if (isFinalAttempt) {
    await withTenantContext(input.pool, input.actor, async (tenantDb) =>
      markWorkflowRunFailed(tenantDb, {
        organizationId: input.payload.organizationId,
        workflowId: input.payload.workflowId,
        runId: input.payload.runId,
        error: input.errorMessage,
      })
    );
    await withTenantContext(input.pool, input.actor, async (tenantDb) =>
      appendWorkflowRunEvent(tenantDb, {
        organizationId: input.payload.organizationId,
        workflowId: input.payload.workflowId,
        runId: input.payload.runId,
        attemptCount: input.payload.attemptCount,
        eventType: "run_failed",
        level: "error",
        message: input.errorMessage,
        payload: { attemptCount: input.payload.attemptCount, maxAttempts: input.maxAttempts, error: input.errorMessage },
      })
    );
    return;
  }

  const delayMs = retryDelayMs(input.payload.attemptCount);
  await withTenantContext(input.pool, input.actor, async (tenantDb) =>
    markWorkflowRunQueuedForRetry(tenantDb, {
      organizationId: input.payload.organizationId,
      workflowId: input.payload.workflowId,
      runId: input.payload.runId,
      error: input.errorMessage,
      nextAttemptAt: new Date(Date.now() + delayMs),
    })
  );
  await withTenantContext(input.pool, input.actor, async (tenantDb) =>
    appendWorkflowRunEvent(tenantDb, {
      organizationId: input.payload.organizationId,
      workflowId: input.payload.workflowId,
      runId: input.payload.runId,
      attemptCount: input.payload.attemptCount,
      eventType: "run_retried",
      level: "warn",
      message: input.errorMessage,
      payload: { attemptCount: input.payload.attemptCount, maxAttempts: input.maxAttempts, error: input.errorMessage },
    })
  );

  await input.runQueue.enqueue({
    payload: {
      runId: input.payload.runId,
      organizationId: input.payload.organizationId,
      workflowId: input.payload.workflowId,
      requestedByUserId: input.actor.userId,
    },
    delayMs,
  });
}
