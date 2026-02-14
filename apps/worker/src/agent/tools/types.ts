import type { ZodTypeAny } from "zod";

export type AgentToolExecutionMode = "cloud" | "node";

export type AgentToolContext = {
  organizationId: string;
  userId: string;
  runId: string;
  workflowId: string;
  attemptCount: number;
  nodeId: string;
  toolAuthDefaults?: {
    connectors?: Record<string, { secretId: string }>;
  } | null;
  // Shared env passed to connector actions.
  githubApiBaseUrl: string;
  // Load/decrypt an org secret (connector or LLM); the caller supplies the secretId.
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl: typeof fetch;
};

export type AgentToolExecuteResult =
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; error: string; output?: unknown }
  | {
      status: "blocked";
      block: {
        kind: "connector.action" | "agent.execute";
        payload: unknown;
        secret?: string;
        selectorTag?: string;
        selectorAgentId?: string;
        selectorGroup?: string;
        timeoutMs?: number;
      };
    };

export type AgentToolDefinition = {
  id: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  execute: (ctx: AgentToolContext, input: { mode: AgentToolExecutionMode; args: unknown }) => Promise<AgentToolExecuteResult>;
};
