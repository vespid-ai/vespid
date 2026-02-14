import type { AgentRunEngineId, AgentRunEngineRunner } from "./types.js";
import { vespidLoopV1Runner } from "./vespid-loop-v1-runner.js";
import { codexSdkV1Runner } from "./codex-sdk-v1-runner.js";

type ExternalEngineModule = {
  createEngineRunner: () => AgentRunEngineRunner;
};

function envModuleName(engineId: AgentRunEngineId): string | null {
  if (engineId === "claude.agent-sdk.v1") {
    return process.env.VESPID_ENGINE_CLAUDE_AGENT_SDK_MODULE ?? "@vespid/engine-claude-agent-sdk";
  }
  return null;
}

async function loadExternalEngine(engineId: AgentRunEngineId): Promise<AgentRunEngineRunner | null> {
  const moduleName = envModuleName(engineId);
  if (!moduleName || moduleName.trim().length === 0) {
    return null;
  }
  try {
    const imported = (await import(moduleName)) as unknown as Partial<ExternalEngineModule>;
    if (!imported || typeof imported.createEngineRunner !== "function") {
      return null;
    }
    const runner = imported.createEngineRunner();
    return runner && typeof runner.run === "function" ? runner : null;
  } catch {
    return null;
  }
}

export async function resolveAgentRunEngine(engineId: AgentRunEngineId): Promise<AgentRunEngineRunner | null> {
  if (engineId === "vespid.loop.v1") {
    return vespidLoopV1Runner;
  }
  if (engineId === "codex.sdk.v1") {
    return codexSdkV1Runner;
  }
  return await loadExternalEngine(engineId);
}
