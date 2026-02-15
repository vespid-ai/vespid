import { z } from "zod";

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger.manual") }),
  z.object({ type: z.literal("trigger.webhook"), config: z.object({ token: z.string().min(1) }) }),
  z.object({ type: z.literal("trigger.cron"), config: z.object({ cron: z.string().min(1) }) }),
]);

const defaultAgentLlmProvider = "openai" as const;

const conditionConfigSchema = z.object({
  path: z.string().min(1).max(500),
  op: z.enum(["eq", "neq", "contains", "exists", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const parallelJoinConfigSchema = z
  .object({
    mode: z.literal("all").default("all"),
    failFast: z.boolean().default(true),
  })
  .default({ mode: "all", failFast: true });

const httpRequestConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().min(1).max(2000),
  headers: z.record(z.string().min(1), z.string()).optional(),
  body: z.unknown().optional(),
});

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

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    toolsetId: z.string().uuid().optional(),
    llm: z.object({
      provider: z.enum(["openai", "anthropic", "gemini", "vertex"]).default(defaultAgentLlmProvider),
      model: z.string().min(1).max(120).default("gpt-4.1-mini"),
      auth: z
        .object({
          secretId: z.string().uuid().optional(),
          // MVP: always true. The runtime falls back to env vars (e.g. OPENAI_API_KEY).
          fallbackToEnv: z.literal(true).default(true),
        })
        .default({ fallbackToEnv: true }),
    }),
    execution: z
      .object({
        mode: z.enum(["cloud", "node"]).default("cloud"),
        selector: nodeExecutionSelectorSchema.optional(),
      })
      .default({ mode: "cloud" }),
    engine: z
      .object({
        id: z.enum(["vespid.loop.v1", "claude.agent-sdk.v1", "codex.sdk.v1"]).default("vespid.loop.v1"),
      })
      .optional(),
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
  })
    .superRefine((value, ctx) => {
      const engineId = value.engine?.id ?? "vespid.loop.v1";
      if (engineId !== "vespid.loop.v1" && value.execution.mode !== "node") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "agent.run engine requires execution.mode=node",
          path: ["execution", "mode"],
        });
      }
    }),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("http.request"),
    config: httpRequestConfigSchema.optional(),
  }),
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
  z.object({
    id: z.string().min(1),
    type: z.literal("condition"),
    config: conditionConfigSchema.optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("parallel.join"),
    config: parallelJoinConfigSchema.optional(),
  }),
]);

export const workflowDslSchema = z.object({
  version: z.literal("v2"),
  trigger: workflowTriggerSchema,
  nodes: z.array(workflowNodeSchema).min(1),
});

export type WorkflowDsl = z.infer<typeof workflowDslSchema>;

export const workflowEdgeV3Schema = z.object({
  id: z.string().min(1).max(120),
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  kind: z.enum(["always", "cond_true", "cond_false"]).optional(),
});

export const workflowDslV3Schema = z.object({
  version: z.literal("v3"),
  trigger: workflowTriggerSchema,
  graph: z.object({
    nodes: z.record(z.string().min(1).max(120), workflowNodeSchema),
    edges: z.array(workflowEdgeV3Schema),
  }),
});

export type WorkflowDslV3 = z.infer<typeof workflowDslV3Schema>;
export type WorkflowDslAny = WorkflowDsl | WorkflowDslV3;

export const workflowDslAnySchema = z.union([workflowDslSchema, workflowDslV3Schema]);

function isRemoteExecutionMode(node: z.infer<typeof workflowNodeSchema>): boolean {
  if (node.type === "agent.execute") {
    return (node.config?.execution?.mode ?? "cloud") === "node";
  }
  if (node.type === "agent.run") {
    return (node.config.execution?.mode ?? "cloud") === "node";
  }
  if (node.type === "connector.action") {
    return (node.config.execution?.mode ?? "cloud") === "node";
  }
  return false;
}

