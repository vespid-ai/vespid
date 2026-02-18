import type { ExecutorSelectorV1 } from "./types.js";

export type WorkflowNodeExecutorContext = {
  organizationId: string;
  workflowId: string;
  runId: string;
  attemptCount: number;
  requestedByUserId: string;
  nodeId: string;
  nodeType: string;
  node: unknown;
  runInput?: unknown;
  organizationSettings?: unknown;
  steps?: unknown;
  runtime?: unknown;
  pendingRemoteResult?: unknown;
  emitEvent?: (event: {
    eventType: string;
    level: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }) => Promise<void>;
  checkpointRuntime?: (runtime: unknown) => Promise<void>;
};

export type WorkflowNodeExecutorResult = {
  status: "succeeded" | "failed" | "blocked";
  output?: unknown;
  error?: string;
  block?: {
    kind: "connector.action" | "agent.execute" | "agent.run";
    dispatchNodeId?: string;
    payload: unknown;
    executorSelector?: ExecutorSelectorV1;
    secret?: string;
    timeoutMs?: number;
  };
  runtime?: unknown;
};

export type WorkflowNodeExecutor = {
  nodeType: string;
  execute(context: WorkflowNodeExecutorContext): Promise<WorkflowNodeExecutorResult> | WorkflowNodeExecutorResult;
};
