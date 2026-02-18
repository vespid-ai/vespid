export const AGENT_ENGINE_IDS = [
  "gateway.codex.v2",
  "gateway.claude.v2",
  "gateway.opencode.v2",
] as const;

export type AgentEngineId = (typeof AGENT_ENGINE_IDS)[number];

export type AgentEngineMeta = {
  id: AgentEngineId;
  displayName: string;
  cliCommand: string;
  defaultModel: string;
  defaultSecretConnectorId: string;
};

const ENGINES: Record<AgentEngineId, AgentEngineMeta> = {
  "gateway.codex.v2": {
    id: "gateway.codex.v2",
    displayName: "Codex",
    cliCommand: "codex",
    defaultModel: "gpt-5-codex",
    defaultSecretConnectorId: "agent.codex",
  },
  "gateway.claude.v2": {
    id: "gateway.claude.v2",
    displayName: "Claude Code",
    cliCommand: "claude",
    defaultModel: "claude-sonnet-4-20250514",
    defaultSecretConnectorId: "agent.claude",
  },
  "gateway.opencode.v2": {
    id: "gateway.opencode.v2",
    displayName: "OpenCode",
    cliCommand: "opencode",
    defaultModel: "claude-opus-4-6",
    defaultSecretConnectorId: "agent.opencode",
  },
};

export function isAgentEngineId(input: string | null | undefined): input is AgentEngineId {
  if (typeof input !== "string") return false;
  return input in ENGINES;
}

export function listAgentEngines(): AgentEngineMeta[] {
  return AGENT_ENGINE_IDS.map((id) => ENGINES[id]);
}

export function getAgentEngineMeta(engineId: string | null | undefined): AgentEngineMeta | null {
  if (!isAgentEngineId(engineId)) return null;
  return ENGINES[engineId];
}

export function getAllAgentSecretConnectorIds(): string[] {
  return AGENT_ENGINE_IDS.map((id) => ENGINES[id].defaultSecretConnectorId);
}
