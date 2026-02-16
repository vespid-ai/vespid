import { Worker, type Job } from "bullmq";
import crypto from "node:crypto";
import {
  createPool,
  appendWorkflowRunEvent,
  getConnectorSecretById,
  getAgentToolsetById,
  getOrganizationById,
  ensureOrganizationCreditBalanceRow,
  getOrganizationCreditBalance,
  tryDebitOrganizationCredits,
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
  type LlmProviderId,
  type EnterpriseProvider,
  type WorkflowNodeExecutor,
  type WorkflowRunJobPayload,
} from "@vespid/shared";
import {
  workflowDslAnySchema,
  validateV3GraphConstraints,
  type WorkflowDslV3,
  type WorkflowExecutionResult,
  type WorkflowExecutionStep,
} from "@vespid/workflow";
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

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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

function buildProgressOutput(steps: WorkflowExecutionStep[], runtime?: unknown): WorkflowExecutionResult {
  const completedNodeCount = steps.filter((step) => step.status === "succeeded").length;
  const failedNodeId = steps.find((step) => step.status === "failed")?.nodeId ?? null;
  return {
    status: failedNodeId ? "failed" : "succeeded",
    steps,
    output: {
      completedNodeCount,
      failedNodeId,
    },
    ...(runtime ? { runtime } : {}),
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

  const loadToolsetById = async (toolsetInput: {
    organizationId: string;
    toolsetId: string;
  }): Promise<{ id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null> => {
    const row = await withTenantContext(
      pool,
      { userId: job.data.requestedByUserId, organizationId: toolsetInput.organizationId },
      async (tenantDb) =>
        getAgentToolsetById(tenantDb, {
          organizationId: toolsetInput.organizationId,
          toolsetId: toolsetInput.toolsetId,
        })
    );
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      mcpServers: (row.mcpServers ?? []) as any,
      agentSkills: (row.agentSkills ?? []) as any,
    };
  };

  const managedCredits = {
    ensureAvailable: async (creditsInput: { organizationId: string; userId: string; minCredits: number }) => {
      const minCredits = Math.max(0, Math.floor(creditsInput.minCredits));
      const row = await withTenantContext(
        pool,
        { userId: creditsInput.userId, organizationId: creditsInput.organizationId },
        async (tenantDb) => {
          const existing = await getOrganizationCreditBalance(tenantDb, { organizationId: creditsInput.organizationId });
          return existing ?? (await ensureOrganizationCreditBalanceRow(tenantDb, { organizationId: creditsInput.organizationId }));
        }
      );
      return row.balanceCredits >= minCredits;
    },
    charge: async (chargeInput: {
      organizationId: string;
      userId: string;
      workflowId: string;
      runId: string;
      nodeId: string;
      attemptCount: number;
      provider: LlmProviderId;
      model: string;
      turn: number;
      credits: number;
      inputTokens: number;
      outputTokens: number;
    }) => {
      const credits = Math.max(0, Math.floor(chargeInput.credits));
      if (credits <= 0) {
        return;
      }

      await withTenantContext(
        pool,
        { userId: chargeInput.userId, organizationId: chargeInput.organizationId },
        async (tenantDb) => {
          await ensureOrganizationCreditBalanceRow(tenantDb, { organizationId: chargeInput.organizationId });
          await tryDebitOrganizationCredits(tenantDb, {
            organizationId: chargeInput.organizationId,
            credits,
            reason: "llm_usage",
            workflowRunId: chargeInput.runId,
            createdByUserId: null,
            metadata: {
              provider: chargeInput.provider,
              model: chargeInput.model,
              nodeId: chargeInput.nodeId,
              workflowId: chargeInput.workflowId,
              runId: chargeInput.runId,
              attemptCount: chargeInput.attemptCount,
              turn: chargeInput.turn,
              inputTokens: chargeInput.inputTokens,
              outputTokens: chargeInput.outputTokens,
            },
          });
        }
      );
    },
  };

  const executorRegistry =
    input?.executorRegistry ??
    (() => {
      const enterpriseExecutors = input?.enterpriseProvider
        ? resolveWorkflowNodeExecutors(input.enterpriseProvider)
        : null;

      const communityExecutors = getCommunityWorkflowNodeExecutors({
        getGithubApiBaseUrl,
        loadConnectorSecretValue,
        loadToolsetById,
        managedCredits,
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

  const organization = await withTenantContext(pool, actor, async (tenantDb) =>
    getOrganizationById(tenantDb, { organizationId: job.data.organizationId })
  );
  const organizationSettings = organization?.settings ?? {};

  const maxAttempts = typeof run.maxAttempts === "number" && Number.isFinite(run.maxAttempts) ? run.maxAttempts : getWorkflowRetryAttempts();
  const isStartingAttempt = run.status === "queued";
  attemptCount = isStartingAttempt ? Math.max(1, (run.attemptCount ?? 0) + 1) : Math.max(1, run.attemptCount ?? 1);
  const initialCursorNodeIndex = isStartingAttempt ? 0 : Math.max(0, run.cursorNodeIndex ?? 0);
  const initialSteps = isStartingAttempt ? [] : parseStepsFromRunOutput(run.output);
  const initialRuntime = isStartingAttempt ? null : parseRuntimeFromRunOutput(run.output);

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
  let runtime: unknown = initialRuntime;

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
    runtime = null;
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
    const dslAny = workflowDslAnySchema.parse(workflow.dsl);
    if (dslAny.version === "v3") {
      const constraints = validateV3GraphConstraints(dslAny as WorkflowDslV3);
      if (!constraints.ok) {
        throw new Error(constraints.code);
      }
    }
    const nodeExecTimeoutMs = envNumber("NODE_EXEC_TIMEOUT_MS", 60_000);

    const checkpointCursorIndexForV3 = 0;

    let getGraphV3Runtime: (() => unknown) | null = null;

    const checkpointProgress = async (nextCursorNodeIndex: number) => {
      if (getGraphV3Runtime) {
        runtime = mergeRuntime(runtime, { graphV3: getGraphV3Runtime() });
      }
      await withTenantContext(pool, actor, async (tenantDb) =>
        updateWorkflowRunProgress(tenantDb, {
          organizationId: job.data.organizationId,
          workflowId: job.data.workflowId,
          runId: job.data.runId,
          cursorNodeIndex: nextCursorNodeIndex,
          output: buildProgressOutput(steps, runtime),
        })
      );
    };

    const executeNode = async (node: any, checkpointCursorNodeIndex: number) => {
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

      let nodeResult: {
        status: "succeeded" | "failed" | "blocked";
        output?: unknown;
        error?: string;
        block?: any;
        runtime?: unknown;
      };

      try {
        const emitEvent = async (event: {
          eventType: string;
          level: "info" | "warn" | "error";
          message?: string | null;
          payload?: unknown;
        }) => {
          await appendEvent({
            eventType: event.eventType,
            level: event.level,
            message: event.message ?? null,
            payload: event.payload ?? null,
            nodeId: node.id,
            nodeType: node.type,
          });
        };

        const checkpointRuntime = async (runtimeOverride: unknown) => {
          runtime = mergeRuntime(runtime, runtimeOverride);
          await checkpointProgress(checkpointCursorNodeIndex);
        };

        nodeResult = await executor.execute({
          organizationId: job.data.organizationId,
          workflowId: job.data.workflowId,
          runId: job.data.runId,
          attemptCount,
          requestedByUserId: job.data.requestedByUserId,
          nodeId: node.id,
          nodeType: node.type,
          node,
          organizationSettings,
          runInput: run.input ?? undefined,
          steps,
          runtime,
          pendingRemoteResult:
            runtime && typeof runtime === "object" && (runtime as any).pendingRemoteResult != null
              ? (runtime as any).pendingRemoteResult
              : undefined,
          emitEvent,
          checkpointRuntime,
        });
      } catch (error) {
        nodeResult = { status: "failed", error: errorMessage(error) };
      }

      runtime = mergeRuntime(runtime, nodeResult.runtime);

      if (nodeResult.status === "blocked") {
        if (!input?.enqueueContinuationPoll) {
          throw new Error("CONTINUATION_QUEUE_NOT_CONFIGURED");
        }
        if (!nodeResult.block || typeof nodeResult.block !== "object") {
          throw new Error("INVALID_BLOCK_RESULT");
        }
        const kind = nodeResult.block.kind;
        if (kind !== "agent.execute" && kind !== "connector.action" && kind !== "agent.run") {
          throw new Error("INVALID_BLOCK_KIND");
        }

        const timeoutMs =
          typeof nodeResult.block.timeoutMs === "number" && Number.isFinite(nodeResult.block.timeoutMs)
            ? nodeResult.block.timeoutMs
            : nodeExecTimeoutMs;

        const dispatchNodeId =
          typeof nodeResult.block.dispatchNodeId === "string" && nodeResult.block.dispatchNodeId.length > 0
            ? nodeResult.block.dispatchNodeId
            : node.id;

        const dispatchInput = {
          organizationId: job.data.organizationId,
          requestedByUserId: job.data.requestedByUserId,
          runId: job.data.runId,
          workflowId: job.data.workflowId,
          nodeId: dispatchNodeId,
          nodeType: node.type,
          attemptCount,
          kind,
          payload: nodeResult.block.payload,
          ...(typeof nodeResult.block.selectorTag === "string" ? { selectorTag: nodeResult.block.selectorTag } : {}),
          ...(typeof nodeResult.block.selectorAgentId === "string"
            ? { selectorAgentId: nodeResult.block.selectorAgentId }
            : {}),
          ...(typeof nodeResult.block.selectorGroup === "string" ? { selectorGroup: nodeResult.block.selectorGroup } : {}),
          ...(typeof nodeResult.block.secret === "string" && nodeResult.block.secret.length > 0
            ? { secret: nodeResult.block.secret }
            : {}),
          timeoutMs,
        } as const;

        const dispatched = await dispatchViaGatewayAsync(dispatchInput as any);
        if (!dispatched.ok) {
          throw new Error(dispatched.error);
        }

        await appendEvent({
          eventType: "node_dispatched",
          level: "info",
          nodeId: node.id,
          nodeType: node.type,
          payload: { requestId: dispatched.requestId, kind },
        });

        await withTenantContext(pool, actor, async (tenantDb) =>
          markWorkflowRunBlocked(tenantDb, {
            organizationId: job.data.organizationId,
            workflowId: job.data.workflowId,
            runId: job.data.runId,
            cursorNodeIndex: checkpointCursorNodeIndex,
            blockedRequestId: dispatched.requestId,
            blockedNodeId: node.id,
            blockedNodeType: node.type,
            blockedKind: kind,
            blockedTimeoutAt: new Date(Date.now() + timeoutMs),
            output: buildProgressOutput(steps, runtime),
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

        return { blocked: true as const };
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

      return { blocked: false as const };
    };

    function getInputValueByPath(input: unknown, rawPath: string): unknown {
      const path = rawPath.startsWith("$.") ? rawPath.slice(2) : rawPath;
      const parts = path.split(".").filter((p) => p.length > 0);
      let current: any = input;
      for (const part of parts) {
        if (current === null || current === undefined) {
          return undefined;
        }
        if (typeof current !== "object") {
          return undefined;
        }
        current = (current as any)[part];
      }
      return current;
    }

    if (dslAny.version === "v3") {
      const dsl = dslAny as WorkflowDslV3;
      const nodes = dsl.graph.nodes;
      const edges = dsl.graph.edges;

      const nodeIds = Object.keys(nodes);
      const incomingByNodeId = new Map<string, Array<{ from: string; kind: "always" | "cond_true" | "cond_false" }>>();
      const outgoingByNodeId = new Map<string, Array<{ to: string; kind: "always" | "cond_true" | "cond_false" }>>();
      for (const edge of edges) {
        const kind = (edge.kind ?? "always") as "always" | "cond_true" | "cond_false";
        incomingByNodeId.set(edge.to, [...(incomingByNodeId.get(edge.to) ?? []), { from: edge.from, kind }]);
        outgoingByNodeId.set(edge.from, [...(outgoingByNodeId.get(edge.from) ?? []), { to: edge.to, kind }]);
      }

      const stepByNodeId = new Map<string, WorkflowExecutionStep>();
      for (const step of steps) {
        stepByNodeId.set(step.nodeId, step);
      }

      const getConditionResult = (nodeId: string): boolean | null => {
        const step = stepByNodeId.get(nodeId);
        if (!step || step.status !== "succeeded") {
          return null;
        }
        const out = step.output as any;
        return out && typeof out === "object" && typeof out.result === "boolean" ? out.result : null;
      };

      const hasSucceeded = (nodeId: string): boolean => stepByNodeId.get(nodeId)?.status === "succeeded";

      const edgeStatus = (edge: { from: string; kind: "always" | "cond_true" | "cond_false" }): {
        satisfied: boolean;
        reasonCode: "OK" | "UPSTREAM_NOT_SUCCEEDED" | "CONDITION_RESULT_MISSING" | "CONDITION_NOT_MET";
      } => {
        if (!hasSucceeded(edge.from)) {
          return { satisfied: false, reasonCode: "UPSTREAM_NOT_SUCCEEDED" };
        }
        if (edge.kind === "always") {
          return { satisfied: true, reasonCode: "OK" };
        }
        const cond = getConditionResult(edge.from);
        if (cond === null) {
          return { satisfied: false, reasonCode: "CONDITION_RESULT_MISSING" };
        }
        const shouldBeTrue = edge.kind === "cond_true";
        if (cond !== shouldBeTrue) {
          return { satisfied: false, reasonCode: "CONDITION_NOT_MET" };
        }
        return { satisfied: true, reasonCode: "OK" };
      };

      const nodeReady = (nodeId: string): boolean => {
        if (stepByNodeId.has(nodeId)) {
          return false;
        }
        const incoming = incomingByNodeId.get(nodeId) ?? [];
        for (const edge of incoming) {
          if (!edgeStatus(edge).satisfied) {
            return false;
          }
        }
        return true;
      };

      const snapshotGraphV3Runtime = (input: { includeSkipped: boolean }) => {
        const completedNodeIds = steps.filter((s) => s.status === "succeeded").map((s) => s.nodeId);
        const readyNodeIds = nodeIds.filter(nodeReady).sort((a, b) => a.localeCompare(b));

        const conditions: Record<string, unknown> = {};
        for (const [id, step] of stepByNodeId.entries()) {
          if (step.nodeType !== "condition" || step.status !== "succeeded") {
            continue;
          }
          const node = nodes[id];
          const cfg = node && typeof (node as any).config === "object" ? (node as any).config : null;
          const output = step.output && typeof step.output === "object" ? (step.output as any) : null;
          conditions[id] = {
            result: output && typeof output.result === "boolean" ? output.result : null,
            path: cfg && typeof cfg.path === "string" ? cfg.path : null,
            op: cfg && typeof cfg.op === "string" ? cfg.op : null,
            expected: cfg && "value" in cfg ? (cfg as any).value : null,
          };
        }

        const joins: Record<string, unknown> = {};
        for (const [id, node] of Object.entries(nodes)) {
          if (!node || (node as any).type !== "parallel.join") {
            continue;
          }
          const incoming = incomingByNodeId.get(id) ?? [];
          const statuses = incoming.map((edge) => ({ ...edge, ...edgeStatus(edge) }));
          const requiredIncoming = incoming.length;
          const satisfiedIncoming = statuses.filter((s) => s.satisfied).length;
          joins[id] = {
            requiredIncoming,
            satisfiedIncoming,
            incoming: statuses.map((s) => ({ from: s.from, kind: s.kind, satisfied: s.satisfied, reasonCode: s.reasonCode })),
          };
        }

        const base: Record<string, unknown> = {
          completedNodeIds,
          readyNodeIds,
          conditions,
          joins,
        };

        if (!input.includeSkipped) {
          return base;
        }

        const skipped: Record<string, unknown> = {};
        for (const id of nodeIds.sort((a, b) => a.localeCompare(b))) {
          if (stepByNodeId.has(id)) {
            continue;
          }
          const incoming = incomingByNodeId.get(id) ?? [];
          const blockers = incoming
            .map((edge) => ({ ...edge, ...edgeStatus(edge) }))
            .filter((s) => !s.satisfied)
            .map((s) => ({ from: s.from, kind: s.kind, reasonCode: s.reasonCode }));

          skipped[id] = {
            reasonCode: blockers.length > 0 ? "DEPENDENCIES_NOT_SATISFIED" : "NOT_REACHED",
            blockers,
          };
        }

        return { ...base, skipped };
      };

      getGraphV3Runtime = () => snapshotGraphV3Runtime({ includeSkipped: false });

      while (true) {
        const ready = nodeIds.filter(nodeReady).sort((a, b) => a.localeCompare(b));
        if (ready.length === 0) {
          break;
        }
        const nodeId = ready[0];
        if (!nodeId) {
          break;
        }
        const node = nodes[nodeId];
        if (!node) {
          break;
        }

        if (node.type === "condition") {
          await appendEvent({ eventType: "node_started", level: "info", nodeId: node.id, nodeType: node.type });
          const cfg = (node as any).config;
          if (!cfg || typeof cfg !== "object" || typeof cfg.path !== "string" || typeof cfg.op !== "string") {
            const message = "INVALID_CONDITION_CONFIG";
            await appendEvent({ eventType: "node_failed", level: "error", nodeId: node.id, nodeType: node.type, message });
            steps.push({ nodeId: node.id, nodeType: node.type, status: "failed", error: message });
            throw new Error(message);
          }
          const actual = getInputValueByPath(run.input ?? null, cfg.path);
          let result = false;
          switch (cfg.op) {
            case "exists":
              result = actual !== undefined && actual !== null;
              break;
            case "eq":
              result = actual === cfg.value;
              break;
            case "neq":
              result = actual !== cfg.value;
              break;
            case "contains":
              if (typeof actual === "string" && typeof cfg.value === "string") {
                result = actual.includes(cfg.value);
              } else if (Array.isArray(actual)) {
                result = actual.includes(cfg.value);
              } else {
                result = false;
              }
              break;
            case "gt":
            case "gte":
            case "lt":
            case "lte": {
              const a = typeof actual === "number" ? actual : Number(actual);
              const b = typeof cfg.value === "number" ? cfg.value : Number(cfg.value);
              if (!Number.isFinite(a) || !Number.isFinite(b)) {
                result = false;
              } else if (cfg.op === "gt") {
                result = a > b;
              } else if (cfg.op === "gte") {
                result = a >= b;
              } else if (cfg.op === "lt") {
                result = a < b;
              } else {
                result = a <= b;
              }
              break;
            }
            default:
              result = false;
          }

          const explain = {
            path: cfg.path,
            op: cfg.op,
            expected: "value" in cfg ? (cfg as any).value : null,
            actualPresent: actual !== undefined,
            actualType: actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual,
          };
          const output = { result, explain };

          await appendEvent({
            eventType: "node_succeeded",
            level: "info",
            nodeId: node.id,
            nodeType: node.type,
            payload: summarizeForEvent(output),
          });
          const step: WorkflowExecutionStep = { nodeId: node.id, nodeType: node.type, status: "succeeded", output };
          steps.push(step);
          stepByNodeId.set(node.id, step);
          await checkpointProgress(checkpointCursorIndexForV3);
          continue;
        }

        if (node.type === "parallel.join") {
          await appendEvent({ eventType: "node_started", level: "info", nodeId: node.id, nodeType: node.type });
          const incoming = incomingByNodeId.get(node.id) ?? [];
          const statuses = incoming.map((edge) => ({ ...edge, ...edgeStatus(edge) }));
          const requiredIncoming = incoming.length;
          const satisfiedIncoming = statuses.filter((s) => s.satisfied).length;
          const output = {
            joined: true,
            requiredIncoming,
            satisfiedIncoming,
            incomingFrom: incoming.map((e) => e.from),
          };
          await appendEvent({
            eventType: "node_succeeded",
            level: "info",
            nodeId: node.id,
            nodeType: node.type,
            payload: summarizeForEvent(output),
          });
          const step: WorkflowExecutionStep = { nodeId: node.id, nodeType: node.type, status: "succeeded", output };
          steps.push(step);
          stepByNodeId.set(node.id, step);
          await checkpointProgress(checkpointCursorIndexForV3);
          continue;
        }

        const res = await executeNode(node, checkpointCursorIndexForV3);
        const last = steps[steps.length - 1];
        if (last) {
          stepByNodeId.set(last.nodeId, last);
        }
        if (res.blocked) {
          return;
        }
        await checkpointProgress(checkpointCursorIndexForV3);
      }

      // Final explainability: record skipped nodes (e.g. untaken condition branches) in runtime and events.
      const finalGraphV3 = snapshotGraphV3Runtime({ includeSkipped: true }) as any;
      runtime = mergeRuntime(runtime, { graphV3: finalGraphV3 });

      const skipped = finalGraphV3 && typeof finalGraphV3 === "object" ? (finalGraphV3 as any).skipped : null;
      if (skipped && typeof skipped === "object") {
        const entries = Object.entries(skipped as Record<string, unknown>).slice(0, 500);
        for (const [nodeId, payload] of entries) {
          const node = nodes[nodeId];
          if (!node) {
            continue;
          }
          await appendEvent({
            eventType: "node_skipped",
            level: "info",
            nodeId,
            nodeType: (node as any).type ?? null,
            payload: summarizeForEvent(payload),
          });
        }
      }
    } else {
      const dsl = dslAny;
      for (let index = cursorNodeIndex; index < dsl.nodes.length; index += 1) {
        const node = dsl.nodes[index];
        if (!node) {
          break;
        }
        const res = await executeNode(node, index);
        if (res.blocked) {
          return;
        }
        cursorNodeIndex = index + 1;
        await checkpointProgress(cursorNodeIndex);
      }
    }

    const execution = buildProgressOutput(steps, runtime);

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

  const loadToolsetById = async (toolsetInput: {
    organizationId: string;
    toolsetId: string;
  }): Promise<{ id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null> => {
    const row = await withTenantContext(
      pool,
      { organizationId: toolsetInput.organizationId },
      async (tenantDb) =>
        getAgentToolsetById(tenantDb, {
          organizationId: toolsetInput.organizationId,
          toolsetId: toolsetInput.toolsetId,
        })
    );
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      mcpServers: (row.mcpServers ?? []) as any,
      agentSkills: (row.agentSkills ?? []) as any,
    };
  };

  const managedCredits = {
    ensureAvailable: async (creditsInput: { organizationId: string; userId: string; minCredits: number }) => {
      const minCredits = Math.max(0, Math.floor(creditsInput.minCredits));
      const row = await withTenantContext(
        pool,
        { userId: creditsInput.userId, organizationId: creditsInput.organizationId },
        async (tenantDb) => {
          const existing = await getOrganizationCreditBalance(tenantDb, { organizationId: creditsInput.organizationId });
          return existing ?? (await ensureOrganizationCreditBalanceRow(tenantDb, { organizationId: creditsInput.organizationId }));
        }
      );
      return row.balanceCredits >= minCredits;
    },
    charge: async (chargeInput: {
      organizationId: string;
      userId: string;
      workflowId: string;
      runId: string;
      nodeId: string;
      attemptCount: number;
      provider: LlmProviderId;
      model: string;
      turn: number;
      credits: number;
      inputTokens: number;
      outputTokens: number;
    }) => {
      const credits = Math.max(0, Math.floor(chargeInput.credits));
      if (credits <= 0) {
        return;
      }

      await withTenantContext(
        pool,
        { userId: chargeInput.userId, organizationId: chargeInput.organizationId },
        async (tenantDb) => {
          await ensureOrganizationCreditBalanceRow(tenantDb, { organizationId: chargeInput.organizationId });
          await tryDebitOrganizationCredits(tenantDb, {
            organizationId: chargeInput.organizationId,
            credits,
            reason: "llm_usage",
            workflowRunId: chargeInput.runId,
            createdByUserId: null,
            metadata: {
              provider: chargeInput.provider,
              model: chargeInput.model,
              nodeId: chargeInput.nodeId,
              workflowId: chargeInput.workflowId,
              runId: chargeInput.runId,
              attemptCount: chargeInput.attemptCount,
              turn: chargeInput.turn,
              inputTokens: chargeInput.inputTokens,
              outputTokens: chargeInput.outputTokens,
            },
          });
        }
      );
    },
  };

  const communityExecutors = getCommunityWorkflowNodeExecutors({
    getGithubApiBaseUrl,
    loadConnectorSecretValue,
    loadToolsetById,
    managedCredits,
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
    const pollJobId = `poll-${sha256Hex(payload.requestId)}`;
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
        jobId: pollJobId,
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
