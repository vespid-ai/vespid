import type { GatewayDispatchRequest, GatewayDispatchResponse, WorkflowNodeExecutor } from "@vespid/shared";
import { z } from "zod";

const agentExecuteNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.execute"),
  config: z
    .object({
      execution: z
        .object({
          mode: z.enum(["cloud", "node"]).default("cloud"),
        })
        .optional(),
    })
    .optional(),
});

export function createAgentExecuteExecutor(input?: {
  dispatchToGateway?: (input: GatewayDispatchRequest) => Promise<GatewayDispatchResponse>;
  nodeExecTimeoutMs?: number;
}): WorkflowNodeExecutor {
  return {
    nodeType: "agent.execute",
    async execute(context) {
      const parsed = agentExecuteNodeSchema.safeParse(context.node);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const executionMode = parsed.data.config?.execution?.mode ?? "cloud";
      if (executionMode === "node") {
        if (!input?.dispatchToGateway) {
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
          kind: "agent.execute",
          payload: {
            nodeId: context.nodeId,
            node: context.node,
          },
          ...(input.nodeExecTimeoutMs ? { timeoutMs: input.nodeExecTimeoutMs } : {}),
        });

        return response.status === "succeeded"
          ? { status: "succeeded", output: response.output }
          : { status: "failed", error: response.error ?? "NODE_EXECUTION_FAILED" };
      }

      return {
        status: "succeeded",
        output: {
          accepted: true,
          taskId: `${context.nodeId}-task`,
        },
      };
    },
  };
}

