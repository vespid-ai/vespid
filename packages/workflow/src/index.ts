import { z } from "zod";

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger.manual") }),
  z.object({ type: z.literal("trigger.webhook"), config: z.object({ token: z.string().min(1) }) }),
  z.object({ type: z.literal("trigger.cron"), config: z.object({ cron: z.string().min(1) }) }),
]);

const defaultAgentLlmProvider = "openai" as const;

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

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    llm: z.object({
      provider: z.literal(defaultAgentLlmProvider).default(defaultAgentLlmProvider),
      model: z.string().min(1).max(120).default("gpt-4.1-mini"),
      auth: z
        .object({
          secretId: z.string().uuid().optional(),
          // MVP: always true. The runtime falls back to env vars (e.g. OPENAI_API_KEY).
          fallbackToEnv: z.literal(true).default(true),
        })
        .default({ fallbackToEnv: true }),
    }),
    prompt: z.object({
      system: z.string().max(200_000).optional(),
      instructions: z.string().min(1).max(200_000),
      inputTemplate: z.string().max(200_000).optional(),
    }),
    tools: z
      .object({
        // Tool IDs; enforcement is runtime-level.
        allow: z.array(z.string().min(1).max(120)),
        execution: z.enum(["cloud", "node"]).default("cloud"),
        // Optional auth defaults so the agent does not need to reference secret UUIDs in tool calls.
        authDefaults: z
          .object({
            connectors: z
              .record(
                z.string().min(1).max(80),
                z.object({
                  secretId: z.string().uuid(),
                })
              )
              .optional(),
          })
          .optional(),
      })
      .default({ allow: [], execution: "cloud" }),
    limits: z
      .object({
        maxTurns: z.number().int().min(1).max(64).default(8),
        maxToolCalls: z.number().int().min(0).max(200).default(20),
        timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).default(60_000),
        maxOutputChars: z.number().int().min(256).max(1_000_000).default(50_000),
        // Guardrail for persisted agent runtime state (history, tool results, etc.).
        maxRuntimeChars: z.number().int().min(1024).max(2_000_000).default(200_000),
      })
      .default({ maxTurns: 8, maxToolCalls: 20, timeoutMs: 60_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 }),
    output: z
      .object({
        mode: z.enum(["text", "json"]).default("text"),
        jsonSchema: z.unknown().optional(),
      })
      .default({ mode: "text" }),
    team: z
      .object({
        mode: z.literal("supervisor"),
        maxParallel: z.number().int().min(1).max(16).default(3),
        leadMode: z.enum(["delegate_only", "normal"]).default("normal"),
        teammates: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              displayName: z.string().min(1).max(120).optional(),
              llm: z
                .object({
                  model: z.string().min(1).max(120),
                })
                .optional(),
              prompt: z.object({
                system: z.string().max(200_000).optional(),
                instructions: z.string().min(1).max(200_000),
                inputTemplate: z.string().max(200_000).optional(),
              }),
              tools: z.object({
                allow: z.array(z.string().min(1).max(120)),
                // v1 restriction: teammates run tools in cloud only (no remote blocking).
                execution: z.literal("cloud").default("cloud"),
                authDefaults: z
                  .object({
                    connectors: z
                      .record(
                        z.string().min(1).max(80),
                        z.object({
                          secretId: z.string().uuid(),
                        })
                      )
                      .optional(),
                  })
                  .optional(),
              }),
              limits: z.object({
                maxTurns: z.number().int().min(1).max(64).default(8),
                maxToolCalls: z.number().int().min(0).max(200).default(20),
                timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).default(60_000),
                maxOutputChars: z.number().int().min(256).max(1_000_000).default(50_000),
                maxRuntimeChars: z.number().int().min(1024).max(2_000_000).default(200_000),
              }),
              output: z.object({
                mode: z.enum(["text", "json"]).default("text"),
                jsonSchema: z.unknown().optional(),
              }),
            })
          )
          .min(1)
          .max(32),
      })
      .optional(),
  }),
});

const nodeExecutionSelectorSchema = z.union([
  z.object({
    tag: z.string().min(1).max(64),
  }),
  z.object({
    agentId: z.string().uuid(),
  }),
  z.object({
    group: z.string().min(1).max(64),
  }),
]);

export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("http.request") }),
  agentRunNodeSchema,
  z.object({
    id: z.string().min(1),
    type: z.literal("agent.execute"),
    config: z
      .object({
        execution: z
          .object({
            mode: z.enum(["cloud", "node"]).default("cloud"),
            selector: nodeExecutionSelectorSchema.optional(),
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
          selector: nodeExecutionSelectorSchema.optional(),
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
  // Opaque runtime state persisted by the worker under workflow_runs.output.runtime.
  // It is not part of the workflow DSL and may change without DSL version bumps.
  runtime?: unknown;
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
        case "agent.run":
          output = {
            accepted: true,
            agentRunId: `${node.id}-agent-run`,
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
