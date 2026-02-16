import { getCommunityConnectorAction } from "@vespid/connectors";
import { z } from "zod";
import type { AgentToolDefinition, AgentToolExecuteResult } from "./types.js";

const connectorToolArgsSchema = z.object({
  connectorId: z.string().min(1),
  actionId: z.string().min(1),
  input: z.unknown().optional(),
  auth: z
    .object({
      secretId: z.string().uuid(),
    })
    .optional(),
  selector: z
    .object({
      tag: z.string().min(1).max(64).optional(),
      agentId: z.string().uuid().optional(),
      group: z.string().min(1).max(64).optional(),
    })
    .optional(),
});

export const connectorActionTool: AgentToolDefinition = {
  id: "connector.action",
  description: "Execute a connector action (cloud) or dispatch to an executor (remote).",
  inputSchema: connectorToolArgsSchema,
  async execute(ctx, input): Promise<AgentToolExecuteResult> {
    const parsed = connectorToolArgsSchema.safeParse(input.args);
    if (!parsed.success) {
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }

    const action = getCommunityConnectorAction({ connectorId: parsed.data.connectorId as any, actionId: parsed.data.actionId });
    if (!action) {
      return { status: "failed", error: `ACTION_NOT_SUPPORTED:${parsed.data.connectorId}:${parsed.data.actionId}` };
    }

    const actionInputParsed = action.inputSchema.safeParse(parsed.data.input);
    if (!actionInputParsed.success) {
      return { status: "failed", error: "INVALID_ACTION_INPUT" };
    }

    const secretId =
      parsed.data.auth?.secretId ??
      ctx.toolAuthDefaults?.connectors?.[parsed.data.connectorId]?.secretId ??
      null;

    if (action.requiresSecret && (!secretId || secretId.trim().length === 0)) {
      return { status: "failed", error: "SECRET_REQUIRED" };
    }

    const secret =
      action.requiresSecret && secretId
        ? await ctx.loadSecretValue({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            secretId,
          })
        : null;

    if (input.mode === "executor") {
      const selector = parsed.data.selector;
      return {
        status: "blocked",
        block: {
          kind: "connector.action",
          payload: {
            connectorId: parsed.data.connectorId,
            actionId: parsed.data.actionId,
            input: actionInputParsed.data,
            env: { githubApiBaseUrl: ctx.githubApiBaseUrl },
          },
          ...(selector?.tag ? { selectorTag: selector.tag } : {}),
          ...(selector?.agentId ? { selectorAgentId: selector.agentId } : {}),
          ...(selector?.group ? { selectorGroup: selector.group } : {}),
          ...(secret ? { secret } : {}),
        },
      };
    }

    return await action.execute({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      connectorId: parsed.data.connectorId as any,
      actionId: parsed.data.actionId,
      input: actionInputParsed.data,
      secret: action.requiresSecret ? secret : null,
      env: { githubApiBaseUrl: ctx.githubApiBaseUrl },
      fetchImpl: ctx.fetchImpl,
    });
  },
};

export function parseConnectorToolId(toolId: string): { connectorId: string; actionId: string } | null {
  // toolId format:
  // - connector.<connectorId>.<actionId...>
  // Example: connector.github.issue.create -> connectorId=github, actionId=issue.create
  if (!toolId.startsWith("connector.")) {
    return null;
  }
  const parts = toolId.split(".");
  if (parts.length < 3) {
    return null;
  }
  const connectorId = parts[1];
  const actionId = parts.slice(2).join(".");
  if (!connectorId || !actionId) {
    return null;
  }
  return { connectorId, actionId };
}
