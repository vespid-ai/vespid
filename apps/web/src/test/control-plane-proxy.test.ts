import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyControlPlaneRequest } from "../lib/server/control-plane-proxy";

describe("proxyControlPlaneRequest", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE = "http://control-plane.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not forward an empty string body for POST requests without payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/proxy/v1/orgs/abc/llm/oauth/chutes/device/start", {
      method: "POST",
      headers: {
        cookie: "vespid_refresh_token=token",
        "x-org-id": "abc",
      },
    });

    const response = await proxyControlPlaneRequest(request, ["v1", "orgs", "abc", "llm", "oauth", "chutes", "device", "start"]);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const init = calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("forwards request body when payload is provided", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = JSON.stringify({ name: "default" });
    const request = new Request("http://localhost/api/proxy/v1/orgs/abc/llm/oauth/chutes/device/start", {
      method: "POST",
      headers: {
        cookie: "vespid_refresh_token=token",
        "content-type": "application/json",
        "x-org-id": "abc",
      },
      body: payload,
    });

    const response = await proxyControlPlaneRequest(request, ["v1", "orgs", "abc", "llm", "oauth", "chutes", "device", "start"]);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const init = calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(payload);
  });
});
