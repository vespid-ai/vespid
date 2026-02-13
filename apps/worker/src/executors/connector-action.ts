import type { WorkflowNodeExecutor } from "@vespid/shared";
import { getCommunityConnectorAction } from "@vespid/connectors";
import { z } from "zod";
import type { GatewayDispatchRequest, GatewayDispatchResponse } from "@vespid/shared";

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
    execution: z
      .object({
        mode: z.enum(["cloud", "node"]).default("cloud"),
      })
      .optional(),
  }),
});

export function createConnectorActionExecutor(input: {
  githubApiBaseUrl: string;
  loadConnectorSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  dispatchToGateway?: (input: GatewayDispatchRequest) => Promise<GatewayDispatchResponse>;
  nodeExecTimeoutMs?: number;
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
      const executionMode = nodeParsed.data.config.execution?.mode ?? "cloud";

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

      if (executionMode === "node") {
        if (!input.dispatchToGateway) {
          return { status: "failed", error: "GATEWAY_NOT_CONFIGURED" };
        }

        const response = await input.dispatchToGateway({
          organizationId: context.organizationId,
          requestedByUserId: context.requestedByUserId,
          runId: context.runId,
          workflowId: context.workflowId,
          nodeId: context.nodeId,
          nodeType: context.nodeType,
          attemptCount: context.attemptCount,
          kind: "connector.action",
          payload: {
            connectorId,
            actionId,
            input: actionInputParsed.data,
            env: {
              githubApiBaseUrl: input.githubApiBaseUrl,
            },
          },
          ...(secret ? { secret } : {}),
          ...(input.nodeExecTimeoutMs ? { timeoutMs: input.nodeExecTimeoutMs } : {}),
        });

        return response.status === "succeeded"
          ? { status: "succeeded", output: response.output }
          : { status: "failed", error: response.error ?? "NODE_EXECUTION_FAILED" };
      }

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
