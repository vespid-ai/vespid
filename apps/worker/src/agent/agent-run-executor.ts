import type { WorkflowNodeExecutor } from "@vespid/shared";
import { z } from "zod";
import { runAgentLoop } from "./agent-loop.js";

const agentRunTeamTeammateSchema = z.object({
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

const agentRunTeamSchema = z
  .object({
    mode: z.literal("supervisor"),
    maxParallel: z.number().int().min(1).max(16).default(3),
    teammates: z.array(agentRunTeamTeammateSchema).min(1).max(32),
    leadMode: z.enum(["delegate_only", "normal"]).default("normal"),
  })
  .optional();

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    llm: z.object({
      provider: z.literal("openai"),
      model: z.string().min(1).max(120),
      auth: z.object({
        secretId: z.string().uuid().optional(),
        fallbackToEnv: z.literal(true).optional(),
      }),
    }),
    prompt: z.object({
      system: z.string().max(200_000).optional(),
      instructions: z.string().min(1).max(200_000),
      inputTemplate: z.string().max(200_000).optional(),
    }),
    tools: z.object({
      allow: z.array(z.string().min(1).max(120)),
      execution: z.enum(["cloud", "node"]).default("cloud"),
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
    team: agentRunTeamSchema,
  }),
});

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function normalizeLlmAuth(auth: { secretId?: string | undefined; fallbackToEnv?: true | undefined }) {
  return {
    ...(auth.secretId ? { secretId: auth.secretId } : {}),
    ...(auth.fallbackToEnv ? { fallbackToEnv: true as const } : {}),
  };
}

function normalizePrompt(prompt: { system?: string | undefined; instructions: string; inputTemplate?: string | undefined }) {
  return {
    ...(prompt.system ? { system: prompt.system } : {}),
    instructions: prompt.instructions,
    ...(prompt.inputTemplate ? { inputTemplate: prompt.inputTemplate } : {}),
  };
}

export function createAgentRunExecutor(input: {
  githubApiBaseUrl: string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    nodeType: "agent.run",
    async execute(context) {
      const nodeParsed = agentRunNodeSchema.safeParse(context.node);
      if (!nodeParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const node = nodeParsed.data;
      const team = node.config.team ?? null;
      const policyToolAllow = node.config.tools.allow ?? [];
      const toolAuthDefaults = node.config.tools.authDefaults?.connectors
        ? { connectors: node.config.tools.authDefaults.connectors }
        : null;

      const leadMode = team?.leadMode ?? "normal";
      const leadEffectiveAllow =
        team && leadMode === "delegate_only" ? ["team.delegate", "team.map"] : policyToolAllow;

      const effectiveAllow = team ? unique([...leadEffectiveAllow, "team.delegate", "team.map"]) : unique(leadEffectiveAllow);

      return await runAgentLoop({
        organizationId: context.organizationId,
        workflowId: context.workflowId,
        runId: context.runId,
        attemptCount: context.attemptCount,
        requestedByUserId: context.requestedByUserId,
        nodeId: node.id,
        nodeType: "agent.run",
        runInput: context.runInput,
        steps: context.steps,
        organizationSettings: context.organizationSettings,
        runtime: context.runtime,
        pendingRemoteResult: context.pendingRemoteResult,
        githubApiBaseUrl: input.githubApiBaseUrl,
        loadSecretValue: input.loadSecretValue,
        fetchImpl,
        config: {
          llm: { model: node.config.llm.model, auth: normalizeLlmAuth(node.config.llm.auth) },
          prompt: normalizePrompt(node.config.prompt),
          tools: {
            allow: effectiveAllow,
            execution: node.config.tools.execution,
            ...(toolAuthDefaults ? { authDefaults: toolAuthDefaults } : {}),
          },
          limits: node.config.limits,
          output: node.config.output,
        },
        persistNodeId: node.id,
        allowRemoteBlocked: true,
        ...(context.emitEvent ? { emitEvent: context.emitEvent } : {}),
        ...(context.checkpointRuntime ? { checkpointRuntime: context.checkpointRuntime } : {}),
        teamConfig: {
          team,
          parent: {
            nodeId: node.id,
            llm: { model: node.config.llm.model, auth: normalizeLlmAuth(node.config.llm.auth) },
            policyToolAllow,
            runInput: context.runInput ?? null,
            steps: context.steps ?? [],
            organizationSettings: context.organizationSettings ?? null,
          },
        },
      });
    },
  };
}
