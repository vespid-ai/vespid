import type { AgentSkillBundle, McpServerConfig } from "./toolsets.js";

export type ToolsetCatalogItem =
  | {
      key: string;
      kind: "mcp";
      name: string;
      description?: string;
      mcp: McpServerConfig;
      requiredEnv?: string[];
    }
  | {
      key: string;
      kind: "skill";
      name: string;
      description?: string;
      skillTemplate: {
        idHint: string;
        optionalDirs?: { scripts?: boolean; references?: boolean; assets?: boolean };
      };
    };

export type ToolsetDraft = {
  name: string;
  description: string;
  visibility: "private" | "org";
  mcpServers: McpServerConfig[];
  agentSkills: AgentSkillBundle[];
};

export type ToolsetBuilderSessionStatus = "ACTIVE" | "FINALIZED" | "ARCHIVED";

export type ToolsetBuilderLlmConfig = {
  provider: "anthropic" | "openai";
  model: string;
  auth: { secretId: string };
};

