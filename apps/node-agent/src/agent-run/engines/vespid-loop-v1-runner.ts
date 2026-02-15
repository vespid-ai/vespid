import type { AgentRunEngineRunner } from "./types.js";
import type { SandboxBackend } from "../../sandbox/index.js";
import { runVespidLoopV1 } from "../vespid-loop-v1.js";

export const vespidLoopV1Runner: AgentRunEngineRunner = {
  id: "vespid.loop.v1",
  async run(input) {
    return await runVespidLoopV1({
      requestId: input.requestId,
      organizationId: input.organizationId,
      userId: input.userId,
      runId: input.runId,
      workflowId: input.workflowId,
      attemptCount: input.attemptCount,
      nodeId: input.nodeId,
      node: input.node,
      policyToolsAllow: input.policyToolsAllow,
      effectiveToolsAllow: input.effectiveToolsAllow,
      toolset: input.toolset ?? null,
      runInput: input.runInput,
      steps: input.steps,
      organizationSettings: input.organizationSettings,
      githubApiBaseUrl: input.githubApiBaseUrl,
      secrets: input.secrets,
      sandbox: input.sandbox as SandboxBackend,
      ...(typeof input.emitEvent === "function" ? { emitEvent: input.emitEvent } : {}),
    });
  },
};
