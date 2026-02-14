import type { WorkflowNodeExecutor } from "@vespid/shared";
import { createConnectorActionExecutor } from "./connector-action.js";
import { createLegacyGithubIssueCreateExecutor } from "./github-issue-create.js";
import { createAgentExecuteExecutor } from "./agent-execute.js";
import { createAgentRunExecutor } from "../agent/agent-run-executor.js";

export function getCommunityWorkflowNodeExecutors(input?: {
  githubApiBaseUrl?: string;
  loadConnectorSecretValue?: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
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
    ...(input?.githubApiBaseUrl && input.loadConnectorSecretValue
      ? [
          createAgentRunExecutor({
            githubApiBaseUrl: input.githubApiBaseUrl,
            loadSecretValue: input.loadConnectorSecretValue,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
          createConnectorActionExecutor({
            githubApiBaseUrl: input.githubApiBaseUrl,
            loadConnectorSecretValue: input.loadConnectorSecretValue,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
          createLegacyGithubIssueCreateExecutor({
            githubApiBaseUrl: input.githubApiBaseUrl,
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
