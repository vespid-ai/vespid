import { z } from "zod";
import type { WorkflowNodeExecutor } from "@vespid/shared";

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
  }),
});

const githubIssueCreateInputSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  title: z.string().min(1).max(256),
  body: z.string().max(200_000).optional(),
});

export function createConnectorActionExecutor(input: {
  githubApiBaseUrl: string;
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

      if (connectorId === "github" && actionId === "issue.create") {
        const actionInputParsed = githubIssueCreateInputSchema.safeParse(nodeParsed.data.config.input);
        if (!actionInputParsed.success) {
          return { status: "failed", error: "INVALID_ACTION_INPUT" };
        }

        const token = await input.loadConnectorSecretValue({
          organizationId: context.organizationId,
          userId: context.requestedByUserId,
          secretId: nodeParsed.data.config.auth.secretId,
        });

        const [owner, repo] = actionInputParsed.data.repo.split("/");
        if (!owner || !repo) {
          return { status: "failed", error: "INVALID_REPO" };
        }

        const url = new URL(`/repos/${owner}/${repo}/issues`, input.githubApiBaseUrl);
        const response = await fetchImpl(url.toString(), {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "user-agent": "vespid-worker",
          },
          body: JSON.stringify({
            title: actionInputParsed.data.title,
            body: actionInputParsed.data.body ?? undefined,
          }),
        });

        if (!response.ok) {
          return { status: "failed", error: `GITHUB_REQUEST_FAILED:${response.status}` };
        }

        const payload = (await response.json()) as { number?: unknown; html_url?: unknown; url?: unknown };
        const issueNumber = typeof payload.number === "number" ? payload.number : null;
        const issueUrl =
          typeof payload.html_url === "string"
            ? payload.html_url
            : typeof payload.url === "string"
              ? payload.url
              : null;

        if (!issueNumber || !issueUrl) {
          return { status: "failed", error: "GITHUB_RESPONSE_INVALID" };
        }

        return {
          status: "succeeded",
          output: {
            issueNumber,
            url: issueUrl,
          },
        };
      }

      return { status: "failed", error: `ACTION_NOT_SUPPORTED:${connectorId}:${actionId}` };
    },
  };
}

