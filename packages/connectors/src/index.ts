export type ConnectorId = "jira" | "github" | "slack" | "email" | "salesforce" | (string & {});

export type ConnectorDefinition = {
  id: ConnectorId;
  displayName: string;
  requiresSecret: boolean;
};

export type ConnectorContract = ConnectorDefinition;

export * from "./actions.js";

export const defaultConnectors: ConnectorDefinition[] = [
  { id: "jira", displayName: "Jira", requiresSecret: true },
  { id: "github", displayName: "GitHub", requiresSecret: true },
  { id: "slack", displayName: "Slack", requiresSecret: true },
  { id: "email", displayName: "Email", requiresSecret: false },
  { id: "salesforce", displayName: "Salesforce", requiresSecret: true },
];

export const platformConnectors: ConnectorContract[] = [...defaultConnectors];

export function createConnectorCatalog(input?: {
  additionalConnectors?: ReadonlyArray<ConnectorDefinition | ConnectorContract>;
}): ConnectorContract[] {
  const merged: ConnectorContract[] = [...platformConnectors];
  for (const connector of input?.additionalConnectors ?? []) {
    merged.push({
      id: connector.id,
      displayName: connector.displayName,
      requiresSecret: connector.requiresSecret,
    });
  }

  const deduped = new Map<string, ConnectorContract>();
  for (const connector of merged) {
    deduped.set(connector.id, connector);
  }

  return [...deduped.values()];
}
