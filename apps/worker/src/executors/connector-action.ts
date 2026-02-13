import type { WorkflowNodeExecutor } from "@vespid/shared";
import { getCommunityConnectorAction } from "@vespid/connectors";
import { z } from "zod";

const connectorActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("connector.action"),
  config: z.object({
    connectorId: z.string().min(1),
    actionId: z.string().min(1),
    input: z.unknown().optional(),
    auth: z.object({
      secretId: z.string().uuid(),
    }),
  }),
});

export function createConnectorActionExecutor(input: {
  githubApiBaseUrl: string;
  loadConnectorSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    nodeType: "connector.action",
    async execute(context) {
      const nodeParsed = connectorActionNodeSchema.safeParse(context.node);
      if (!nodeParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const { connectorId, actionId } = nodeParsed.data.config;

      const action = getCommunityConnectorAction({ connectorId, actionId });
      if (!action) {
        return { status: "failed", error: `ACTION_NOT_SUPPORTED:${connectorId}:${actionId}` };
      }

      const actionInputParsed = action.inputSchema.safeParse(nodeParsed.data.config.input);
      if (!actionInputParsed.success) {
        return { status: "failed", error: "INVALID_ACTION_INPUT" };
      }

      const secret = action.requiresSecret
        ? await input.loadConnectorSecretValue({
            organizationId: context.organizationId,
            userId: context.requestedByUserId,
            secretId: nodeParsed.data.config.auth.secretId,
          })
        : null;

      return action.execute({
        organizationId: context.organizationId,
        userId: context.requestedByUserId,
        connectorId,
        actionId,
        input: actionInputParsed.data,
        secret,
        env: {
          githubApiBaseUrl: input.githubApiBaseUrl,
        },
        fetchImpl,
      });
    },
  };
}
