export type Edition = "community" | "enterprise";

export const communityFeatureCapabilities = [
  "auth_email_oauth",
  "org_rbac_baseline",
  "workflow_dsl_v2",
  "workflow_async_queue",
  "tenant_rls",
] as const;

export type CommunityFeatureCapability = (typeof communityFeatureCapabilities)[number];

export type FeatureCapability =
  | CommunityFeatureCapability
  | "sso"
  | "scim"
  | "audit_export"
  | "advanced_rbac"
  | "compliance_reporting"
  | "enterprise_connector_pack"
  | "approval_policy_pack"
  | (string & {});

export type EnterpriseConnectorContract = {
  id: string;
  displayName: string;
  requiresSecret: boolean;
};

export type EnterpriseProviderContext = {
  organizationId?: string;
  userId?: string;
};

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
  // Organization-scoped configuration blob (e.g. tool policies). Shape is intentionally opaque.
  organizationSettings?: unknown;
  // Execution steps completed so far for the current attempt.
  steps?: unknown;
  // Opaque workflow-run runtime state persisted under workflow_runs.output.runtime.
  runtime?: unknown;
  // When a run is resumed after remote execution, the continuation worker
  // stores the remote result in runtime and re-enqueues the run. Executors
  // may consume it to complete the in-flight operation.
  pendingRemoteResult?: unknown;
  // Optional per-node event emitter for structured debugging/observability.
  emitEvent?: (event: {
    eventType: string;
    level: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }) => Promise<void>;
  // Optional checkpoint hook to persist runtime progress mid-node (used for idempotency).
  checkpointRuntime?: (runtime: unknown) => Promise<void>;
};

export type WorkflowNodeExecutorResult = {
  status: "succeeded" | "failed" | "blocked";
  output?: unknown;
  error?: string;
  // Only used when status === "blocked".
  block?: {
    kind: "connector.action" | "agent.execute" | "agent.run";
    // Optional override used to build deterministic gateway request IDs.
    // If omitted, the workflow nodeId is used.
    dispatchNodeId?: string;
    payload: unknown;
    selectorTag?: string;
    selectorAgentId?: string;
    selectorGroup?: string;
    secret?: string;
    timeoutMs?: number;
  };
  // Optional runtime override to persist under workflow_runs.output.runtime.
  runtime?: unknown;
};

export type WorkflowNodeExecutor = {
  nodeType: string;
  execute(context: WorkflowNodeExecutorContext): Promise<WorkflowNodeExecutorResult> | WorkflowNodeExecutorResult;
};

export type EnterpriseProvider = {
  edition: Edition;
  name: string;
  version?: string;
  getCapabilities(context?: EnterpriseProviderContext): FeatureCapability[];
  getEnterpriseConnectors?(context?: EnterpriseProviderContext): EnterpriseConnectorContract[];
  getWorkflowNodeExecutors?(context?: EnterpriseProviderContext): WorkflowNodeExecutor[];
};
