import { z } from "zod";

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger.manual") }),
  z.object({ type: z.literal("trigger.webhook"), config: z.object({ token: z.string().min(1) }) }),
  z.object({ type: z.literal("trigger.cron"), config: z.object({ cron: z.string().min(1) }) }),
]);

const agentExecuteTaskSchema = z.object({
  type: z.literal("shell"),
  script: z.string().min(1).max(200_000),
  shell: z.enum(["sh", "bash"]).optional(),
  env: z.record(z.string().min(1), z.string()).optional(),
});

const agentExecuteSandboxSchema = z.object({
  backend: z.enum(["docker", "host", "provider"]).optional(),
  network: z.enum(["none", "enabled"]).optional(),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
  docker: z
    .object({
      image: z.string().min(1).optional(),
    })
    .optional(),
  envPassthroughAllowlist: z.array(z.string().min(1)).max(50).optional(),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("http.request") }),
  z.object({
    id: z.string().min(1),
    type: z.literal("agent.execute"),
    config: z
      .object({
        execution: z
          .object({
            mode: z.enum(["cloud", "node"]).default("cloud"),
          })
          .optional(),
        task: agentExecuteTaskSchema.optional(),
        sandbox: agentExecuteSandboxSchema.optional(),
      })
      .optional(),
  }),
  z.object({
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
  }),
  // Backward-compatible node type. Prefer `connector.action`.
  z.object({
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
  }),
  z.object({ id: z.string().min(1), type: z.literal("condition") }),
  z.object({ id: z.string().min(1), type: z.literal("parallel.join") }),
]);

export const workflowDslSchema = z.object({
  version: z.literal("v2"),
  trigger: workflowTriggerSchema,
  nodes: z.array(workflowNodeSchema).min(1),
});

export type WorkflowDsl = z.infer<typeof workflowDslSchema>;

export type WorkflowExecutionStatus = "succeeded" | "failed";

export type WorkflowExecutionStep = {
  nodeId: string;
  nodeType: WorkflowDsl["nodes"][number]["type"];
  status: WorkflowExecutionStatus;
  output?: unknown;
  error?: string;
};

export type WorkflowExecutionResult = {
  status: WorkflowExecutionStatus;
  steps: WorkflowExecutionStep[];
  output: {
    completedNodeCount: number;
    failedNodeId: string | null;
  };
};

export function executeWorkflow(input: { dsl: WorkflowDsl; runInput?: unknown }): WorkflowExecutionResult {
  const steps: WorkflowExecutionStep[] = [];

  for (const node of input.dsl.nodes) {
    try {
      let output: unknown;
      switch (node.type) {
        case "http.request":
          output = {
            accepted: true,
            requestId: `${node.id}-request`,
          };
          break;
        case "agent.execute":
          output = {
            accepted: true,
            taskId: `${node.id}-task`,
          };
          break;
        case "connector.action":
          output = {
            accepted: true,
            connectorId: node.config.connectorId,
            actionId: node.config.actionId,
          };
          break;
        case "connector.github.issue.create":
          output = {
            accepted: true,
            issueNumber: 1,
            url: `https://github.example/${node.config.repo}/issues/1`,
          };
          break;
        case "condition":
          output = {
            branch: "true",
          };
          break;
        case "parallel.join":
          output = {
            joined: true,
          };
          break;
      }

      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        status: "succeeded",
        output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow node execution failed";
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        status: "failed",
        error: message,
      });
      return {
        status: "failed",
        steps,
        output: {
          completedNodeCount: steps.filter((step) => step.status === "succeeded").length,
          failedNodeId: node.id,
        },
      };
    }
  }

  return {
    status: "succeeded",
    steps,
    output: {
      completedNodeCount: steps.length,
      failedNodeId: null,
    },
  };
}
