import type {
  ApiErrorPayload,
  MetaCapabilitiesResponse,
  MetaConnectorsResponse,
  VespidApiResponse,
  VespidClientConfig,
} from "./types.js";

export class VespidClientError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | null;

  constructor(input: { status: number; payload: ApiErrorPayload | null }) {
    super(input.payload?.message ?? `Request failed with status ${input.status}`);
    this.name = "VespidClientError";
    this.status = input.status;
    this.payload = input.payload;
  }
}

export class VespidClient {
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(input: VespidClientConfig) {
    this.baseUrl = input.baseUrl.replace(/\/$/, "");
    this.accessToken = input.accessToken;
    this.headers = input.headers ?? {};
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async getMetaCapabilities(): Promise<VespidApiResponse<MetaCapabilitiesResponse>> {
    return this.request<MetaCapabilitiesResponse>({
      method: "GET",
      path: "/v1/meta/capabilities",
    });
  }

  async getMetaConnectors(): Promise<VespidApiResponse<MetaConnectorsResponse>> {
    return this.request<MetaConnectorsResponse>({
      method: "GET",
      path: "/v1/meta/connectors",
    });
  }

  private async request<T>(input: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<VespidApiResponse<T>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...this.headers,
    };

    if (this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }

    let body: string | undefined;
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }

    const requestInit: RequestInit = {
      method: input.method,
      headers,
    };
    if (body !== undefined) {
      requestInit.body = body;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${input.path}`, requestInit);

    const text = await response.text();
    const json = text.length > 0 ? JSON.parse(text) : null;

    if (!response.ok) {
      const payload = json && typeof json === "object" ? (json as ApiErrorPayload) : null;
      throw new VespidClientError({
        status: response.status,
        payload,
      });
    }

    return {
      data: json as T,
      status: response.status,
      headers: response.headers,
    };
  }
}
