import type { WorkflowNodeExecutor } from "@vespid/shared";
import { z } from "zod";

const agentExecuteNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.execute"),
  config: z
    .object({
      execution: z
        .object({
          mode: z.enum(["cloud", "executor"]).default("cloud"),
          selector: z
            .object({
              pool: z.enum(["managed", "byon"]).default("managed"),
              labels: z.array(z.string().min(1).max(64)).max(50).optional(),
              tag: z.string().min(1).max(64).optional(),
              group: z.string().min(1).max(64).optional(),
              executorId: z.string().uuid().optional(),
            })
            .optional(),
        })
        .optional(),
      task: z
        .object({
          type: z.literal("shell"),
          script: z.string().min(1).max(200_000),
          shell: z.enum(["sh", "bash"]).optional(),
          env: z.record(z.string().min(1), z.string()).optional(),
        })
        .optional(),
      sandbox: z
        .object({
          backend: z.enum(["docker", "host", "provider"]).optional(),
          network: z.enum(["none", "enabled"]).optional(),
          timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
          docker: z
            .object({
              image: z.string().min(1).optional(),
            })
            .optional(),
          envPassthroughAllowlist: z.array(z.string().min(1)).max(50).optional(),
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

      const executionMode = parsed.data.config?.execution?.mode ?? "cloud";
      if (executionMode === "executor") {
        // Resume path: the continuation worker stores the remote result under runtime.pendingRemoteResult.
        if (context.pendingRemoteResult) {
          const pending = context.pendingRemoteResult as any;
          const remote = pending && typeof pending === "object" && "result" in pending ? (pending as any).result : pending;
          if (remote && typeof remote === "object" && (remote as any).status === "succeeded") {
            return {
              status: "succeeded",
              output: (remote as any).output ?? null,
              runtime:
                context.runtime && typeof context.runtime === "object"
                  ? { ...(context.runtime as any), pendingRemoteResult: null }
                  : { pendingRemoteResult: null },
            };
          }
          if (remote && typeof remote === "object" && (remote as any).status === "failed") {
            return {
              status: "failed",
              error: (remote as any).error ?? "REMOTE_EXECUTION_FAILED",
              runtime:
                context.runtime && typeof context.runtime === "object"
                  ? { ...(context.runtime as any), pendingRemoteResult: null }
                  : { pendingRemoteResult: null },
            };
          }
          return { status: "failed", error: "REMOTE_RESULT_INVALID" };
        }

        const selector = parsed.data.config?.execution?.selector;
        const nodeTimeoutMs = parsed.data.config?.sandbox?.timeoutMs;

        return {
          status: "blocked",
          block: {
            kind: "agent.execute",
            payload: {
              nodeId: parsed.data.id,
              node: parsed.data,
              runId: context.runId,
              workflowId: context.workflowId,
              attemptCount: context.attemptCount,
            },
            ...(selector ? { executorSelector: selector } : {}),
            ...(typeof nodeTimeoutMs === "number" && Number.isFinite(nodeTimeoutMs) ? { timeoutMs: nodeTimeoutMs } : {}),
          },
        };
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