export type WorkflowDslV3ValidationIssue = {
  code:
    | "GRAPH_NODE_MISSING"
    | "GRAPH_EDGE_INVALID"
    | "GRAPH_CYCLE_DETECTED"
    | "CONDITION_EDGE_CONSTRAINTS"
    | "PARALLEL_REMOTE_NOT_SUPPORTED";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type WorkflowDslV3ValidationError = {
  ok: false;
  code: WorkflowDslV3ValidationIssue["code"];
  message: string;
  // Optional structured issues for UI error mapping. The first issue should
  // correspond to code/message.
  issues?: WorkflowDslV3ValidationIssue[];
};

export function validateV3GraphConstraints(dsl: WorkflowDslV3): { ok: true } | WorkflowDslV3ValidationError {
  const nodes = dsl.graph.nodes ?? {};
  const edges = dsl.graph.edges ?? [];

  const nodeIds = new Set(Object.keys(nodes));
  if (nodeIds.size === 0) {
    const issue: WorkflowDslV3ValidationIssue = {
      code: "GRAPH_NODE_MISSING",
      message: "Graph must include at least one node",
    };
    return { ok: false, ...issue, issues: [issue] };
  }

  const edgeIds = new Set<string>();
  const outgoing = new Map<string, Array<z.infer<typeof workflowEdgeV3Schema>>>();
  const incoming = new Map<string, Array<z.infer<typeof workflowEdgeV3Schema>>>();

  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      const issue: WorkflowDslV3ValidationIssue = {
        code: "GRAPH_EDGE_INVALID",
        message: `Duplicate edge id: ${edge.id}`,
        edgeId: edge.id,
      };
      return { ok: false, ...issue, issues: [issue] };
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      const issue: WorkflowDslV3ValidationIssue = {
        code: "GRAPH_EDGE_INVALID",
        message: `Edge must connect existing nodes: ${edge.id}`,
        edgeId: edge.id,
      };
      return { ok: false, ...issue, issues: [issue] };
    }
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (!node || node.type !== "condition") {
      continue;
    }
    const out = outgoing.get(id) ?? [];
    const kinds = out.map((e) => e.kind ?? "always");
    const trueCount = kinds.filter((k) => k === "cond_true").length;
    const falseCount = kinds.filter((k) => k === "cond_false").length;
    const other = kinds.filter((k) => k !== "cond_true" && k !== "cond_false").length;
    if (trueCount !== 1 || falseCount !== 1 || other !== 0 || out.length !== 2) {
      const issue: WorkflowDslV3ValidationIssue = {
        code: "CONDITION_EDGE_CONSTRAINTS",
        message: `Condition node ${id} must have exactly one cond_true and one cond_false outgoing edge`,
        nodeId: id,
      };
      return { ok: false, ...issue, issues: [issue] };
    }
  }

  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    visited += 1;
    for (const edge of outgoing.get(id) ?? []) {
      const next = edge.to;
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
      }
    }
  }
  if (visited !== nodeIds.size) {
    const issue: WorkflowDslV3ValidationIssue = {
      code: "GRAPH_CYCLE_DETECTED",
      message: "Graph must be a DAG (cycles are not supported in v3 MVP)",
    };
    return { ok: false, ...issue, issues: [issue] };
  }

  const joinNodeIds = Object.entries(nodes)
    .filter(([, node]) => node?.type === "parallel.join")
    .map(([id]) => id);

  function computeCanReach(targetId: string): Set<string> {
    const seen = new Set<string>();
    const stack = [targetId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      for (const edge of incoming.get(current) ?? []) {
        if (!seen.has(edge.from)) {
          seen.add(edge.from);
          stack.push(edge.from);
        }
      }
    }
    return seen;
  }

  function computeReachableFrom(startId: string): Set<string> {
    const seen = new Set<string>([startId]);
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      for (const edge of outgoing.get(current) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    return seen;
  }

  for (const joinId of joinNodeIds) {
    const canReachJoin = computeCanReach(joinId);
    for (const rootId of canReachJoin) {
      const out = outgoing.get(rootId) ?? [];
      const alwaysEdges = out.filter((e) => (e.kind ?? "always") === "always");
      if (alwaysEdges.length < 2) {
        continue;
      }
      for (const edge of alwaysEdges) {
        const branchReach = computeReachableFrom(edge.to);
        for (const nodeId of branchReach) {
          if (nodeId === joinId) {
            continue;
          }
          if (!canReachJoin.has(nodeId)) {
            continue;
          }
          const node = nodes[nodeId];
          if (node && isRemoteExecutionMode(node)) {
            const issue: WorkflowDslV3ValidationIssue = {
              code: "PARALLEL_REMOTE_NOT_SUPPORTED",
              message: `Remote execution is not supported inside parallel regions in v3 MVP (node ${nodeId})`,
              nodeId,
            };
            return { ok: false, ...issue, issues: [issue] };
          }
        }
      }
    }
  }

  return { ok: true };
}

export function upgradeV2ToV3(dslV2: WorkflowDsl): WorkflowDslV3 {
  const nodes: Record<string, z.infer<typeof workflowNodeSchema>> = {};
  for (const node of dslV2.nodes) {
    if (node.type === "connector.github.issue.create") {
      nodes[node.id] = {
        id: node.id,
        type: "connector.action",
        config: {
          connectorId: "github",
          actionId: "issue.create",
          input: {
            repo: node.config.repo,
            title: node.config.title,
            ...(node.config.body ? { body: node.config.body } : {}),
          },
          auth: { secretId: node.config.auth.secretId },
        },
      } as any;
      continue;
    }
    nodes[node.id] = node;
  }
  const edges: Array<z.infer<typeof workflowEdgeV3Schema>> = [];
  for (let i = 0; i < dslV2.nodes.length - 1; i += 1) {
    const from = dslV2.nodes[i]?.id;
    const to = dslV2.nodes[i + 1]?.id;
    if (!from || !to) {
      continue;
    }
    edges.push({ id: `e:${from}->${to}`, from, to, kind: "always" });
  }
  return {
    version: "v3",
    trigger: dslV2.trigger,
    graph: { nodes, edges },
  };
}

export type WorkflowExecutionStatus = "succeeded" | "failed";

export type WorkflowExecutionStep = {
  nodeId: string;
  nodeType: z.infer<typeof workflowNodeSchema>["type"];
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
