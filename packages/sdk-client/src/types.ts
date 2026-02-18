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
  capabilities: string[];
};

export type ConnectorCatalogItem = {
  id: string;
  displayName: string;
  requiresSecret: boolean;
};

export type MetaConnectorsResponse = {
  connectors: ConnectorCatalogItem[];
};
