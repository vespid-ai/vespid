import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  appendWorkflowRunEvent,
  clearWorkflowRunBlock,
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
import type { GatewayDispatchResponse } from "@vespid/shared";
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseRuntimeFromRunOutput(output: unknown): unknown {
  const obj = asObject(output);
  if (!obj) {
    return null;
  }
  return "runtime" in obj ? (obj as any).runtime : null;
}

function mergeRuntime(base: unknown, override: unknown): unknown {
  const o = asObject(override);
  if (!o) {
    return base;
  }
  const b = asObject(base);
  if (!b) {
    return override;
  }
  return { ...b, ...o };
}

function buildProgressOutputWithRuntime(steps: WorkflowExecutionStep[], runtime?: unknown): WorkflowExecutionResult {
  const base = buildProgressOutput(steps);
  return {
    ...base,
    ...(runtime ? { runtime } : {}),
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

export async function processContinuationPayload(input: {
  pool: ReturnType<typeof createPool>;
  runQueue: WorkflowRunQueue;
  payload: WorkflowContinuationJobPayload;
}): Promise<void> {
  const payload = input.payload;
  if (payload.type !== "remote.poll" && payload.type !== "remote.apply" && payload.type !== "remote.event") {
    return;
  }

  const run = await withTenantContext(input.pool, { organizationId: payload.organizationId }, async (tenantDb) =>
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

  const workflow = await withTenantContext(input.pool, actor, async (tenantDb) =>
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
    await withTenantContext(input.pool, actor, async (tenantDb) =>
      markWorkflowRunFailed(tenantDb, {
        organizationId: payload.organizationId,
        workflowId: payload.workflowId,
        runId: payload.runId,
        error: "REMOTE_RESULT_APPLY_FAILED",
      })
    );
    return;
  }

  if (payload.type === "remote.event") {
    const maxRemoteEventChars = Math.min(
      200_000,
      Math.max(256, envNumber("WORKFLOW_REMOTE_EVENT_PAYLOAD_MAX_CHARS", 20_000))
    );

    await withTenantContext(input.pool, actor, async (tenantDb) =>
      appendWorkflowRunEvent(tenantDb, {
        organizationId: payload.organizationId,
        workflowId: payload.workflowId,
        runId: payload.runId,
        attemptCount: payload.attemptCount,
        eventType: "remote_event",
        nodeId: node.id,
        nodeType: node.type,
        level: payload.event.level,
        message: payload.event.kind,
        payload: summarizeForEvent(payload.event, maxRemoteEventChars),
      })
    );
    return;
  }

  const timeoutAtMs = run.blockedTimeoutAt ? new Date(run.blockedTimeoutAt).getTime() : null;
  const timedOut = timeoutAtMs !== null && Date.now() >= timeoutAtMs;

  let remoteResult: GatewayDispatchResponse | null = null;
  if (payload.type === "remote.apply") {
    remoteResult = payload.result;
  } else if (timedOut) {
    remoteResult = { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout };
  } else {
    const fetched = await fetchGatewayResult(payload.requestId);
    if (!fetched.ok) {
      if (fetched.error === "RESULT_NOT_READY" || fetched.error === "GATEWAY_UNAVAILABLE") {
        throw new Error(fetched.error);
      }

      await applyRemoteFailure({
        pool: input.pool,
        actor,
        runQueue: input.runQueue,
        payload,
        node,
        cursorNodeIndex,
        errorMessage: fetched.error,
        output: null,
        maxAttempts: run.maxAttempts,
      });
      return;
    }
    remoteResult = fetched.result;
  }

  if (!remoteResult) {
    return;
  }

  if (remoteResult.status === "failed") {
    await applyRemoteFailure({
      pool: input.pool,
      actor,
      runQueue: input.runQueue,
      payload,
      node,
      cursorNodeIndex,
      errorMessage: remoteResult.error ?? REMOTE_EXEC_ERROR.NodeExecutionFailed,
      output: remoteResult.output ?? null,
      maxAttempts: run.maxAttempts,
    });
    return;
  }

  const steps = parseStepsFromRunOutput(run.output);
  const runtime = mergeRuntime(parseRuntimeFromRunOutput(run.output), {
    pendingRemoteResult: { requestId: payload.requestId, result: remoteResult },
  });
  const progress = buildProgressOutputWithRuntime(steps, runtime);

  await withTenantContext(input.pool, actor, async (tenantDb) =>
    appendWorkflowRunEvent(tenantDb, {
      organizationId: payload.organizationId,
      workflowId: payload.workflowId,
      runId: payload.runId,
      attemptCount: payload.attemptCount,
      eventType: "remote_result_received",
      nodeId: node.id,
      nodeType: node.type,
      level: "info",
      payload: summarizeForEvent(remoteResult.output ?? null),
    })
  );

  const cleared = await withTenantContext(input.pool, actor, async (tenantDb) =>
    clearWorkflowRunBlock(tenantDb, {
      organizationId: payload.organizationId,
      workflowId: payload.workflowId,
      runId: payload.runId,
      expectedRequestId: payload.requestId,
      output: progress,
    })
  );
  if (!cleared) {
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
      await processContinuationPayload({ pool, runQueue: input.runQueue, payload: job.data });
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
  payload: {
    organizationId: string;
    workflowId: string;
    runId: string;
    requestId: string;
    attemptCount: number;
  };
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
