import type { WorkflowNodeExecutor } from "@vespid/shared";
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
  // Remote execution is handled by the worker state machine (async continuation),
  // not inside the executor.
}): WorkflowNodeExecutor {
  return {
    nodeType: "agent.execute",
    async execute(context) {
      const parsed = agentExecuteNodeSchema.safeParse(context.node);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
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
