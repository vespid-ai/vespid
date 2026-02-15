import { z } from "zod";
import type { GatewayAgentExecuteResultMessage, GatewayServerExecuteMessage } from "@vespid/shared";
import { workflowNodeSchema } from "@vespid/workflow";
import type { SandboxBackend } from "../sandbox/index.js";
import { resolveAgentRunEngine } from "./engines/registry.js";
import type { AgentRunEngineId } from "./engines/types.js";

const agentRunRemotePayloadSchema = z.object({
  nodeId: z.string().min(1),
  node: z.unknown(),
  policyToolsAllow: z.array(z.string().min(1).max(120)).optional(),
  effectiveToolsAllow: z.array(z.string().min(1).max(120)).optional(),
  toolset: z
    .object({
      id: z.string().uuid(),
      name: z.string().min(1).max(120),
      mcpServers: z.unknown(),
      agentSkills: z.unknown(),
    })
    .optional(),
  runId: z.string().uuid(),
  workflowId: z.string().uuid(),
  attemptCount: z.number().int().min(1).max(1000),
  runInput: z.unknown().optional(),
  steps: z.unknown().optional(),
  organizationSettings: z.unknown().optional(),
  env: z.object({
    githubApiBaseUrl: z.string().url(),
  }),
  secrets: z
    .object({
      llmApiKey: z.string().min(1).optional(),
      connectorSecretsByConnectorId: z.record(z.string().min(1), z.string().min(1)).optional(),
    })
    .default({}),
});

export async function executeAgentRun(input: {
  requestId: string;
  incoming: GatewayServerExecuteMessage;
  sandbox: SandboxBackend;
  emitEvent?: (event: { ts: number; kind: string; level: "info" | "warn" | "error"; message?: string; payload?: unknown }) => void;
}): Promise<GatewayAgentExecuteResultMessage> {
  const payloadParsed = agentRunRemotePayloadSchema.safeParse(input.incoming.payload);
  if (!payloadParsed.success) {
    return { type: "execute_result", requestId: input.requestId, status: "failed", error: "INVALID_AGENT_RUN_PAYLOAD" };
  }

  const nodeParsed = workflowNodeSchema.safeParse(payloadParsed.data.node);
  if (!nodeParsed.success || nodeParsed.data.type !== "agent.run") {
    return { type: "execute_result", requestId: input.requestId, status: "failed", error: "INVALID_AGENT_RUN_NODE" };
  }

  const node = nodeParsed.data;
  const engineId = (node.config.engine?.id ?? "vespid.loop.v1") as AgentRunEngineId;
  const engine = await resolveAgentRunEngine(engineId);
  if (!engine) {
    return { type: "execute_result", requestId: input.requestId, status: "failed", error: "ENGINE_ADAPTER_NOT_INSTALLED" };
  }

  const result = await engine.run({
    requestId: input.requestId,
    organizationId: input.incoming.organizationId,
    userId: input.incoming.userId,
    runId: payloadParsed.data.runId,
    workflowId: payloadParsed.data.workflowId,
    attemptCount: payloadParsed.data.attemptCount,
    nodeId: payloadParsed.data.nodeId,
    node,
    policyToolsAllow: payloadParsed.data.policyToolsAllow ?? null,
    effectiveToolsAllow: payloadParsed.data.effectiveToolsAllow ?? null,
    toolset: payloadParsed.data.toolset ?? null,
    runInput: payloadParsed.data.runInput,
    steps: payloadParsed.data.steps,
    organizationSettings: payloadParsed.data.organizationSettings,
    githubApiBaseUrl: payloadParsed.data.env.githubApiBaseUrl,
    secrets: payloadParsed.data.secrets,
    sandbox: input.sandbox as SandboxBackend,
    ...(typeof input.emitEvent === "function" ? { emitEvent: input.emitEvent } : {}),
  });

  if (!result.ok) {
    return { type: "execute_result", requestId: input.requestId, status: "failed", error: result.error };
  }

  return { type: "execute_result", requestId: input.requestId, status: "succeeded", output: result.output };
}
