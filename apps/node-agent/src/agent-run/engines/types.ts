export type AgentRunEngineId = "vespid.loop.v1" | "claude.agent-sdk.v1" | "codex.sdk.v1";

export type AgentRunEngineEmitEvent = (event: {
  ts: number;
  kind: string;
  level: "info" | "warn" | "error";
  message?: string;
  payload?: unknown;
}) => void;

export type AgentRunEngineRunInput = {
  requestId: string;
  organizationId: string;
  userId: string;
  runId: string;
  workflowId: string;
  attemptCount: number;
  nodeId: string;
  node: any; // workflowNodeSchema validated upstream
  policyToolsAllow: string[] | null;
  effectiveToolsAllow: string[] | null;
  runInput?: unknown;
  steps?: unknown;
  organizationSettings?: unknown;
  githubApiBaseUrl: string;
  secrets: {
    llmApiKey?: string | undefined;
    connectorSecretsByConnectorId?: Record<string, string> | undefined;
  };
  sandbox: unknown;
  emitEvent?: AgentRunEngineEmitEvent;
};

export type AgentRunEngineRunResult = { ok: true; output: unknown } | { ok: false; error: string };

export type AgentRunEngineRunner = {
  id: AgentRunEngineId;
  run: (input: AgentRunEngineRunInput) => Promise<AgentRunEngineRunResult>;
};
