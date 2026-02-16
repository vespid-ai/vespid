import { z } from "zod";
import type { AgentToolDefinition, AgentToolExecuteResult } from "./types.js";
import type { ExecutorSelectorV1 } from "@vespid/shared";

const shellRunArgsSchema = z.object({
  script: z.string().min(1).max(200_000),
  shell: z.enum(["sh", "bash"]).optional(),
  env: z.record(z.string().min(1), z.string()).optional(),
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
  selector: z
    .object({
      pool: z.enum(["managed", "byon"]).default("managed"),
      labels: z.array(z.string().min(1).max(64)).max(50).optional(),
      group: z.string().min(1).max(64).optional(),
      tag: z.string().min(1).max(64).optional(),
      executorId: z.string().uuid().optional(),
    })
    .optional(),
});

function normalizeSelector(selector: z.infer<typeof shellRunArgsSchema>["selector"]): ExecutorSelectorV1 | undefined {
  if (!selector) return undefined;
  return {
    pool: selector.pool,
    ...(Array.isArray(selector.labels) && selector.labels.length > 0 ? { labels: selector.labels } : {}),
    ...(typeof selector.group === "string" && selector.group.length > 0 ? { group: selector.group } : {}),
    ...(typeof selector.tag === "string" && selector.tag.length > 0 ? { tag: selector.tag } : {}),
    ...(typeof selector.executorId === "string" && selector.executorId.length > 0 ? { executorId: selector.executorId } : {}),
  };
}

export const shellRunTool: AgentToolDefinition = {
  id: "shell.run",
  description: "Run a shell script on an executor sandbox (executor-only).",
  inputSchema: shellRunArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    if (input.mode !== "executor") {
      return { status: "failed", error: "SHELL_TOOL_REQUIRES_EXECUTOR_EXECUTION" };
    }

    const parsed = shellRunArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }

    const selector = normalizeSelector(parsed.data.selector);
    const nodeId = `${ctx.nodeId}:shell.run`;
    const node = {
      id: nodeId,
      type: "agent.execute",
      config: {
        execution: { mode: "executor" },
        task: {
          type: "shell",
          script: parsed.data.script,
          ...(parsed.data.shell ? { shell: parsed.data.shell } : {}),
          ...(parsed.data.env ? { env: parsed.data.env } : {}),
        },
        ...(parsed.data.sandbox ? { sandbox: parsed.data.sandbox } : {}),
      },
    };

    return {
      status: "blocked",
      block: {
        kind: "agent.execute",
        payload: {
          nodeId,
          node,
          runId: ctx.runId,
          workflowId: ctx.workflowId,
          attemptCount: ctx.attemptCount,
        },
        ...(selector ? { executorSelector: selector } : {}),
        ...(typeof parsed.data.sandbox?.timeoutMs === "number" && Number.isFinite(parsed.data.sandbox.timeoutMs)
          ? { timeoutMs: parsed.data.sandbox.timeoutMs }
          : {}),
      },
    };
  },
};
