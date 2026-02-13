import { z } from "zod";
import type { ConnectorDefinition, ConnectorId } from "./index.js";

export type ConnectorActionDefinition = {
  connectorId: ConnectorId;
  actionId: string;
  displayName: string;
  requiresSecret: boolean;
  // Action-specific input schema. The workflow DSL stores action input as `unknown`.
  inputSchema: z.ZodTypeAny;
};

export type ConnectorActionExecuteContext<TInput> = {
  organizationId: string;
  userId: string;
  connectorId: ConnectorId;
  actionId: string;
  input: TInput;
  secret: string | null;
  env: {
    githubApiBaseUrl: string;
  };
  fetchImpl: typeof fetch;
};

export type ConnectorActionExecuteResult =
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; error: string; output?: unknown };

export type ConnectorAction<TInput = unknown> = ConnectorActionDefinition & {
  execute(context: ConnectorActionExecuteContext<TInput>): Promise<ConnectorActionExecuteResult> | ConnectorActionExecuteResult;
};

const githubIssueCreateInputSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  title: z.string().min(1).max(256),
  body: z.string().max(200_000).optional(),
});

const githubIssueCreateAction: ConnectorAction<z.infer<typeof githubIssueCreateInputSchema>> = {
  connectorId: "github",
  actionId: "issue.create",
  displayName: "Create Issue",
  requiresSecret: true,
  inputSchema: githubIssueCreateInputSchema,
  async execute(context) {
    if (!context.secret) {
      return { status: "failed", error: "SECRET_REQUIRED" };
    }

    const [owner, repo] = context.input.repo.split("/");
    if (!owner || !repo) {
      return { status: "failed", error: "INVALID_REPO" };
    }

    const url = new URL(`/repos/${owner}/${repo}/issues`, context.env.githubApiBaseUrl);
    const response = await context.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        authorization: `Bearer ${context.secret}`,
        "user-agent": "vespid-worker",
      },
      body: JSON.stringify({
        title: context.input.title,
        body: context.input.body ?? undefined,
      }),
    });

    if (!response.ok) {
      return { status: "failed", error: `GITHUB_REQUEST_FAILED:${response.status}` };
    }

    const payload = (await response.json()) as { number?: unknown; html_url?: unknown; url?: unknown };
    const issueNumber = typeof payload.number === "number" ? payload.number : null;
    const issueUrl =
      typeof payload.html_url === "string" ? payload.html_url : typeof payload.url === "string" ? payload.url : null;

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
  },
};

export function getCommunityConnectorActions(): ConnectorAction[] {
  return [githubIssueCreateAction];
}

export function getCommunityConnectorAction(input: { connectorId: ConnectorId; actionId: string }): ConnectorAction | null {
  return (
    getCommunityConnectorActions().find(
      (action) => action.connectorId === input.connectorId && action.actionId === input.actionId
    ) ?? null
  );
}

export function listCommunityConnectorActionDefinitions(): ConnectorActionDefinition[] {
  return getCommunityConnectorActions().map((action) => ({
    connectorId: action.connectorId,
    actionId: action.actionId,
    displayName: action.displayName,
    requiresSecret: action.requiresSecret,
    inputSchema: action.inputSchema,
  }));
}

export function connectorRequiresSecret(connector: ConnectorDefinition, actions: ConnectorActionDefinition[]): boolean {
  // Connector-level requiresSecret is a coarse UX hint. Actions may be secret-less (future) even if connector needs one.
  if (!connector.requiresSecret) {
    return false;
  }
  return actions.some((action) => action.connectorId === connector.id && action.requiresSecret);
}

