import { z } from "zod";
import type { WorkflowNodeExecutor } from "@vespid/shared";
import { createConnectorActionExecutor } from "./connector-action.js";

// Backward-compatible executor for older workflows. Prefer `connector.action`.
const legacyGithubIssueCreateNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("connector.github.issue.create"),
  config: z.object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/),
    title: z.string().min(1).max(256),
    body: z.string().max(200_000).optional(),
    auth: z.object({
      secretId: z.string().uuid(),
    }),
  }),
});

export function createLegacyGithubIssueCreateExecutor(input: {
  getGithubApiBaseUrl: () => string;
  loadConnectorSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const connectorAction = createConnectorActionExecutor(input);

  return {
    nodeType: "connector.github.issue.create",
    async execute(context) {
      const legacyParsed = legacyGithubIssueCreateNodeSchema.safeParse(context.node);
      if (!legacyParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      return connectorAction.execute({
        ...context,
        nodeType: "connector.action",
        node: {
          id: legacyParsed.data.id,
          type: "connector.action",
          config: {
            connectorId: "github",
            actionId: "issue.create",
            input: {
              repo: legacyParsed.data.config.repo,
              title: legacyParsed.data.config.title,
              body: legacyParsed.data.config.body,
            },
            auth: legacyParsed.data.config.auth,
          },
        },
      });
    },
  };
}
