import { z } from "zod";
import type { AgentToolDefinition, AgentToolExecuteResult } from "./types.js";
import { runAgentLoop, type AgentTeamMeta } from "../agent-loop.js";

const teamDelegateArgsSchema = z.object({
  teammateId: z.string().min(1).max(64),
  task: z.string().min(1).max(200_000),
  input: z.unknown().optional(),
});

const teamMapArgsSchema = z.object({
  tasks: z
    .array(
      z.object({
        teammateId: z.string().min(1).max(64),
        task: z.string().min(1).max(200_000),
        input: z.unknown().optional(),
      })
    )
    .min(1)
    .max(64),
  maxParallel: z.number().int().min(1).max(16).optional(),
});

const teammateConfigSchema = z.object({
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
    execution: z.literal("cloud").default("cloud"),
    authDefaults: z
      .object({
        connectors: z.record(z.string().min(1).max(80), z.object({ secretId: z.string().uuid() })).optional(),
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
});

const teamConfigSchema = z.object({
  team: z
    .object({
      mode: z.literal("supervisor"),
      maxParallel: z.number().int().min(1).max(16).default(3),
      leadMode: z.enum(["delegate_only", "normal"]).default("normal"),
      teammates: z.array(teammateConfigSchema).min(1).max(32),
    })
    .nullable(),
  parent: z.object({
    nodeId: z.string().min(1),
    llm: z.object({
      provider: z.enum(["openai", "anthropic"]).default("openai"),
      model: z.string().min(1).max(120),
      auth: z.object({ secretId: z.string().uuid().optional(), fallbackToEnv: z.literal(true).optional() }),
    }),
    // Policy allowlist is the node's configured tools.allow (not affected by leadMode).
    policyToolAllow: z.array(z.string().min(1).max(120)),
    runInput: z.unknown().optional(),
    steps: z.unknown().optional(),
    organizationSettings: z.unknown().optional(),
  }),
});

type TeamConfig = z.infer<typeof teamConfigSchema>;

function intersectAllowlist(parent: string[], teammate: string[]): string[] {
  const parentSet = new Set(parent);
  // Prevent recursive delegation in v1.
  const forbidden = new Set(["team.delegate", "team.map"]);
  return teammate.filter((t) => parentSet.has(t) && !forbidden.has(t));
}

function normalizeLlmAuth(auth: { secretId?: string | undefined; fallbackToEnv?: true | undefined }) {
  return {
    ...(auth.secretId ? { secretId: auth.secretId } : {}),
    ...(auth.fallbackToEnv ? { fallbackToEnv: true as const } : {}),
  };
}

async function runDelegate(input: {
  ctx: Parameters<AgentToolDefinition["execute"]>[0];
  args: z.infer<typeof teamDelegateArgsSchema>;
  team: TeamConfig;
}): Promise<AgentToolExecuteResult> {
  const team = input.team.team;
  if (!team) {
    return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
  }

  const teammate = team.teammates.find((t) => t.id === input.args.teammateId) ?? null;
  if (!teammate) {
    return { status: "failed", error: `TEAMMATE_NOT_FOUND:${input.args.teammateId}` };
  }

  const effectiveAllow = intersectAllowlist(input.team.parent.policyToolAllow, teammate.tools.allow);

  const parentNodeId = input.team.parent.nodeId;
  const parentCallIndex = input.ctx.callIndex;
  const teamMeta: AgentTeamMeta = {
    teammateId: teammate.id,
    parentNodeId,
    parentCallIndex,
  };

  await input.ctx.emitEvent?.({
    eventType: "team_delegate_started",
    level: "info",
    payload: { teammateId: teammate.id, parentNodeId, parentCallIndex },
  });

  const emitEventWrapped = input.ctx.emitEvent
    ? async (event: { eventType: string; level: "info" | "warn" | "error"; message?: string | null; payload?: unknown }) => {
        const payload =
          event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? { ...(event.payload as any), team: teamMeta }
            : { payload: event.payload ?? null, team: teamMeta };
        await input.ctx.emitEvent?.({ ...event, payload });
      }
    : undefined;

  const result = await runAgentLoop({
    organizationId: input.ctx.organizationId,
    workflowId: input.ctx.workflowId,
    runId: input.ctx.runId,
    attemptCount: input.ctx.attemptCount,
    requestedByUserId: input.ctx.userId,
    nodeId: `${parentNodeId}:team:${teammate.id}`,
    nodeType: "agent.run.team",
    runInput: {
      parentRunInput: input.team.parent.runInput ?? null,
      task: input.args.task,
      input: input.args.input ?? null,
    },
    steps: input.team.parent.steps ?? [],
    organizationSettings: input.team.parent.organizationSettings ?? null,
    runtime: {},
    pendingRemoteResult: null,
    githubApiBaseUrl: input.ctx.githubApiBaseUrl,
    loadSecretValue: input.ctx.loadSecretValue,
    fetchImpl: input.ctx.fetchImpl,
    managedCredits: input.ctx.managedCredits ?? null,
    config: {
      llm: {
        provider: input.team.parent.llm.provider,
        model: teammate.llm?.model ?? input.team.parent.llm.model,
        auth: normalizeLlmAuth(input.team.parent.llm.auth),
      },
      prompt: {
        ...(teammate.prompt.system ? { system: teammate.prompt.system } : {}),
        instructions: teammate.prompt.instructions,
        ...(teammate.prompt.inputTemplate ? { inputTemplate: teammate.prompt.inputTemplate } : {}),
      },
      tools: {
        allow: effectiveAllow,
        execution: "cloud",
        ...(teammate.tools.authDefaults?.connectors
          ? { authDefaults: { connectors: teammate.tools.authDefaults.connectors } }
          : {}),
      },
      limits: teammate.limits,
      output: teammate.output,
    },
    persistNodeId: null,
    allowRemoteBlocked: false,
    ...(emitEventWrapped ? { emitEvent: emitEventWrapped } : {}),
    teamMeta,
    teamConfig: null,
  });

  if (result.status !== "succeeded") {
    const toolPolicyDenied = typeof result.error === "string" && result.error.startsWith("TOOL_NOT_ALLOWED:")
      ? `TEAM_TOOL_POLICY_DENIED:${result.error.slice("TOOL_NOT_ALLOWED:".length)}`
      : result.error;

    await input.ctx.emitEvent?.({
      eventType: "team_delegate_failed",
      level: "warn",
      payload: { teammateId: teammate.id, parentNodeId, parentCallIndex, error: toolPolicyDenied ?? "TEAM_DELEGATE_FAILED" },
    });

    return { status: "failed", error: toolPolicyDenied ?? "TEAM_DELEGATE_FAILED" };
  }

  await input.ctx.emitEvent?.({
    eventType: "team_delegate_succeeded",
    level: "info",
    payload: { teammateId: teammate.id, parentNodeId, parentCallIndex },
  });

  return {
    status: "succeeded",
    output: {
      teammateId: teammate.id,
      output: result.output ?? null,
    },
  };
}

async function runWithConcurrency<T>(input: { items: T[]; maxParallel: number; run: (item: T, index: number) => Promise<any> }) {
  const results: any[] = new Array(input.items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= input.items.length) {
        return;
      }
      results[idx] = await input.run(input.items[idx] as T, idx);
    }
  }

  const workers = new Array(Math.min(input.maxParallel, input.items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

export const teamDelegateTool: AgentToolDefinition = {
  id: "team.delegate",
  description: "Delegate a task to a teammate subagent (in-node).",
  inputSchema: teamDelegateArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    const parsed = teamDelegateArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }

    const configParsed = teamConfigSchema.safeParse(ctx.teamConfig);
    if (!configParsed.success) {
      return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
    }

    return await runDelegate({ ctx, args: parsed.data, team: configParsed.data });
  },
};

export const teamMapTool: AgentToolDefinition = {
  id: "team.map",
  description: "Delegate multiple tasks to teammates, with bounded parallelism (in-node).",
  inputSchema: teamMapArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    const parsed = teamMapArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }

    const configParsed = teamConfigSchema.safeParse(ctx.teamConfig);
    if (!configParsed.success) {
      return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
    }
    const team = configParsed.data.team;
    if (!team) {
      return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
    }

    const maxParallel = Math.max(
      1,
      Math.min(16, parsed.data.maxParallel ?? team.maxParallel ?? 3)
    );

    await ctx.emitEvent?.({
      eventType: "team_map_started",
      level: "info",
      payload: { taskCount: parsed.data.tasks.length, maxParallel, parentNodeId: configParsed.data.parent.nodeId, parentCallIndex: ctx.callIndex },
    });

    const outputs = await runWithConcurrency({
      items: parsed.data.tasks,
      maxParallel,
      run: async (task) => {
        const out = await runDelegate({ ctx, args: task, team: configParsed.data });
        if (out.status === "succeeded") {
          return { status: "succeeded", ...(out.output as any) };
        }
        if (out.status === "blocked") {
          return { status: "failed", teammateId: task.teammateId, error: "TEAM_REMOTE_EXEC_NOT_SUPPORTED" };
        }
        return { status: "failed", teammateId: task.teammateId, error: out.error };
      },
    });

    await ctx.emitEvent?.({
      eventType: "team_map_completed",
      level: "info",
      payload: { taskCount: parsed.data.tasks.length, maxParallel, parentNodeId: configParsed.data.parent.nodeId, parentCallIndex: ctx.callIndex },
    });

    return { status: "succeeded", output: outputs };
  },
};
