import type { WorkflowNodeExecutor } from "@vespid/shared";
import { AGENT_ENGINE_IDS } from "@vespid/shared";
import { z } from "zod";

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    toolsetId: z.string().uuid().optional(),
    engine: z.object({
      id: z.enum(AGENT_ENGINE_IDS),
      model: z.string().min(1).max(120).optional(),
      auth: z
        .object({
          secretId: z.string().uuid().optional(),
        })
        .optional(),
    }),
    execution: z
      .object({
        mode: z.literal("gateway").default("gateway"),
        selector: z
          .object({
            pool: z.enum(["managed", "byon"]).default("byon"),
            labels: z.array(z.string().min(1).max(64)).max(50).optional(),
            group: z.string().min(1).max(64).optional(),
            tag: z.string().min(1).max(64).optional(),
            executorId: z.string().uuid().optional(),
          })
          .optional(),
      })
      .default({ mode: "gateway" }),
    prompt: z.object({
      system: z.string().max(200_000).optional(),
      instructions: z.string().min(1).max(200_000),
      inputTemplate: z.string().max(200_000).optional(),
    }),
    tools: z.object({
      allow: z.array(z.string().min(1).max(120)),
      execution: z.enum(["cloud", "executor"]).default("cloud"),
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

function parseDefaultToolsetId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const toolsets = (settings as any).toolsets;
  if (!toolsets || typeof toolsets !== "object") return null;
  const id = (toolsets as any).defaultToolsetId;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

function resolveEngineSecretId(input: {
  organizationSettings: unknown;
  engineId: (typeof AGENT_ENGINE_IDS)[number];
  explicitSecretId: string | null;
}): string | null {
  if (input.explicitSecretId) {
    return input.explicitSecretId;
  }
  if (!input.organizationSettings || typeof input.organizationSettings !== "object" || Array.isArray(input.organizationSettings)) {
    return null;
  }
  const agents = (input.organizationSettings as any).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return null;
  }
  const engineAuthDefaults = (agents as any).engineAuthDefaults;
  if (!engineAuthDefaults || typeof engineAuthDefaults !== "object" || Array.isArray(engineAuthDefaults)) {
    return null;
  }
  const engineDefault = (engineAuthDefaults as any)[input.engineId];
  if (!engineDefault || typeof engineDefault !== "object" || Array.isArray(engineDefault)) {
    return null;
  }
  const mode = (engineDefault as any).mode;
  const secretId = (engineDefault as any).secretId;
  if (mode !== "api_key") {
    return null;
  }
  return typeof secretId === "string" && secretId.length > 0 ? secretId : null;
}

export function createAgentRunExecutor(input: {
  getGithubApiBaseUrl: () => string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  managedCredits?: unknown;
  loadToolsetById?: (input: { organizationId: string; toolsetId: string }) => Promise<{ id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  return {
    nodeType: "agent.run",
    async execute(context) {
      const nodeParsed = agentRunNodeSchema.safeParse(context.node);
      if (!nodeParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const node = nodeParsed.data;
      const policyToolAllow = node.config.tools.allow ?? [];
      const effectiveAllow = unique(policyToolAllow);

      const selector = node.config.execution.selector ?? null;
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
      }

      const nodeForGateway = {
        ...node,
        config: {
          ...node.config,
          tools: {
            ...node.config.tools,
            allow: effectiveAllow,
          },
        },
      };

      const connectorSecretIdsByConnectorId = node.config.tools.authDefaults?.connectors
        ? Object.fromEntries(
            Object.entries(node.config.tools.authDefaults.connectors)
              .filter(([, auth]) => typeof auth?.secretId === "string" && auth.secretId.length > 0)
              .map(([connectorId, auth]) => [connectorId, auth.secretId])
          )
        : {};

      const effectiveEngineSecretId = resolveEngineSecretId({
        organizationSettings: context.organizationSettings,
        engineId: node.config.engine.id,
        explicitSecretId: node.config.engine.auth?.secretId ?? null,
      });

      return {
        status: "blocked",
        block: {
          kind: "agent.run",
          payload: {
            nodeId: node.id,
            node: nodeForGateway,
            policyToolsAllow: policyToolAllow,
            effectiveToolsAllow: effectiveAllow,
            runId: context.runId,
            workflowId: context.workflowId,
            attemptCount: context.attemptCount,
            ...(context.runInput !== undefined ? { runInput: context.runInput } : {}),
            ...(context.steps !== undefined ? { steps: context.steps } : {}),
            ...(context.organizationSettings !== undefined ? { organizationSettings: context.organizationSettings } : {}),
            ...(toolsetPayload ? { toolset: toolsetPayload } : {}),
            env: { githubApiBaseUrl: input.getGithubApiBaseUrl() },
            secretRefs: {
              ...(effectiveEngineSecretId ? { engineSecretId: effectiveEngineSecretId } : {}),
              ...(Object.keys(connectorSecretIdsByConnectorId).length > 0
                ? { connectorSecretIdsByConnectorId }
                : {}),
            },
          },
          ...(selector ? { executorSelector: selector } : {}),
          timeoutMs,
        },
      };
    },
  };
}
