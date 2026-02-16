import type { LlmProviderId, WorkflowNodeExecutor } from "@vespid/shared";
import { normalizeLlmProviderId } from "@vespid/shared";
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

const llmProviderSchema = z.string().min(1).transform((value, ctx) => {
  const normalized = normalizeLlmProviderId(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsupported provider: ${value}`,
    });
    return z.NEVER;
  }
  return normalized;
});

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    toolsetId: z.string().uuid().optional(),
    llm: z.object({
      provider: llmProviderSchema.default("openai"),
      model: z.string().min(1).max(120),
      auth: z.object({
        secretId: z.string().uuid().optional(),
        fallbackToEnv: z.literal(true).optional(),
      }),
    }),
    execution: z
      .object({
        mode: z.enum(["cloud", "node"]).default("cloud"),
        selector: z
          .union([
            z.object({ tag: z.string().min(1).max(64) }),
            z.object({ agentId: z.string().uuid() }),
            z.object({ group: z.string().min(1).max(64) }),
          ])
          .optional(),
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

function parseDefaultToolsetId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const toolsets = (settings as any).toolsets;
  if (!toolsets || typeof toolsets !== "object") return null;
  const id = (toolsets as any).defaultToolsetId;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

export function createAgentRunExecutor(input: {
  getGithubApiBaseUrl: () => string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  managedCredits?: {
    ensureAvailable: (input: { organizationId: string; userId: string; minCredits: number }) => Promise<boolean>;
    charge: (input: {
      organizationId: string;
      userId: string;
      workflowId: string;
      runId: string;
      nodeId: string;
      attemptCount: number;
      provider: LlmProviderId;
      model: string;
      turn: number;
      credits: number;
      inputTokens: number;
      outputTokens: number;
    }) => Promise<void>;
  } | null;
  loadToolsetById?: (input: { organizationId: string; toolsetId: string }) => Promise<{
    id: string;
    name: string;
    mcpServers: unknown;
    agentSkills: unknown;
  } | null>;
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

      const execution = node.config.execution ?? { mode: "cloud" as const };
      const engineId = node.config.engine?.id ?? "vespid.loop.v1";

      if (engineId !== "vespid.loop.v1" && execution.mode !== "node") {
        return { status: "failed", error: "AGENT_ENGINE_REQUIRES_NODE_EXECUTION" };
      }

      if (execution.mode === "node") {
        const githubApiBaseUrl = input.getGithubApiBaseUrl();
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

        const llmApiKey =
          node.config.llm.auth.secretId
            ? await input.loadSecretValue({
                organizationId: context.organizationId,
                userId: context.requestedByUserId,
                secretId: node.config.llm.auth.secretId,
              })
            : null;

        const connectorSecretsByConnectorId: Record<string, string> = {};
        if (toolAuthDefaults?.connectors) {
          for (const [connectorId, auth] of Object.entries(toolAuthDefaults.connectors)) {
            const value = await input.loadSecretValue({
              organizationId: context.organizationId,
              userId: context.requestedByUserId,
              secretId: auth.secretId,
            });
            if (value && value.trim().length > 0) {
              connectorSecretsByConnectorId[connectorId] = value;
            }
          }
        }

        const selector = execution.selector ?? null;
        const timeoutMs = Math.max(1000, Math.min(10 * 60 * 1000, node.config.limits.timeoutMs));

        let toolsetPayload: { id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null = null;
        const effectiveToolsetId = node.config.toolsetId ?? parseDefaultToolsetId(context.organizationSettings);
        if (effectiveToolsetId) {
          if (!input.loadToolsetById) {
            return { status: "failed", error: "TOOLSET_LOADER_NOT_CONFIGURED" };
          }
          const loaded = await input.loadToolsetById({ organizationId: context.organizationId, toolsetId: effectiveToolsetId });
          if (!loaded) {
            return { status: "failed", error: "TOOLSET_NOT_FOUND" };
          }
          toolsetPayload = {
            id: loaded.id,
            name: loaded.name,
            mcpServers: loaded.mcpServers ?? [],
            agentSkills: loaded.agentSkills ?? [],
          };
          if (context.emitEvent) {
            await context.emitEvent({
              eventType: "agent_toolset_applied",
              level: "info",
              payload: { toolsetId: loaded.id, toolsetName: loaded.name, engineId },
            });
          }
        }

        const nodeForRemote = {
          ...node,
          config: {
            ...node.config,
            tools: {
              ...node.config.tools,
              allow: effectiveAllow,
            },
          },
        };

        return {
          status: "blocked",
          block: {
            kind: "agent.run",
            payload: {
              nodeId: node.id,
              node: nodeForRemote,
              policyToolsAllow: policyToolAllow,
              effectiveToolsAllow: effectiveAllow,
              runId: context.runId,
              workflowId: context.workflowId,
              attemptCount: context.attemptCount,
              ...(context.runInput !== undefined ? { runInput: context.runInput } : {}),
              ...(context.steps !== undefined ? { steps: context.steps } : {}),
              ...(context.organizationSettings !== undefined ? { organizationSettings: context.organizationSettings } : {}),
              ...(toolsetPayload ? { toolset: toolsetPayload } : {}),
              env: { githubApiBaseUrl },
              secrets: {
                ...(llmApiKey && llmApiKey.trim().length > 0 ? { llmApiKey } : {}),
                ...(Object.keys(connectorSecretsByConnectorId).length > 0
                  ? { connectorSecretsByConnectorId }
                  : {}),
              },
            },
            ...(selector && typeof selector === "object" && "tag" in selector ? { selectorTag: (selector as any).tag } : {}),
            ...(selector && typeof selector === "object" && "agentId" in selector ? { selectorAgentId: (selector as any).agentId } : {}),
            ...(selector && typeof selector === "object" && "group" in selector ? { selectorGroup: (selector as any).group } : {}),
            timeoutMs,
          },
        };
      }

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
        githubApiBaseUrl: input.getGithubApiBaseUrl(),
        loadSecretValue: input.loadSecretValue,
        fetchImpl,
        managedCredits:
          !node.config.llm.auth.secretId && input.managedCredits
            ? {
                ensureAvailable: ({ minCredits }) =>
                  input.managedCredits!.ensureAvailable({
                    organizationId: context.organizationId,
                    userId: context.requestedByUserId,
                    minCredits,
                  }),
                charge: ({ credits, inputTokens, outputTokens, provider, model, turn }) =>
                  input.managedCredits!.charge({
                    organizationId: context.organizationId,
                    userId: context.requestedByUserId,
                    workflowId: context.workflowId,
                    runId: context.runId,
                    nodeId: node.id,
                    attemptCount: context.attemptCount,
                    provider,
                    model,
                    turn,
                    credits,
                    inputTokens,
                    outputTokens,
                  }),
              }
            : null,
        config: {
          llm: { provider: node.config.llm.provider, model: node.config.llm.model, auth: normalizeLlmAuth(node.config.llm.auth) },
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
            llm: { provider: node.config.llm.provider, model: node.config.llm.model, auth: normalizeLlmAuth(node.config.llm.auth) },
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
