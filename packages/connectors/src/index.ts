export type ConnectorId = "jira" | "github" | "slack" | "email" | (string & {});

export type ConnectorSource = "community" | "enterprise";

export type ConnectorDefinition = {
  id: ConnectorId;
  displayName: string;
  requiresSecret: boolean;
};

export type ConnectorContract = ConnectorDefinition & {
  source: ConnectorSource;
};

export const defaultConnectors: ConnectorDefinition[] = [
  { id: "jira", displayName: "Jira", requiresSecret: true },
  { id: "github", displayName: "GitHub", requiresSecret: true },
  { id: "slack", displayName: "Slack", requiresSecret: true },
  { id: "email", displayName: "Email", requiresSecret: false },
];

export const communityConnectors: ConnectorContract[] = defaultConnectors.map((connector) => ({
  ...connector,
  source: "community",
}));

export function createConnectorCatalog(input?: {
  enterpriseConnectors?: ReadonlyArray<ConnectorDefinition | ConnectorContract>;
}): ConnectorContract[] {
  const merged: ConnectorContract[] = [...communityConnectors];
  for (const connector of input?.enterpriseConnectors ?? []) {
    merged.push({
      id: connector.id,
      displayName: connector.displayName,
      requiresSecret: connector.requiresSecret,
      source: "enterprise",
    });
  }

  const deduped = new Map<string, ConnectorContract>();
  for (const connector of merged) {
    deduped.set(connector.id, connector);
  }

  return [...deduped.values()];
}
