import type { WorkflowNodeExecutor } from "@vespid/shared";
import { getCommunityConnectorAction } from "@vespid/connectors";
import { z } from "zod";

const connectorActionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("connector.action"),
  config: z.object({
    connectorId: z.string().min(1),
    actionId: z.string().min(1),
    input: z.unknown().optional(),
    auth: z.object({
      secretId: z.string().uuid(),
    }),
    execution: z
      .object({
        mode: z.enum(["cloud", "executor"]).default("cloud"),
        selector: z
          .object({
            pool: z.enum(["managed", "byon"]).default("managed"),
            labels: z.array(z.string().min(1).max(64)).max(50).optional(),
            tag: z.string().min(1).max(64).optional(),
            group: z.string().min(1).max(64).optional(),
            executorId: z.string().uuid().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export function createConnectorActionExecutor(input: {
  getGithubApiBaseUrl: () => string;
  loadConnectorSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    nodeType: "connector.action",
    async execute(context) {
      const nodeParsed = connectorActionNodeSchema.safeParse(context.node);
      if (!nodeParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const { connectorId, actionId } = nodeParsed.data.config;
      const githubApiBaseUrl = input.getGithubApiBaseUrl();

      const action = getCommunityConnectorAction({ connectorId, actionId });
      if (!action) {
        return { status: "failed", error: `ACTION_NOT_SUPPORTED:${connectorId}:${actionId}` };
      }

      const actionInputParsed = action.inputSchema.safeParse(nodeParsed.data.config.input);
      if (!actionInputParsed.success) {
        return { status: "failed", error: "INVALID_ACTION_INPUT" };
      }

      const executionMode = nodeParsed.data.config.execution?.mode ?? "cloud";
      if (executionMode === "executor") {
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

        const secret = action.requiresSecret
          ? await input.loadConnectorSecretValue({
              organizationId: context.organizationId,
              userId: context.requestedByUserId,
              secretId: nodeParsed.data.config.auth.secretId,
            })
          : null;

        const selector = nodeParsed.data.config.execution?.selector;
        return {
          status: "blocked",
          block: {
            kind: "connector.action",
            payload: {
              connectorId,
              actionId,
              input: actionInputParsed.data,
              env: {
                githubApiBaseUrl,
              },
            },
            ...(selector ? { executorSelector: selector } : {}),
            ...(secret ? { secret } : {}),
          },
        };
      }

      const secret = action.requiresSecret
        ? await input.loadConnectorSecretValue({
            organizationId: context.organizationId,
            userId: context.requestedByUserId,
            secretId: nodeParsed.data.config.auth.secretId,
          })
        : null;

      return action.execute({
        organizationId: context.organizationId,
        userId: context.requestedByUserId,
        connectorId,
        actionId,
        input: actionInputParsed.data,
        secret,
        env: {
          githubApiBaseUrl,
        },
        fetchImpl,
      });
    },
  };
}
