export type VespidClientConfig = {
  baseUrl: string;
  accessToken?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type VespidApiResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
};

export type MetaCapabilitiesResponse = {
  edition: "community" | "enterprise";
  capabilities: string[];
  provider: {
    name: string;
    version: string | null;
  };
};

export type ConnectorCatalogItem = {
  id: string;
  displayName: string;
  requiresSecret: boolean;
  source: "community" | "enterprise";
};

export type MetaConnectorsResponse = {
  connectors: ConnectorCatalogItem[];
};
