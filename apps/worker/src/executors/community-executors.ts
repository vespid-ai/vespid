import type { WorkflowNodeExecutor } from "@vespid/shared";
import { createConnectorActionExecutor } from "./connector-action.js";
import { createLegacyGithubIssueCreateExecutor } from "./github-issue-create.js";
import { createAgentExecuteExecutor } from "./agent-execute.js";
import { createAgentRunExecutor } from "../agent/agent-run-executor.js";

export function getCommunityWorkflowNodeExecutors(input?: {
  getGithubApiBaseUrl?: () => string;
  loadConnectorSecretValue?: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  managedCredits?: {
    ensureAvailable: (input: { organizationId: string; userId: string; minCredits: number }) => Promise<boolean>;
    charge: (input: {
      organizationId: string;
      userId: string;
      workflowId: string;
      runId: string;
      nodeId: string;
      attemptCount: number;
      provider: "openai" | "anthropic" | "gemini" | "vertex";
      model: string;
      turn: number;
      credits: number;
      inputTokens: number;
      outputTokens: number;
    }) => Promise<void>;
  } | null;
  loadToolsetById?: (input: { organizationId: string; toolsetId: string }) => Promise<{
    id: string;
    name: string;
    mcpServers: unknown;
    agentSkills: unknown;
  } | null>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor[] {
  return [
    {
      nodeType: "http.request",
      async execute(context) {
        return {
          status: "succeeded",
          output: {
            accepted: true,
            requestId: `${context.nodeId}-request`,
          },
        };
      },
    },
    ...(input?.getGithubApiBaseUrl && input.loadConnectorSecretValue
      ? [
          createAgentRunExecutor({
            getGithubApiBaseUrl: input.getGithubApiBaseUrl,
            loadSecretValue: input.loadConnectorSecretValue,
            ...(input.managedCredits ? { managedCredits: input.managedCredits } : {}),
            ...(input.loadToolsetById ? { loadToolsetById: input.loadToolsetById } : {}),
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
          createConnectorActionExecutor({
            getGithubApiBaseUrl: input.getGithubApiBaseUrl,
            loadConnectorSecretValue: input.loadConnectorSecretValue,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
          createLegacyGithubIssueCreateExecutor({
            getGithubApiBaseUrl: input.getGithubApiBaseUrl,
            loadConnectorSecretValue: input.loadConnectorSecretValue,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
        ]
      : []),
    createAgentExecuteExecutor({
      // Remote execution is handled by the worker state machine.
    }),
    {
      nodeType: "condition",
      async execute() {
        return {
          status: "succeeded",
          output: {
            branch: "true",
          },
        };
      },
    },
    {
      nodeType: "parallel.join",
      async execute() {
        return {
          status: "succeeded",
          output: {
            joined: true,
          },
        };
      },
    },
  ];
}
