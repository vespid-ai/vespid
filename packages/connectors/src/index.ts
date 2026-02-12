export type ConnectorId = "jira" | "github" | "slack" | "email";

export type ConnectorDefinition = {
  id: ConnectorId;
  displayName: string;
  requiresSecret: boolean;
};

export const defaultConnectors: ConnectorDefinition[] = [
  { id: "jira", displayName: "Jira", requiresSecret: true },
  { id: "github", displayName: "GitHub", requiresSecret: true },
  { id: "slack", displayName: "Slack", requiresSecret: true },
  { id: "email", displayName: "Email", requiresSecret: false },
];
