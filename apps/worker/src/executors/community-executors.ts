import type { WorkflowNodeExecutor } from "@vespid/shared";
import { createGithubIssueCreateExecutor } from "./github-issue-create.js";

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
          createGithubIssueCreateExecutor({
            githubApiBaseUrl: input.githubApiBaseUrl,
            loadConnectorSecretValue: input.loadConnectorSecretValue,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          }),
        ]
      : []),
    {
      nodeType: "agent.execute",
      async execute(context) {
        return {
          status: "succeeded",
          output: {
            accepted: true,
            taskId: `${context.nodeId}-task`,
          },
        };
      },
    },
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
