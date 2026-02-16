import { connectorActionTool, parseConnectorToolId } from "./connector-tool.js";
import { shellRunTool } from "./shell-tool.js";
import { teamDelegateTool, teamMapTool } from "./team-tools.js";
import type { AgentToolDefinition } from "./types.js";

const toolRegistry: AgentToolDefinition[] = [connectorActionTool, shellRunTool, teamDelegateTool, teamMapTool];

export function resolveAgentTool(toolId: string): { tool: AgentToolDefinition; args: Record<string, unknown> } | null {
  // Tool aliases:
  // - connector.<connectorId>.<actionId...> -> connector.action with expanded args.
  // - shell.run -> shell.run
  if (toolId === "shell.run") {
    return { tool: shellRunTool, args: {} as Record<string, unknown> };
  }

  const connector = parseConnectorToolId(toolId);
  if (connector) {
    return {
      tool: connectorActionTool,
      args: {
        connectorId: connector.connectorId,
        actionId: connector.actionId,
      } as Record<string, unknown>,
    };
  }

  const direct = toolRegistry.find((tool) => tool.id === toolId) ?? null;
  return direct ? { tool: direct, args: {} as Record<string, unknown> } : null;
}
