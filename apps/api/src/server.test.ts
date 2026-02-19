import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { MemoryAppStore } from "./store/memory-store.js";
import type { OAuthService, OAuthProvider } from "./oauth.js";
import type { WorkflowRunQueueProducer } from "./queue/producer.js";
import type { WorkflowRunJobPayload } from "@vespid/shared";

function extractCookies(input: { headers: Record<string, unknown> }, names: string[]): string {
  const setCookieHeader = input.headers["set-cookie"];
  const lines = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];

  const cookies: string[] = [];
  for (const name of names) {
    const found = lines.find((line) => line.startsWith(`${name}=`));
    if (!found) {
      continue;
    }
    const [cookiePart] = found.split(";");
    if (cookiePart) {
      cookies.push(cookiePart);
    }
  }
  return cookies.join("; ");
}

function bearerToken(input: { session: { token: string } }): string {
  return input.session.token;
}

function fakeOAuthService(): OAuthService {
  return {
    createAuthorizationUrl(provider: OAuthProvider, context) {
      const url = new URL(`https://oauth.local/${provider}/authorize`);
      url.searchParams.set("state", context.state);
      return url;
    },
    async exchangeCodeForProfile(provider: OAuthProvider, context) {
      if (context.code === "bad-code") {
        throw new Error("OAUTH_EXCHANGE_FAILED");
      }
      return {
        email: `${provider}-${context.code}@example.com`,
        displayName: `${provider}-user`,
      };
    },
  };
}

type FakeQueueProducer = WorkflowRunQueueProducer & {
  enqueued: WorkflowRunJobPayload[];
  setFailure(error: Error | null): void;
};

function createFakeQueueProducer(): FakeQueueProducer {
  const enqueued: WorkflowRunJobPayload[] = [];
  let failure: Error | null = null;
  return {
    enqueued,
    setFailure(error) {
      failure = error;
    },
    async enqueueWorkflowRun(input) {
      if (failure) {
        throw failure;
      }
      enqueued.push(input.payload);
    },
    async close() {
      return;
    },
  };
}

function createPaidMemoryStore(): MemoryAppStore {
  return new MemoryAppStore();
}

describe("api hardening foundation", () => {
  const store = createPaidMemoryStore();
  const queueProducer = createFakeQueueProducer();
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      orgContextEnforcement: "strict",
      queueProducer,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("supports signup/login and rejects invalid password", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "owner@example.com",
        password: "Password123",
      },
    });

    expect(signup.statusCode).toBe(201);
    const signupBody = signup.json() as { session: { token: string } };
    expect(signupBody.session.token.length).toBeGreaterThan(10);

    const loginBad = await server.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "wrong-password",
      },
    });
    expect(loginBad.statusCode).toBe(401);

    const login = await server.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "Password123",
      },
    });
    expect(login.statusCode).toBe(200);
  });

  it("runs OAuth start/callback and keeps OAuth failure reason codes", async () => {
    const start = await server.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/start?mode=json",
    });

    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const callbackState = new URL(startBody.authorizationUrl).searchParams.get("state");
    expect(callbackState).toBeTruthy();

    const oauthCookies = extractCookies(start, ["vespid_oauth_state", "vespid_oauth_nonce"]);

    const invalid = await server.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?mode=json&code=ok&state=invalid`,
      headers: {
        cookie: oauthCookies,
      },
    });

    expect(invalid.statusCode).toBe(401);
    expect((invalid.json() as { code: string }).code).toBe("UNAUTHORIZED");

    const invalidNonce = await server.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?mode=json&code=ok&state=${callbackState}`,
      headers: {
        cookie: oauthCookies.replace(/vespid_oauth_nonce=[^;]+/, "vespid_oauth_nonce=tampered"),
      },
    });

    expect(invalidNonce.statusCode).toBe(401);
    expect((invalidNonce.json() as { code: string }).code).toBe("UNAUTHORIZED");

    const valid = await server.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?mode=json&code=ok&state=${callbackState}`,
      headers: {
        cookie: oauthCookies,
      },
    });

    expect(valid.statusCode).toBe(200);
    const validBody = valid.json() as { session: { token: string }; user: { email: string } };
    expect(validBody.session.token.length).toBeGreaterThan(10);
    expect(validBody.user.email).toContain("google-ok@");

    const startBadCode = await server.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/start?mode=json",
    });
    const badCodeState = new URL((startBadCode.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state");
    const badCodeCookies = extractCookies(startBadCode, ["vespid_oauth_state", "vespid_oauth_nonce"]);

    const exchangeFailed = await server.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?mode=json&code=bad-code&state=${badCodeState}`,
      headers: {
        cookie: badCodeCookies,
      },
    });

    expect(exchangeFailed.statusCode).toBe(401);
    expect((exchangeFailed.json() as { code: string }).code).toBe("OAUTH_EXCHANGE_FAILED");
  });

  it("exposes platform capabilities and connector catalog metadata", async () => {
    const capabilities = await server.inject({
      method: "GET",
      url: "/v1/meta/capabilities",
    });
    expect(capabilities.statusCode).toBe(200);
    const capabilitiesBody = capabilities.json() as { capabilities: string[] };
    expect(capabilitiesBody.capabilities).toContain("workflow_dsl_v2");
    expect(capabilitiesBody.capabilities).toContain("advanced_rbac");

    const connectors = await server.inject({
      method: "GET",
      url: "/v1/meta/connectors",
    });
    expect(connectors.statusCode).toBe(200);
    const connectorsBody = connectors.json() as {
      connectors: Array<{ id: string }>;
    };
    expect(connectorsBody.connectors.some((connector) => connector.id === "jira")).toBe(true);
    expect(connectorsBody.connectors.some((connector) => connector.id === "salesforce")).toBe(true);
  });

  it("exposes channel catalog metadata", async () => {
    const channels = await server.inject({
      method: "GET",
      url: "/v1/meta/channels",
    });
    expect(channels.statusCode).toBe(200);
    const body = channels.json() as {
      channels: Array<{ id: string; label: string; category: string }>;
    };
    expect(body.channels.some((channel) => channel.id === "telegram")).toBe(true);
    expect(body.channels.some((channel) => channel.id === "webchat")).toBe(true);
  });

  it("returns default agent installer metadata when custom metadata is disabled", async () => {
    const disabledServer = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
      agentInstaller: { enabled: false },
    });

    const response = await disabledServer.inject({
      method: "GET",
      url: "/v1/meta/agent-installer",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      provider: string;
      delivery: string;
      fallbackReason: string | null;
      packageName: string;
      distTag: string;
      registryUrl: string;
      docsUrl: string | null;
      commands: { connect: string; start: string };
    };
    expect(body.provider).toBe("npm-registry");
    expect(body.delivery).toBe("npm");
    expect(body.fallbackReason).toBeNull();
    expect(body.packageName).toBe("@vespid/node-agent");
    expect(body.distTag).toBe("latest");
    expect(body.registryUrl).toBe("https://registry.npmjs.org");
    expect(body.docsUrl).toBeNull();
    expect(body.commands.connect).toContain('npx -y @vespid/node-agent@latest connect');
    expect(body.commands.connect).toContain('--pairing-token "<pairing-token>"');
    expect(body.commands.connect).toContain('--api-base "http://127.0.0.1:3001"');
    expect(body.commands.start).toBe("npx -y @vespid/node-agent@latest start");
    await disabledServer.close();
  });

  it("returns stable agent installer metadata when enabled", async () => {
    const enabledServer = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
      agentInstaller: {
        enabled: true,
        npmPackage: "@vespid/node-agent",
        npmDistTag: "v0.4.0",
        npmRegistryUrl: "https://registry.npmjs.org",
        docsUrl: "https://docs.vespid.ai/agent",
      },
    });

    const response = await enabledServer.inject({
      method: "GET",
      url: "/v1/meta/agent-installer",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      provider: string;
      delivery: string;
      fallbackReason: string | null;
      packageName: string;
      distTag: string;
      registryUrl: string;
      docsUrl: string | null;
      commands: { connect: string; start: string };
    };
    expect(body.provider).toBe("npm-registry");
    expect(body.delivery).toBe("npm");
    expect(body.fallbackReason).toBeNull();
    expect(body.packageName).toBe("@vespid/node-agent");
    expect(body.distTag).toBe("v0.4.0");
    expect(body.registryUrl).toBe("https://registry.npmjs.org");
    expect(body.docsUrl).toBe("https://docs.vespid.ai/agent");
    expect(body.commands.connect).toBe(
      'npx -y @vespid/node-agent@v0.4.0 connect --pairing-token "<pairing-token>" --api-base "http://127.0.0.1:3001"'
    );
    expect(body.commands.start).toBe("npx -y @vespid/node-agent@v0.4.0 start");
    await enabledServer.close();
  });

  it("returns local-dev installer commands when command mode is forced", async () => {
    const enabledServer = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
      agentInstaller: {
        enabled: true,
        commandMode: "local-dev",
      },
    });

    const response = await enabledServer.inject({
      method: "GET",
      url: "/v1/meta/agent-installer",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      delivery: string;
      fallbackReason: string | null;
      commands: { connect: string; start: string };
    };
    expect(body.delivery).toBe("local-dev");
    expect(body.fallbackReason).toBe("forced_local_dev");
    expect(body.commands.connect).toContain("pnpm --filter @vespid/node-agent dev -- connect");
    expect(body.commands.start).toBe("pnpm --filter @vespid/node-agent dev -- start");
    await enabledServer.close();
  });

  it("accepts codex/claude/opencode engines and rejects legacy loop engine", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `session-engine-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as { session: { token: string } });

    const createOrg = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Session Engine Org", slug: `session-engine-org-${Date.now()}` },
    });
    expect(createOrg.statusCode).toBe(201);
    const orgId = (createOrg.json() as { organization: { id: string } }).organization.id;

    for (const engineId of ["gateway.codex.v2", "gateway.claude.v2", "gateway.opencode.v2"] as const) {
      const createSession = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/sessions`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-org-id": orgId,
        },
        payload: {
          engine: { id: engineId, model: "test-model" },
          executorSelector: { pool: "byon" },
          prompt: { instructions: "test" },
          tools: { allow: [] },
        },
      });
      expect(createSession.statusCode).toBe(201);
    }

    const legacyEngine = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-org-id": orgId,
      },
      payload: {
        engine: { id: "gateway.loop.v2", model: "legacy" },
        executorSelector: { pool: "byon" },
        prompt: { instructions: "test" },
        tools: { allow: [] },
      },
    });
    expect(legacyEngine.statusCode).toBe(400);
    expect((legacyEngine.json() as { message: string }).message).toBe("Invalid session payload");
  });

  it("creates a fresh main chat session each time instead of reusing prior history", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `fresh-main-session-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as { session: { token: string } });

    const createOrg = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Fresh Main Session Org", slug: `fresh-main-session-org-${Date.now()}` },
    });
    expect(createOrg.statusCode).toBe(201);
    const orgId = (createOrg.json() as { organization: { id: string } }).organization.id;

    const createPayload = {
      scope: "main",
      engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
      executorSelector: { pool: "byon" },
      prompt: { instructions: "test" },
      tools: { allow: [] },
    };

    const first = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-org-id": orgId,
      },
      payload: createPayload,
    });
    expect(first.statusCode).toBe(201);
    const firstSession = (first.json() as { session: { id: string; sessionKey: string } }).session;

    const second = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-org-id": orgId,
      },
      payload: createPayload,
    });
    expect(second.statusCode).toBe(201);
    const secondSession = (second.json() as { session: { id: string; sessionKey: string } }).session;

    expect(secondSession.id).not.toBe(firstSession.id);
    expect(secondSession.sessionKey).not.toBe(firstSession.sessionKey);
  });

  it("requires service token for internal channel trigger endpoint", async () => {
    const trigger = await server.inject({
      method: "POST",
      url: "/internal/v1/channels/trigger-run",
      payload: {
        organizationId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
        requestedByUserId: crypto.randomUUID(),
        payload: {},
      },
    });

    expect(trigger.statusCode).toBe(401);
    expect((trigger.json() as { code: string }).code).toBe("UNAUTHORIZED");
  });

  it("returns 503 and rolls back queued run for internal channel trigger when queue is unavailable", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `internal-channel-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerBody = ownerSignup.json() as { session: { token: string }; user: { id: string } };
    const ownerToken = bearerToken(ownerBody);

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Internal Channel Trigger Org",
        slug: `internal-channel-trigger-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Internal Channel Trigger Workflow",
        dsl: {
          version: "v2",
          trigger: {
            type: "trigger.channel",
            config: {
              channelId: "telegram",
              event: "message.received",
            },
          },
          nodes: [{ id: "node-http", type: "http.request" }],
        },
      },
    });
    expect(createWorkflow.statusCode).toBe(201);
    const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

    const publishWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishWorkflow.statusCode).toBe(200);

    const sizeBefore = ((store as unknown as { workflowRuns: Map<string, unknown> }).workflowRuns).size;
    queueProducer.setFailure(new Error("REDIS_DOWN"));

    const trigger = await server.inject({
      method: "POST",
      url: "/internal/v1/channels/trigger-run",
      headers: {
        "x-service-token": "dev-gateway-token",
      },
      payload: {
        organizationId: orgId,
        workflowId,
        requestedByUserId: ownerBody.user.id,
        payload: {
          channelId: "telegram",
          text: "hello",
        },
      },
    });
    expect(trigger.statusCode).toBe(503);
    expect((trigger.json() as { code: string }).code).toBe("QUEUE_UNAVAILABLE");

    const sizeAfter = ((store as unknown as { workflowRuns: Map<string, unknown> }).workflowRuns).size;
    expect(sizeAfter).toBe(sizeBefore);
    queueProducer.setFailure(null);
  });

  it("manages channel allowlist entries in org scope", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `allowlist-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Allowlist Org",
        slug: `allowlist-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createAccount = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/channels/accounts`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        channelId: "telegram",
        accountKey: "allowlist-main",
        displayName: "Allowlist Main",
      },
    });
    expect(createAccount.statusCode).toBe(201);
    const accountId = (createAccount.json() as { account: { id: string } }).account.id;

    const putEntry = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        scope: "sender",
        subject: "user-1",
      },
    });
    expect(putEntry.statusCode).toBe(201);

    const listEntries = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listEntries.statusCode).toBe(200);
    const listed = listEntries.json() as { entries: Array<{ scope: string; subject: string }> };
    expect(listed.entries.some((entry) => entry.scope === "sender" && entry.subject === "user-1")).toBe(true);

    const deleteEntry = await server.inject({
      method: "DELETE",
      url: `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        scope: "sender",
        subject: "user-1",
      },
    });
    expect(deleteEntry.statusCode).toBe(200);

    const listAfterDelete = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listAfterDelete.statusCode).toBe(200);
    const after = listAfterDelete.json() as { entries: Array<{ scope: string; subject: string }> };
    expect(after.entries.some((entry) => entry.scope === "sender" && entry.subject === "user-1")).toBe(false);
  });

  it("proxies channel test-send to gateway internal endpoint", async () => {
    const priorFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            delivered: true,
            status: "accepted",
            attemptCount: 1,
            providerMessageId: "session:channel-test:1",
            error: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as any;

    try {
      const ownerSignup = await server.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: {
          email: `test-send-owner-${Date.now()}@example.com`,
          password: "Password123",
        },
      });
      expect(ownerSignup.statusCode).toBe(201);
      const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

      const orgRes = await server.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          name: "Test Send Org",
          slug: `test-send-org-${Date.now()}`,
        },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

      const createAccount = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/channels/accounts`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
        payload: {
          channelId: "telegram",
          accountKey: "main",
          displayName: "Telegram Main",
          webhookUrl: "https://channel.example/outbound",
        },
      });
      expect(createAccount.statusCode).toBe(201);
      const account = (createAccount.json() as { account: { id: string; channelId: string; accountKey: string } }).account;

      const sendRes = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/channels/accounts/${account.id}/test-send`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "x-org-id": orgId,
        },
        payload: {
          conversationId: "dm:user-1",
          text: "health check",
        },
      });
      expect(sendRes.statusCode).toBe(200);
      const sendBody = sendRes.json() as {
        ok: boolean;
        result: { delivered: boolean; status: string; attemptCount: number; providerMessageId: string; error: string | null };
      };
      expect(sendBody.ok).toBe(true);
      expect(sendBody.result.delivered).toBe(true);
      expect(sendBody.result.status).toBe("accepted");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [url, init] = firstCall as unknown as [string | URL, RequestInit | undefined];
      const requestUrl = typeof url === "string" ? url : url.toString();
      const requestInit = (init ?? {}) as RequestInit & { headers?: Record<string, string>; body?: string };
      expect(requestUrl).toContain("/internal/v1/channels/test-send");
      expect(requestInit.method).toBe("POST");
      expect(requestInit.headers?.["x-gateway-token"]).toBe("dev-gateway-token");
      const forwarded = JSON.parse(requestInit.body ?? "{}") as {
        organizationId: string;
        channelId: string;
        accountId: string;
        accountKey: string;
        conversationId: string;
        text: string;
      };
      expect(forwarded.organizationId).toBe(orgId);
      expect(forwarded.channelId).toBe("telegram");
      expect(forwarded.accountId).toBe(account.id);
      expect(forwarded.accountKey).toBe(account.accountKey);
      expect(forwarded.conversationId).toBe("dm:user-1");
      expect(forwarded.text).toBe("health check");
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  it("supports cookie refresh and revocable sessions", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "session-owner@example.com",
        password: "Password123",
      },
    });

    const signupBody = signup.json() as { session: { token: string } };
    const cookie = extractCookies(signup, ["vespid_session"]);

    const orgByCookie = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        cookie,
      },
      payload: {
        name: "Cookie Org",
        slug: `cookie-org-${Date.now()}`,
      },
    });

    expect(orgByCookie.statusCode).toBe(201);
    expect(typeof orgByCookie.headers["x-access-token"]).toBe("string");

    const refresh = await server.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: {
        cookie,
      },
    });

    expect(refresh.statusCode).toBe(200);

    const logout = await server.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        authorization: `Bearer ${bearerToken(signupBody)}`,
      },
    });

    expect(logout.statusCode).toBe(200);

    const denied = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${bearerToken(signupBody)}`,
      },
      payload: {
        name: "Denied Org",
        slug: `denied-org-${Date.now()}`,
      },
    });

    expect(denied.statusCode).toBe(401);
  });

  it("supports agent pairing tokens and agent lifecycle APIs", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `agent-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = bearerToken(signup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Agent Org",
        slug: `agent-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const pairing = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/pairing-tokens`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(pairing.statusCode).toBe(201);
    const pairingBody = pairing.json() as { token: string; expiresAt: string };
    expect(pairingBody.token).toContain(`${orgId}.`);

    const pairAgent = await server.inject({
      method: "POST",
      url: "/v1/executors/pair",
      payload: {
        pairingToken: pairingBody.token,
        name: "test-executor",
        agentVersion: "0.0.0-test",
        capabilities: { kinds: ["connector.action", "agent.execute"] },
      },
    });
    expect(pairAgent.statusCode).toBe(201);
    const pairAgentBody = pairAgent.json() as {
      executorId: string;
      executorToken: string;
      organizationId: string;
      gatewayWsUrl: string;
    };
    expect(pairAgentBody.organizationId).toBe(orgId);
    expect(pairAgentBody.executorToken).toContain(`${orgId}.`);
    expect(pairAgentBody.gatewayWsUrl.length).toBeGreaterThan(5);

    const listAgents = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/agents`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listAgents.statusCode).toBe(200);
    const listBody = listAgents.json() as { executors: Array<{ id: string; status: string }> };
    expect(listBody.executors.some((executor) => executor.id === pairAgentBody.executorId)).toBe(true);

    const deleteOnline = await server.inject({
      method: "DELETE",
      url: `/v1/orgs/${orgId}/agents/${pairAgentBody.executorId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(deleteOnline.statusCode).toBe(409);
    expect((deleteOnline.json() as { message?: string }).message).toContain("Only revoked worker nodes can be deleted");

    const revoke = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/agents/${pairAgentBody.executorId}/revoke`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ ok: true });

    const deleteRevoked = await server.inject({
      method: "DELETE",
      url: `/v1/orgs/${orgId}/agents/${pairAgentBody.executorId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(deleteRevoked.statusCode).toBe(200);
    expect(deleteRevoked.json()).toEqual({ ok: true });

    const listAfterDelete = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/agents`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listAfterDelete.statusCode).toBe(200);
    const listAfterDeleteBody = listAfterDelete.json() as { executors: Array<{ id: string; status: string }> };
    expect(listAfterDeleteBody.executors.some((executor) => executor.id === pairAgentBody.executorId)).toBe(false);

    const pairingReuse = await server.inject({
      method: "POST",
      url: "/v1/executors/pair",
      payload: {
        pairingToken: pairingBody.token,
        name: "reuse-executor",
        agentVersion: "0.0.0-test",
        capabilities: { kinds: ["connector.action", "agent.execute"] },
      },
    });
    expect(pairingReuse.statusCode).toBe(401);
    expect((pairingReuse.json() as { code?: string }).code).toBe("PAIRING_TOKEN_INVALID");
  });

  it("supports toolsets library + public gallery + adopt flow", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `toolset-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = bearerToken(signup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Toolset Org",
        slug: `toolset-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const badPlaceholder = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Bad MCP",
        visibility: "private",
        mcpServers: [{ name: "m1", transport: "http", url: "https://example.com", headers: { Authorization: "plain-token" } }],
        agentSkills: [],
      },
    });
    expect(badPlaceholder.statusCode).toBe(400);
    expect((badPlaceholder.json() as any).code).toBe("INVALID_MCP_PLACEHOLDER");

    const badSkill = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Bad Skill",
        visibility: "private",
        mcpServers: [],
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "s1",
            name: "Skill 1",
            entry: "SKILL.md",
            files: [{ path: "README.md", content: "x" }],
          },
        ],
      },
    });
    expect(badSkill.statusCode).toBe(400);
    expect((badSkill.json() as any).code).toBe("INVALID_SKILL_BUNDLE");

    const create = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "My Toolset",
        description: "Test toolset",
        visibility: "org",
        mcpServers: [
          {
            name: "mcp-a",
            transport: "stdio",
            command: "echo",
            args: ["hello"],
            env: { TOKEN: "${ENV:TEST_TOKEN}" },
          },
        ],
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "hello-skill",
            name: "Hello Skill",
            entry: "SKILL.md",
            files: [{ path: "SKILL.md", content: "# Hello\\n" }],
          },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const toolsetId = (create.json() as any).toolset.id as string;

    const list = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(list.statusCode).toBe(200);
    expect(((list.json() as any).toolsets as any[]).some((t) => t.id === toolsetId)).toBe(true);

    const get = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/toolsets/${toolsetId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as any).toolset.id).toBe(toolsetId);

    const publish = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets/${toolsetId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: { publicSlug: `my-toolset-${Date.now()}` },
    });
    expect(publish.statusCode).toBe(200);
    const publicSlug = (publish.json() as any).toolset.publicSlug as string;
    expect(typeof publicSlug).toBe("string");

    const create2 = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "My Toolset 2",
        visibility: "private",
        mcpServers: [],
        agentSkills: [],
      },
    });
    expect(create2.statusCode).toBe(201);
    const toolsetId2 = (create2.json() as any).toolset.id as string;

    const publishConflict = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolsets/${toolsetId2}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: { publicSlug },
    });
    expect(publishConflict.statusCode).toBe(409);
    expect((publishConflict.json() as any).code).toBe("PUBLIC_SLUG_CONFLICT");

    const gallery = await server.inject({
      method: "GET",
      url: "/v1/toolset-gallery",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(gallery.statusCode).toBe(200);
    expect(((gallery.json() as any).items as any[]).some((it) => it.publicSlug === publicSlug)).toBe(true);

    const galleryGet = await server.inject({
      method: "GET",
      url: `/v1/toolset-gallery/${publicSlug}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(galleryGet.statusCode).toBe(200);
    expect((galleryGet.json() as any).toolset.publicSlug).toBe(publicSlug);

    const adopt = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/toolset-gallery/${publicSlug}/adopt`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: { name: "Adopted Toolset" },
    });
    expect(adopt.statusCode).toBe(201);
    expect((adopt.json() as any).toolset.name).toBe("Adopted Toolset");
  });

  it("supports toolsets AI builder sessions and draft generation", async () => {
    const priorFetch = globalThis.fetch;
    const priorKek = process.env.SECRETS_KEK_BASE64;
    const priorKekId = process.env.SECRETS_KEK_ID;
    process.env.SECRETS_KEK_ID = "test-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");

    try {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch as any;

      const assistant1 = { message: "Pick GitHub + a usage guide skill.", suggestedComponentKeys: ["mcp.github", "skill.usage-guide"] };
      const assistant2 = { message: "Consider adding Slack too.", suggestedComponentKeys: ["mcp.slack"] };
      const finalize = {
        name: "Generated Toolset",
        description: "Generated by AI Builder",
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "toolset-usage-guide",
            name: "Toolset Usage Guide",
            entry: "SKILL.md",
            files: [{ path: "SKILL.md", content: "# Usage\\n\\nUse MCP tools safely." }],
          },
        ],
      };

      const mockAnthropic = (payload: any) => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify(payload) }],
          }),
      });

      mockFetch
        .mockResolvedValueOnce(mockAnthropic(assistant1))
        .mockResolvedValueOnce(mockAnthropic(assistant2))
        .mockResolvedValueOnce(mockAnthropic(finalize));

      const signup = await server.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: {
          email: `toolset-ai-owner-${Date.now()}@example.com`,
          password: "Password123",
        },
      });
      expect(signup.statusCode).toBe(201);
      const ownerToken = bearerToken(signup.json() as { session: { token: string } });

      const orgRes = await server.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Toolset AI Org", slug: `toolset-ai-org-${Date.now()}` },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as any).organization.id as string;

      const secretRes = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "llm.anthropic", name: "anthropic", value: "sk-ant-test" },
      });
      expect(secretRes.statusCode).toBe(201);
      const secretId = (secretRes.json() as any).secret.id as string;

      const createSession = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/toolsets/builder/sessions`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          intent: "I want to triage GitHub issues and share summaries.",
          llm: { provider: "anthropic", model: "claude-3-5-sonnet-latest", auth: { secretId } },
        },
      });
      expect(createSession.statusCode).toBe(200);
      const sessionId = (createSession.json() as any).sessionId as string;
      expect(typeof sessionId).toBe("string");

      const chat = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/toolsets/builder/sessions/${sessionId}/chat`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { message: "We also need Slack for notifications.", selectedComponentKeys: ["mcp.github", "skill.usage-guide"] },
      });
      expect(chat.statusCode).toBe(200);
      const selected = (chat.json() as any).selectedComponentKeys as string[];
      expect(selected.includes("mcp.slack")).toBe(true);

      const finalizeRes = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/toolsets/builder/sessions/${sessionId}/finalize`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { selectedComponentKeys: selected },
      });
      expect(finalizeRes.statusCode).toBe(200);
      const draft = (finalizeRes.json() as any).draft as any;
      expect(draft.name).toBe("Generated Toolset");
      expect(Array.isArray(draft.mcpServers)).toBe(true);
      expect(draft.mcpServers.some((s: any) => s.name === "github")).toBe(true);
      expect(Array.isArray(draft.agentSkills)).toBe(true);
      expect(draft.agentSkills.length).toBe(1);
    } finally {
      globalThis.fetch = priorFetch;
      if (priorKek === undefined) delete process.env.SECRETS_KEK_BASE64;
      else process.env.SECRETS_KEK_BASE64 = priorKek;
      if (priorKekId === undefined) delete process.env.SECRETS_KEK_ID;
      else process.env.SECRETS_KEK_ID = priorKekId;
    }
  });

  it("requires owner|admin role to list toolsets", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `toolset-list-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const memberEmail = `toolset-list-member-${Date.now()}@example.com`;
    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: memberEmail, password: "Password123" },
    });
    expect(memberSignup.statusCode).toBe(201);
    const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Toolsets Org", slug: `toolsets-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as any).organization.id as string;

    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { email: memberEmail, roleKey: "member" },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = (invite.json() as any).invitation.token as string;

    const accept = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(accept.statusCode).toBe(200);

    const listDenied = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/toolsets`,
      headers: { authorization: `Bearer ${memberToken}`, "x-org-id": orgId },
    });
    expect(listDenied.statusCode).toBe(403);
  });

  it("requires X-Org-Id and blocks cross-org access", async () => {
    const owner = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "org-owner@example.com",
        password: "Password123",
      },
    });
    const ownerToken = bearerToken(owner.json() as { session: { token: string } });

    const outsider = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "org-outsider@example.com",
        password: "Password123",
      },
    });
    const outsiderToken = bearerToken(outsider.json() as { session: { token: string } });

    const org = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: "Tenant Org",
        slug: `tenant-org-${Date.now()}`,
      },
    });

    const orgId = (org.json() as { organization: { id: string } }).organization.id;

    const missingHeader = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        email: "member@example.com",
        roleKey: "member",
      },
    });

    expect(missingHeader.statusCode).toBe(400);
    expect((missingHeader.json() as { code: string }).code).toBe("ORG_CONTEXT_REQUIRED");

    const wrongHeader = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": crypto.randomUUID(),
      },
      payload: {
        email: "member@example.com",
        roleKey: "member",
      },
    });

    expect(wrongHeader.statusCode).toBe(400);
    expect((wrongHeader.json() as { code: string }).code).toBe("INVALID_ORG_CONTEXT");

    const crossOrg = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${outsiderToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "member@example.com",
        roleKey: "member",
      },
    });

    expect(crossOrg.statusCode).toBe(403);
    expect((crossOrg.json() as { code: string }).code).toBe("ORG_ACCESS_DENIED");
  });

  it("supports workflow core lifecycle with tenant and role checks", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "workflow-owner@example.com",
        password: "Password123",
      },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "workflow-member@example.com",
        password: "Password123",
      },
    });
    const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });

    const outsiderSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "workflow-outsider@example.com",
        password: "Password123",
      },
    });
    const outsiderToken = bearerToken(outsiderSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Workflow Org",
        slug: `workflow-org-${Date.now()}`,
      },
    });
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const inviteMember = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "workflow-member@example.com",
        roleKey: "member",
      },
    });
    expect(inviteMember.statusCode).toBe(201);
    const inviteToken = (inviteMember.json() as { invitation: { token: string } }).invitation.token;

    const acceptMember = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
    });
    expect(acceptMember.statusCode).toBe(200);

    const createWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Bug triage workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            { id: "node-http", type: "http.request" },
            { id: "node-agent", type: "agent.execute" },
          ],
        },
      },
    });
    expect(createWorkflow.statusCode).toBe(201);
    const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

    const createAgentRunWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Agent-only workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [
            {
              id: "agent-1",
              type: "agent.run",
              config: {
                engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
                execution: { mode: "gateway", selector: { pool: "byon" } },
                prompt: { instructions: "Say hello." },
                tools: { allow: ["connector.github.issue.create"], execution: "cloud" },
                limits: { maxTurns: 1, maxToolCalls: 0, timeoutMs: 1000, maxOutputChars: 1000 },
                output: { mode: "text" },
              },
            },
          ],
        },
      },
    });
    expect(createAgentRunWorkflow.statusCode).toBe(201);

    const outsiderCreateDenied = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${outsiderToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Outsider Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [{ id: "node1", type: "agent.execute" }],
        },
      },
    });
    expect(outsiderCreateDenied.statusCode).toBe(403);

    const runBeforePublish = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
      payload: {},
    });
    expect(runBeforePublish.statusCode).toBe(409);

    const memberPublishDenied = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
    });
    expect(memberPublishDenied.statusCode).toBe(403);

    const publishWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishWorkflow.statusCode).toBe(200);
    expect((publishWorkflow.json() as { workflow: { status: string } }).workflow.status).toBe("published");

    const enqueueCountBefore = queueProducer.enqueued.length;
    const runWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
      payload: {
        input: { issueKey: "ABC-123" },
      },
    });
    expect(runWorkflow.statusCode).toBe(201);
    const runBody = runWorkflow.json() as { run: { id: string; status: string; attemptCount: number } };
    expect(runBody.run.status).toBe("queued");
    expect(runBody.run.attemptCount).toBe(0);
    expect(queueProducer.enqueued.length).toBe(enqueueCountBefore + 1);
    expect(queueProducer.enqueued[queueProducer.enqueued.length - 1]).toEqual(
      expect.objectContaining({
        runId: runBody.run.id,
        organizationId: orgId,
        workflowId,
        requestedByUserId: expect.any(String),
      })
    );

    const getRun = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runBody.run.id}`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
    });
    expect(getRun.statusCode).toBe(200);
    const fetchedRun = (getRun.json() as { run: { id: string; status: string } }).run;
    expect(fetchedRun.id).toBe(runBody.run.id);
    expect(fetchedRun.status).toBe("queued");
  });

  it("returns 503 and rolls back queued run when queue is unavailable", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `queue-down-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Queue Down Org",
        slug: `queue-down-org-${Date.now()}`,
      },
    });
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Queue Down Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [{ id: "node-http", type: "http.request" }],
        },
      },
    });
    const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

    const publishWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishWorkflow.statusCode).toBe(200);

    const sizeBefore = ((store as unknown as { workflowRuns: Map<string, unknown> }).workflowRuns).size;
    queueProducer.setFailure(new Error("REDIS_DOWN"));

    const runWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        input: { issueKey: "QUEUE-DOWN-1" },
      },
    });

    expect(runWorkflow.statusCode).toBe(503);
    expect((runWorkflow.json() as { code: string }).code).toBe("QUEUE_UNAVAILABLE");

    const sizeAfter = ((store as unknown as { workflowRuns: Map<string, unknown> }).workflowRuns).size;
    expect(sizeAfter).toBe(sizeBefore);
    queueProducer.setFailure(null);
  });

  it("supports webhook trigger subscriptions and trigger toggle", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `webhook-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Webhook Org",
        slug: `webhook-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const token = `token-${Date.now()}`;
    const createWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Webhook Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.webhook", config: { token } },
          nodes: [{ id: "node1", type: "agent.execute" }],
        },
      },
    });
    expect(createWorkflow.statusCode).toBe(201);
    const workflowId = (createWorkflow.json() as { workflow: { id: string } }).workflow.id;

    const publishWorkflow = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishWorkflow.statusCode).toBe(200);

    const listTriggers = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/triggers`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listTriggers.statusCode).toBe(200);
    const subscriptions = (listTriggers.json() as { subscriptions: Array<{ id: string; triggerType: string; enabled: boolean }> })
      .subscriptions;
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.triggerType).toBe("webhook");
    expect(subscriptions[0]?.enabled).toBe(true);

    const enqueueCountBefore = queueProducer.enqueued.length;
    const firstTrigger = await server.inject({
      method: "POST",
      url: `/v1/triggers/webhook/${token}`,
      headers: {
        "x-idempotency-key": "same-event-1",
      },
      payload: { issue: "ABC-1" },
    });
    expect(firstTrigger.statusCode).toBe(202);
    expect(queueProducer.enqueued.length).toBe(enqueueCountBefore + 1);

    const duplicateTrigger = await server.inject({
      method: "POST",
      url: `/v1/triggers/webhook/${token}`,
      headers: {
        "x-idempotency-key": "same-event-1",
      },
      payload: { issue: "ABC-1" },
    });
    expect(duplicateTrigger.statusCode).toBe(202);
    expect((duplicateTrigger.json() as { duplicate?: boolean }).duplicate).toBe(true);
    expect(queueProducer.enqueued.length).toBe(enqueueCountBefore + 1);

    const subscriptionId = subscriptions[0]!.id;
    const disableTrigger = await server.inject({
      method: "PATCH",
      url: `/v1/orgs/${orgId}/triggers/${subscriptionId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        enabled: false,
      },
    });
    expect(disableTrigger.statusCode).toBe(200);
    expect((disableTrigger.json() as { subscription: { enabled: boolean } }).subscription.enabled).toBe(false);

    const afterDisable = await server.inject({
      method: "POST",
      url: `/v1/triggers/webhook/${token}`,
      payload: { issue: "ABC-2" },
    });
    expect(afterDisable.statusCode).toBe(404);
  });

  it("approves pending workflow approval requests and resumes blocked runs", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `approval-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });
    const ownerUserId = (ownerSignup.json() as { user: { id: string } }).user.id;

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Approval Org",
        slug: `approval-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const wfRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Approval Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [{ id: "node-1", type: "agent.execute" }],
        },
      },
    });
    expect(wfRes.statusCode).toBe(201);
    const workflowId = (wfRes.json() as { workflow: { id: string } }).workflow.id;

    const publishRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishRes.statusCode).toBe(200);

    const run = await store.createWorkflowRun({
      organizationId: orgId,
      workflowId,
      triggerType: "manual",
      requestedByUserId: ownerUserId,
      input: { issue: "A-1" },
    });

    const approvalId = crypto.randomUUID();
    const workflowRunsMap = (store as unknown as { workflowRuns: Map<string, any> }).workflowRuns;
    const blockedRun = workflowRunsMap.get(run.id)!;
    blockedRun.status = "running";
    blockedRun.attemptCount = 1;
    blockedRun.blockedRequestId = approvalId;
    blockedRun.blockedNodeId = "node-1";
    blockedRun.blockedNodeType = "agent.execute";
    blockedRun.blockedKind = "approval";
    blockedRun.blockedAt = new Date().toISOString();
    blockedRun.blockedTimeoutAt = new Date(Date.now() + 60_000).toISOString();
    workflowRunsMap.set(run.id, blockedRun);

    const approvalsMap = (store as unknown as { workflowApprovalRequests: Map<string, any> }).workflowApprovalRequests;
    approvalsMap.set(approvalId, {
      id: approvalId,
      organizationId: orgId,
      workflowId,
      runId: run.id,
      nodeId: "node-1",
      nodeType: "agent.execute",
      requestKind: "policy",
      status: "pending",
      reason: "shell_run_requires_approval",
      context: {},
      requestedByUserId: ownerUserId,
      decidedByUserId: null,
      decisionNote: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      decidedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const beforeEnqueue = queueProducer.enqueued.length;
    const approveRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/approvals/${approvalId}/approve`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        note: "approved for incident response",
      },
    });
    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json() as { approval: { status: string }; resumed: boolean };
    expect(approveBody.approval.status).toBe("approved");
    expect(approveBody.resumed).toBe(true);
    expect(queueProducer.enqueued.length).toBe(beforeEnqueue + 1);
    expect(queueProducer.enqueued[queueProducer.enqueued.length - 1]).toEqual(
      expect.objectContaining({
        runId: run.id,
        organizationId: orgId,
        workflowId,
      })
    );
  });

  it("lists workflow runs and run events with tenant isolation", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `runs-events-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Runs Events Org",
        slug: `runs-events-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const workflowRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "Runs Events Workflow",
        dsl: {
          version: "v2",
          trigger: { type: "trigger.manual" },
          nodes: [{ id: "n1", type: "agent.execute" }],
        },
      },
    });
    expect(workflowRes.statusCode).toBe(201);
    const workflowId = (workflowRes.json() as { workflow: { id: string } }).workflow.id;

    const publishRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(publishRes.statusCode).toBe(200);

    const runRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {},
    });
    expect(runRes.statusCode).toBe(201);
    const runId = (runRes.json() as { run: { id: string } }).run.id;
    const ownerId = (ownerSignup.json() as { user: { id: string } }).user.id;

    const listRuns = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=10`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listRuns.statusCode).toBe(200);
    const listBody = listRuns.json() as { runs: Array<{ id: string }>; nextCursor: string | null };
    expect(listBody.runs.some((run) => run.id === runId)).toBe(true);

    await store.appendWorkflowRunEvent({
      organizationId: orgId,
      workflowId,
      runId,
      actorUserId: ownerId,
      attemptCount: 0,
      eventType: "run_started",
      level: "info",
      message: "test event",
      payload: { ok: true },
    });

    const listEvents = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=10`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
    });
    expect(listEvents.statusCode).toBe(200);
    const eventsBody = listEvents.json() as { events: Array<{ eventType: string }>; nextCursor: string | null };
    expect(eventsBody.events.length).toBeGreaterThan(0);
    expect(eventsBody.events[0]?.eventType).toBe("run_started");

    const outsiderSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `runs-events-outsider-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    const outsiderToken = bearerToken(outsiderSignup.json() as { session: { token: string } });

    const outsiderDenied = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=10`,
      headers: {
        authorization: `Bearer ${outsiderToken}`,
        "x-org-id": orgId,
      },
    });
    expect(outsiderDenied.statusCode).toBe(403);
    expect((outsiderDenied.json() as { code: string }).code).toBe("ORG_ACCESS_DENIED");
  });

  it("lists workflows and updates drafts (v2/v3) but rejects published edits", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: `wf-edit-owner-${Date.now()}@example.com`,
        password: "Password123",
      },
    });
    expect(ownerSignup.statusCode).toBe(201);
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "WF Edit Org",
        slug: `wf-edit-org-${Date.now()}`,
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Draft A",
        dsl: { version: "v2", trigger: { type: "trigger.manual" }, nodes: [{ id: "n1", type: "agent.execute" }] },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const workflowId = (createRes.json() as { workflow: { id: string } }).workflow.id;

    const listRes = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows?limit=50`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { workflows: Array<{ id: string }>; nextCursor: string | null };
    expect(listBody.workflows.some((wf) => wf.id === workflowId)).toBe(true);

    const updateRes = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Draft A (Renamed)",
        dsl: {
          version: "v3",
          trigger: { type: "trigger.manual" },
          graph: { nodes: { n1: { id: "n1", type: "agent.execute" } }, edges: [] },
        },
        editorState: { nodes: [{ id: "n1", position: { x: 12, y: 34 } }], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = (updateRes.json() as { workflow: { name: string; dsl: any; editorState: any } }).workflow;
    expect(updated.name).toBe("Draft A (Renamed)");
    expect(updated.dsl.version).toBe("v3");
    expect(updated.editorState?.nodes?.[0]?.id).toBe("n1");

    const publishRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(publishRes.statusCode).toBe(200);

    const editPublished = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { name: "should fail" },
    });
    expect(editPublished.statusCode).toBe(409);

    const cloneRes = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/drafts`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(cloneRes.statusCode).toBe(201);
    const clonedWorkflowId = (cloneRes.json() as { workflow: { id: string; status: string } }).workflow.id;

    const revisionsRes = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}/revisions?limit=50`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(revisionsRes.statusCode).toBe(200);
    const revisionsBody = revisionsRes.json() as { workflows: Array<{ id: string; status: string; revision: number }> };
    expect(revisionsBody.workflows.some((wf) => wf.id === workflowId)).toBe(true);
    expect(revisionsBody.workflows.some((wf) => wf.id === clonedWorkflowId)).toBe(true);

    const updateClone = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/workflows/${clonedWorkflowId}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { name: "Draft B (From Published)" },
    });
    expect(updateClone.statusCode).toBe(200);
    expect((updateClone.json() as { workflow: { name: string; status: string } }).workflow.status).toBe("draft");

    const original = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/workflows/${workflowId}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(original.statusCode).toBe(200);
    expect((original.json() as { workflow: { status: string; name: string } }).workflow.status).toBe("published");

    const invalidParallelRemote = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/workflows`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        name: "Invalid v3",
        dsl: {
          version: "v3",
          trigger: { type: "trigger.manual" },
          graph: {
            nodes: {
              root: { id: "root", type: "http.request" },
              a: { id: "a", type: "agent.execute", config: { execution: { mode: "executor" } } },
              b: { id: "b", type: "http.request" },
              join: { id: "join", type: "parallel.join", config: { mode: "all", failFast: true } },
            },
            edges: [
              { id: "e1", from: "root", to: "a" },
              { id: "e2", from: "root", to: "b" },
              { id: "e3", from: "a", to: "join" },
              { id: "e4", from: "b", to: "join" },
            ],
          },
        },
      },
    });
    expect(invalidParallelRemote.statusCode).toBe(400);
    expect((invalidParallelRemote.json() as { code: string }).code).toBe("PARALLEL_REMOTE_NOT_SUPPORTED");
  });

  it("completes invitation accept flow and enforces email match", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "invite-owner@example.com",
        password: "Password123",
      },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Invite Org",
        slug: `invite-org-${Date.now()}`,
      },
    });

    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const inviteOk = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "member-accept@example.com",
        roleKey: "member",
      },
    });

    expect(inviteOk.statusCode).toBe(201);
    const inviteToken = (inviteOk.json() as { invitation: { token: string } }).invitation.token;

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "member-accept@example.com",
        password: "Password123",
      },
    });
    const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });

    const accept = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
    });

    expect(accept.statusCode).toBe(200);
    const acceptBody = accept.json() as { result: { accepted: boolean; organizationId: string } };
    expect(acceptBody.result.accepted).toBe(true);
    expect(acceptBody.result.organizationId).toBe(orgId);

    const inviteMismatch = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "expected-match@example.com",
        roleKey: "member",
      },
    });

    const mismatchToken = (inviteMismatch.json() as { invitation: { token: string } }).invitation.token;

    const wrongUserSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "wrong-user@example.com",
        password: "Password123",
      },
    });
    const wrongUserToken = bearerToken(wrongUserSignup.json() as { session: { token: string } });

    const mismatch = await server.inject({
      method: "POST",
      url: `/v1/invitations/${mismatchToken}/accept`,
      headers: {
        authorization: `Bearer ${wrongUserToken}`,
      },
    });

    expect(mismatch.statusCode).toBe(403);
  });

  it("manages connector secrets (metadata only) and enforces admin-only access", async () => {
    const priorKek = process.env.SECRETS_KEK_BASE64;
    const priorKekId = process.env.SECRETS_KEK_ID;
    process.env.SECRETS_KEK_ID = "test-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");

    try {
      const ownerSignup = await server.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { email: `secrets-owner-${Date.now()}@example.com`, password: "Password123" },
      });
      const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

      const orgRes = await server.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Secrets Org", slug: `secrets-org-${Date.now()}` },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

      const created = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "github", name: "token", value: "ghp_test_token" },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { secret: { id: string; connectorId: string; name: string; value?: unknown } };
      expect(createdBody.secret.connectorId).toBe("github");
      expect(createdBody.secret.name).toBe("token");
      expect("value" in createdBody.secret).toBe(false);

      const llmSecret = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "llm.openai", name: "openai", value: "sk-test" },
      });
      expect(llmSecret.statusCode).toBe(201);
      expect((llmSecret.json() as { secret: { connectorId: string; name: string } }).secret.connectorId).toBe("llm.openai");

      const list = await server.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(list.statusCode).toBe(200);
      const listBody = list.json() as { secrets: Array<{ id: string; connectorId: string; name: string; value?: unknown }> };
      expect(listBody.secrets.length).toBe(2);
      const ids = new Set(listBody.secrets.map((s) => s.id));
      expect(ids.has(createdBody.secret.id)).toBe(true);
      expect(ids.size).toBe(2);
      for (const s of listBody.secrets) {
        expect("value" in (s ?? {})).toBe(false);
      }

      const duplicate = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { connectorId: "github", name: "token", value: "ghp_other" },
      });
      expect(duplicate.statusCode).toBe(409);
      expect((duplicate.json() as { code: string }).code).toBe("SECRET_ALREADY_EXISTS");

      const memberEmail = `secrets-member-${Date.now()}@example.com`;
      const invite = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { email: memberEmail, roleKey: "member" },
      });
      expect(invite.statusCode).toBe(201);
      const inviteToken = (invite.json() as { invitation: { token: string } }).invitation.token;

      const memberSignup = await server.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { email: memberEmail, password: "Password123" },
      });
      const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });
      const accept = await server.inject({
        method: "POST",
        url: `/v1/invitations/${inviteToken}/accept`,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(accept.statusCode).toBe(200);

      const memberDenied = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${memberToken}`, "x-org-id": orgId },
        payload: { connectorId: "github", name: "member-token", value: "should-fail" },
      });
      expect(memberDenied.statusCode).toBe(403);

      const rotated = await server.inject({
        method: "PUT",
        url: `/v1/orgs/${orgId}/secrets/${createdBody.secret.id}`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { value: "ghp_rotated" },
      });
      expect(rotated.statusCode).toBe(200);

      const deleted = await server.inject({
        method: "DELETE",
        url: `/v1/orgs/${orgId}/secrets/${createdBody.secret.id}`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(deleted.statusCode).toBe(200);
      expect((deleted.json() as { ok: boolean }).ok).toBe(true);
    } finally {
      if (priorKek === undefined) {
        delete process.env.SECRETS_KEK_BASE64;
      } else {
        process.env.SECRETS_KEK_BASE64 = priorKek;
      }
      if (priorKekId === undefined) {
        delete process.env.SECRETS_KEK_ID;
      } else {
        process.env.SECRETS_KEK_ID = priorKekId;
      }
    }
  });

  it("manages org settings and allows members to read but restricts updates", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `settings-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Settings Org", slug: `settings-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const getInitial = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(getInitial.statusCode).toBe(200);
    expect((getInitial.json() as any).settings.tools.shellRunEnabled).toBe(false);
    expect((getInitial.json() as any).settings.agents.engineRuntimeDefaults["gateway.codex.v2"].baseUrl).toBeNull();
    expect((getInitial.json() as any).settings.agents.engineRuntimeDefaults["gateway.claude.v2"].baseUrl).toBeNull();
    expect((getInitial.json() as any).settings.agents.engineRuntimeDefaults["gateway.opencode.v2"].baseUrl).toBeNull();

    const updated = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { tools: { shellRunEnabled: true } },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as any).settings.tools.shellRunEnabled).toBe(true);

    const updatePrimaryDefault = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { llm: { defaults: { primary: { provider: "openai", model: "gpt-5.3-codex", secretId: null } } } },
    });
    expect(updatePrimaryDefault.statusCode).toBe(200);
    expect((updatePrimaryDefault.json() as any).settings.llm.defaults.primary.provider).toBe("openai");
    expect((updatePrimaryDefault.json() as any).settings.llm.defaults.primary.model).toBe("gpt-5.3-codex");

    const updateEngineRuntime = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        agents: {
          engineRuntimeDefaults: {
            "gateway.codex.v2": { baseUrl: "http://127.0.0.1:8045" },
          },
        },
      },
    });
    expect(updateEngineRuntime.statusCode).toBe(200);
    expect((updateEngineRuntime.json() as any).settings.agents.engineRuntimeDefaults["gateway.codex.v2"].baseUrl).toBe(
      "http://127.0.0.1:8045"
    );
    expect((updateEngineRuntime.json() as any).settings.agents.engineRuntimeDefaults["gateway.claude.v2"].baseUrl).toBeNull();

    const mergeEngineRuntime = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        agents: {
          engineRuntimeDefaults: {
            "gateway.claude.v2": { baseUrl: "http://localhost:9999" },
          },
        },
      },
    });
    expect(mergeEngineRuntime.statusCode).toBe(200);
    expect((mergeEngineRuntime.json() as any).settings.agents.engineRuntimeDefaults["gateway.codex.v2"].baseUrl).toBe(
      "http://127.0.0.1:8045"
    );
    expect((mergeEngineRuntime.json() as any).settings.agents.engineRuntimeDefaults["gateway.claude.v2"].baseUrl).toBe(
      "http://localhost:9999"
    );

    const invalidEngineRuntime = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        agents: {
          engineRuntimeDefaults: {
            "gateway.codex.v2": { baseUrl: "not-a-url" },
          },
        },
      },
    });
    expect(invalidEngineRuntime.statusCode).toBe(400);

    const rejectLegacyDefaults = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { llm: { defaults: { session: { provider: "openai", model: "gpt-4.1-mini", secretId: null } } } },
    });
    expect(rejectLegacyDefaults.statusCode).toBe(400);

    const memberEmail = `settings-member-${Date.now()}@example.com`;
    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { email: memberEmail, roleKey: "member" },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = (invite.json() as { invitation: { token: string } }).invitation.token;

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: memberEmail, password: "Password123" },
    });
    const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });
    const accept = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(accept.statusCode).toBe(200);

    const memberGetDenied = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${memberToken}`, "x-org-id": orgId },
    });
    expect(memberGetDenied.statusCode).toBe(200);
    expect((memberGetDenied.json() as any).settings.tools.shellRunEnabled).toBe(true);

    const memberPutDenied = await server.inject({
      method: "PUT",
      url: `/v1/orgs/${orgId}/settings`,
      headers: { authorization: `Bearer ${memberToken}`, "x-org-id": orgId },
      payload: { tools: { shellRunEnabled: false } },
    });
    expect(memberPutDenied.statusCode).toBe(403);
  });

  it("applies engine auth defaults when creating sessions", async () => {
    const priorKek = process.env.SECRETS_KEK_BASE64;
    const priorKekId = process.env.SECRETS_KEK_ID;
    process.env.SECRETS_KEK_ID = "test-kek";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");

    try {
      const ownerSignup = await server.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { email: `session-default-owner-${Date.now()}@example.com`, password: "Password123" },
      });
      const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

      const orgRes = await server.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Session Default Org", slug: `session-default-org-${Date.now()}` },
      });
      expect(orgRes.statusCode).toBe(201);
      const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

      const createdSecret = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/secrets`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          connectorId: "agent.codex",
          name: "default",
          value: "sk-codex-default",
        },
      });
      expect(createdSecret.statusCode).toBe(201);
      const secretId = (createdSecret.json() as { secret: { id: string } }).secret.id;

      const updatedSettings = await server.inject({
        method: "PUT",
        url: `/v1/orgs/${orgId}/settings`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          agents: {
            engineAuthDefaults: {
              "gateway.codex.v2": { mode: "api_key", secretId },
              "gateway.claude.v2": { mode: "oauth_executor" },
            },
            engineRuntimeDefaults: {
              "gateway.codex.v2": { baseUrl: "http://127.0.0.1:8045" },
            },
          },
        },
      });
      expect(updatedSettings.statusCode).toBe(200);
      expect((updatedSettings.json() as any).settings.agents.engineRuntimeDefaults["gateway.codex.v2"].baseUrl).toBe(
        "http://127.0.0.1:8045"
      );

      const codexSession = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/sessions`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
          prompt: { instructions: "hello" },
          tools: { allow: [] },
        },
      });
      expect(codexSession.statusCode).toBe(201);
      expect((codexSession.json() as any).session.llmSecretId).toBe(secretId);

      const claudeSession = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/sessions`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          engine: { id: "gateway.claude.v2", model: "claude-sonnet-4-20250514" },
          prompt: { instructions: "hello" },
          tools: { allow: [] },
        },
      });
      expect(claudeSession.statusCode).toBe(201);
      expect((claudeSession.json() as any).session.llmSecretId).toBeNull();
    } finally {
      if (priorKek === undefined) {
        delete process.env.SECRETS_KEK_BASE64;
      } else {
        process.env.SECRETS_KEK_BASE64 = priorKek;
      }
      if (priorKekId === undefined) {
        delete process.env.SECRETS_KEK_ID;
      } else {
        process.env.SECRETS_KEK_ID = priorKekId;
      }
    }
  });

  it("archives/restores sessions and supports status filters", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `session-archive-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Session Archive Org", slug: `session-archive-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createSession = async (title: string) => {
      const res = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/sessions`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: {
          title,
          engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
          prompt: { instructions: "hello" },
          tools: { allow: [] },
        },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { session: { id: string } }).session.id;
    };

    const sessionA = await createSession("A");
    const sessionB = await createSession("B");

    const archived = await server.inject({
      method: "DELETE",
      url: `/v1/orgs/${orgId}/sessions/${sessionA}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as any).session.status).toBe("archived");

    const activeList = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions?status=active`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(activeList.statusCode).toBe(200);
    expect((activeList.json() as any).sessions.map((s: any) => s.id)).toContain(sessionB);
    expect((activeList.json() as any).sessions.map((s: any) => s.id)).not.toContain(sessionA);

    const archivedList = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions?status=archived`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(archivedList.statusCode).toBe(200);
    expect((archivedList.json() as any).sessions.map((s: any) => s.id)).toContain(sessionA);
    expect((archivedList.json() as any).sessions.map((s: any) => s.id)).not.toContain(sessionB);

    const allList = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions?status=all`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(allList.statusCode).toBe(200);
    expect((allList.json() as any).sessions.map((s: any) => s.id)).toContain(sessionA);
    expect((allList.json() as any).sessions.map((s: any) => s.id)).toContain(sessionB);

    const restored = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions/${sessionA}/restore`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as any).session.status).toBe("active");

    const activeListAfterRestore = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/sessions?status=active`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(activeListAfterRestore.statusCode).toBe(200);
    expect((activeListAfterRestore.json() as any).sessions.map((s: any) => s.id)).toContain(sessionA);
  });

  it("rejects posting a message to archived sessions", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `session-archive-send-${Date.now()}@example.com`, password: "Password123" },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Archived Send Org", slug: `archived-send-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const createSession = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: {
        title: "archived",
        engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
        prompt: { instructions: "hello" },
        tools: { allow: [] },
      },
    });
    expect(createSession.statusCode).toBe(201);
    const sessionId = (createSession.json() as { session: { id: string } }).session.id;

    const archive = await server.inject({
      method: "DELETE",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
    });
    expect(archive.statusCode).toBe(200);

    const send = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { message: "hello" },
    });
    expect(send.statusCode).toBe(409);
    expect((send.json() as { code: string }).code).toBe("SESSION_ARCHIVED");
  });

  it("returns per-engine executor OAuth auth status", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `engine-auth-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    const ownerToken = bearerToken(ownerSignup.json() as { session: { token: string } });

    const outsiderSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `engine-auth-outsider-${Date.now()}@example.com`, password: "Password123" },
    });
    const outsiderToken = bearerToken(outsiderSignup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Engine Auth Org", slug: `engine-auth-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const priorFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          routes: [
            {
              executorId: "11111111-1111-4111-8111-111111111111",
              name: "exec-a",
              kinds: ["agent.run"],
              engineAuth: {
                "gateway.codex.v2": {
                  oauthVerified: true,
                  checkedAt: "2026-01-01T00:00:00.000Z",
                  reason: "verified",
                },
                "gateway.claude.v2": {
                  oauthVerified: false,
                  checkedAt: "2026-01-01T00:00:00.000Z",
                  reason: "unauthenticated",
                },
              },
            },
            {
              executorId: "22222222-2222-4222-8222-222222222222",
              name: "exec-b",
              kinds: ["agent.run"],
              engineAuth: {
                "gateway.codex.v2": {
                  oauthVerified: false,
                  checkedAt: "2026-01-01T00:00:00.000Z",
                  reason: "unauthenticated",
                },
                "gateway.claude.v2": {
                  oauthVerified: true,
                  checkedAt: "2026-01-01T00:00:00.000Z",
                  reason: "verified",
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as any;

    try {
      const statusRes = await server.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/engines/auth-status`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      });
      expect(statusRes.statusCode).toBe(200);
      const body = statusRes.json() as any;
      expect(body.engines["gateway.codex.v2"].onlineExecutors).toBe(2);
      expect(body.engines["gateway.codex.v2"].verifiedCount).toBe(1);
      expect(body.engines["gateway.codex.v2"].unverifiedCount).toBe(1);
      expect(body.engines["gateway.claude.v2"].verifiedCount).toBe(1);
      expect(body.engines["gateway.claude.v2"].unverifiedCount).toBe(1);

      const denied = await server.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/engines/auth-status`,
        headers: { authorization: `Bearer ${outsiderToken}`, "x-org-id": orgId },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

});

describe("api rbac promotion flow", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  const queueProducer = createFakeQueueProducer();

  beforeAll(async () => {
    server = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      orgContextEnforcement: "strict",
      queueProducer,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("enforces invite and role-mutation permissions across member/admin/owner", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "rbac-owner@example.com",
        password: "Password123",
      },
    });
    const ownerBody = ownerSignup.json() as { session: { token: string }; user: { id: string } };
    const ownerToken = bearerToken(ownerBody);

    const adminCandidateSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "rbac-admin-candidate@example.com",
        password: "Password123",
      },
    });
    const adminCandidateBody = adminCandidateSignup.json() as { session: { token: string }; user: { id: string } };
    const adminCandidateToken = bearerToken(adminCandidateBody);
    const adminCandidateUserId = adminCandidateBody.user.id;

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "rbac-member@example.com",
        password: "Password123",
      },
    });
    const memberBody = memberSignup.json() as { session: { token: string }; user: { id: string } };
    const memberToken = bearerToken(memberBody);
    const memberUserId = memberBody.user.id;

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "RBAC Matrix Org",
        slug: `rbac-matrix-org-${Date.now()}`,
      },
    });
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const inviteAdminCandidate = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "rbac-admin-candidate@example.com",
        roleKey: "member",
      },
    });
    expect(inviteAdminCandidate.statusCode).toBe(201);

    const inviteMember = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "rbac-member@example.com",
        roleKey: "member",
      },
    });
    expect(inviteMember.statusCode).toBe(201);

    const adminCandidateInviteToken = (inviteAdminCandidate.json() as { invitation: { token: string } }).invitation.token;
    const memberInviteToken = (inviteMember.json() as { invitation: { token: string } }).invitation.token;

    const acceptAdminCandidate = await server.inject({
      method: "POST",
      url: `/v1/invitations/${adminCandidateInviteToken}/accept`,
      headers: {
        authorization: `Bearer ${adminCandidateToken}`,
      },
    });
    expect(acceptAdminCandidate.statusCode).toBe(200);

    const acceptMember = await server.inject({
      method: "POST",
      url: `/v1/invitations/${memberInviteToken}/accept`,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
    });
    expect(acceptMember.statusCode).toBe(200);

    const memberInviteDenied = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "rbac-member-cannot-invite@example.com",
        roleKey: "member",
      },
    });
    expect(memberInviteDenied.statusCode).toBe(403);

    const memberRoleMutationDenied = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${adminCandidateUserId}/role`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-org-id": orgId,
      },
      payload: {
        roleKey: "admin",
      },
    });
    expect(memberRoleMutationDenied.statusCode).toBe(403);

    const promoteAdminCandidate = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${adminCandidateUserId}/role`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        roleKey: "admin",
      },
    });
    expect(promoteAdminCandidate.statusCode).toBe(200);
    expect((promoteAdminCandidate.json() as { membership: { roleKey: string } }).membership.roleKey).toBe("admin");

    const adminInviteAllowed = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${adminCandidateToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "rbac-admin-can-invite@example.com",
        roleKey: "member",
      },
    });
    expect(adminInviteAllowed.statusCode).toBe(201);

    const adminRoleMutationAllowed = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${memberUserId}/role`,
      headers: {
        authorization: `Bearer ${adminCandidateToken}`,
        "x-org-id": orgId,
      },
      payload: {
        roleKey: "admin",
      },
    });
    expect(adminRoleMutationAllowed.statusCode).toBe(200);
    expect((adminRoleMutationAllowed.json() as { membership: { roleKey: string } }).membership.roleKey).toBe("admin");

    const adminCannotAssignOwner = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${memberUserId}/role`,
      headers: {
        authorization: `Bearer ${adminCandidateToken}`,
        "x-org-id": orgId,
      },
      payload: {
        roleKey: "owner",
      },
    });
    expect(adminCannotAssignOwner.statusCode).toBe(403);

    const ownerCanAssignOwner = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${memberUserId}/role`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": orgId,
      },
      payload: {
        roleKey: "owner",
      },
    });
    expect(ownerCanAssignOwner.statusCode).toBe(200);
    expect((ownerCanAssignOwner.json() as { membership: { roleKey: string } }).membership.roleKey).toBe("owner");
  });

  it("bootstraps a personal workspace and exposes it via /v1/me", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "personal@example.com",
        password: "Password123",
      },
    });
    expect(signup.statusCode).toBe(201);
    const signupBody = signup.json() as { session: { token: string } };

    const me = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${bearerToken(signupBody as any)}`,
      },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { defaultOrgId: string | null; orgs: Array<{ id: string; name: string; roleKey: string }> };
    expect(typeof meBody.defaultOrgId).toBe("string");
    expect(meBody.orgs.length).toBeGreaterThan(0);
    const found = meBody.orgs.find((o) => o.id === meBody.defaultOrgId);
    expect(found?.roleKey).toBe("owner");
  });
});

describe("llm provider api key test endpoint", () => {
  const store = createPaidMemoryStore();
  const queueProducer = createFakeQueueProducer();
  let server: Awaited<ReturnType<typeof buildServer>>;

  async function createOwnerOrg(tag: string) {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `${tag}-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = bearerToken(signup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: `${tag} Org`, slug: `${tag}-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;
    return { ownerToken, orgId };
  }

  beforeAll(async () => {
    server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      queueProducer,
    });
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllGlobals();
  });

  it("returns valid=true for owner/admin when provider accepts key", async () => {
    const { ownerToken, orgId } = await createOwnerOrg("key-test-ok");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const tested = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/llm/providers/openai/test-key`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { value: "sk-test-valid" },
      });

      expect(tested.statusCode).toBe(200);
      const body = tested.json() as { valid: boolean; provider: string; apiKind: string; checkedAt: string };
      expect(body.valid).toBe(true);
      expect(body.provider).toBe("openai");
      expect(body.apiKind).toBe("openai-compatible");
      expect(typeof body.checkedAt).toBe("string");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns LLM_KEY_INVALID when provider rejects API key", async () => {
    const { ownerToken, orgId } = await createOwnerOrg("key-test-invalid");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      )
    );

    try {
      const tested = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/llm/providers/openai/test-key`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { value: "sk-test-invalid" },
      });

      expect(tested.statusCode).toBe(400);
      expect((tested.json() as { code: string }).code).toBe("LLM_KEY_INVALID");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forbids member role from testing provider keys", async () => {
    const { ownerToken, orgId } = await createOwnerOrg("key-test-member");

    const memberEmail = `key-test-member-${Date.now()}@example.com`;
    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { email: memberEmail, roleKey: "member" },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = (invite.json() as { invitation: { token: string } }).invitation.token;

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: memberEmail, password: "Password123" },
    });
    expect(memberSignup.statusCode).toBe(201);
    const memberToken = bearerToken(memberSignup.json() as { session: { token: string } });

    const accept = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(accept.statusCode).toBe(200);

    const tested = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/llm/providers/openai/test-key`,
      headers: { authorization: `Bearer ${memberToken}`, "x-org-id": orgId },
      payload: { value: "sk-test-member" },
    });
    expect(tested.statusCode).toBe(403);
  });

  it("returns LLM_KEY_TEST_UNAVAILABLE when provider is unavailable", async () => {
    const { ownerToken, orgId } = await createOwnerOrg("key-test-unavailable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "upstream down" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      )
    );

    try {
      const tested = await server.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/llm/providers/openai/test-key`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
        payload: { value: "sk-test-timeout" },
      });

      expect(tested.statusCode).toBe(503);
      expect((tested.json() as { code: string }).code).toBe("LLM_KEY_TEST_UNAVAILABLE");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("vertex oauth advanced connection", () => {
  const store = createPaidMemoryStore();
  const queueProducer = createFakeQueueProducer();
  let server: Awaited<ReturnType<typeof buildServer>>;
  const priorKek = process.env.SECRETS_KEK_BASE64;

  const vertexOAuthService = {
    createAuthorizationUrl(context: { state: string; codeVerifier: string; nonce: string }) {
      const url = new URL("https://oauth.local/google/authorize");
      url.searchParams.set("state", context.state);
      url.searchParams.set("nonce", context.nonce);
      return url;
    },
    async exchangeCodeForConnection(context: { code: string; codeVerifier: string; nonce: string }) {
      return {
        refreshToken: "rt_test",
        scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/cloud-platform"],
        profile: { email: "vertex@example.com", displayName: "Vertex User" },
      };
    },
  } as any;

  beforeAll(async () => {
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");
    server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      queueProducer,
      vertexOAuthService,
    });
  });

  afterAll(async () => {
    await server.close();
    if (priorKek === undefined) delete process.env.SECRETS_KEK_BASE64;
    else process.env.SECRETS_KEK_BASE64 = priorKek;
  });

  it("stores a vertex oauth connection as an encrypted org secret", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "vertex-owner@example.com", password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as any);

    const me = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    const orgId = (me.json() as any).defaultOrgId as string;
    expect(typeof orgId).toBe("string");

    const start = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/llm/vertex/start?projectId=proj-1&location=us-central1`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(start.statusCode).toBe(302);
    const cookieHeader = extractCookies(start as any, ["vespid_vertex_oauth_state", "vespid_vertex_oauth_nonce"]);
    expect(cookieHeader).toContain("vespid_vertex_oauth_state=");

    const location = String((start.headers as any).location ?? "");
    const redirect = new URL(location);
    const state = redirect.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await server.inject({
      method: "GET",
      url: `/v1/llm/vertex/callback?code=code_test&state=${encodeURIComponent(state as string)}`,
      headers: {
        authorization: `Bearer ${token}`,
        cookie: cookieHeader,
        "accept-language": "en",
      },
    });
    expect(callback.statusCode).toBe(302);

    const secrets = await server.inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/secrets?connectorId=llm.vertex.oauth`,
      headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
    });
    expect(secrets.statusCode).toBe(200);
    const body = secrets.json() as { secrets: Array<{ connectorId: string; name: string }> };
    expect(
      body.secrets.some(
        (s) => (s.connectorId === "llm.vertex.oauth" || s.connectorId === "llm.google-vertex.oauth") && s.name === "default"
      )
    ).toBe(true);
  });
});

describe("llm oauth device verification url defaults", () => {
  const store = createPaidMemoryStore();
  const queueProducer = createFakeQueueProducer();
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      queueProducer,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("uses provider official default verification page instead of example.com", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `oauth-url-owner-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const ownerToken = bearerToken(signup.json() as { session: { token: string } });

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "OAuth URL Org", slug: `oauth-url-org-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = (orgRes.json() as { organization: { id: string } }).organization.id;

    const started = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/llm/oauth/github-copilot/device/start`,
      headers: { authorization: `Bearer ${ownerToken}`, "x-org-id": orgId },
      payload: { name: "default" },
    });
    expect(started.statusCode).toBe(200);
    const body = started.json() as { verificationUri: string };
    expect(body.verificationUri).toBe("https://github.com/login/device");
    expect(body.verificationUri.includes("example.com/device")).toBe(false);
  });
});

describe("api org context warn mode", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  const queueProducer = createFakeQueueProducer();
  let ownerToken: string;
  let outsiderToken: string;
  let orgId: string;

  beforeAll(async () => {
    server = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      orgContextEnforcement: "warn",
      queueProducer,
    });

    const owner = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "warn-owner@example.com",
        password: "Password123",
      },
    });
    ownerToken = bearerToken(owner.json() as { session: { token: string } });

    const outsider = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "warn-outsider@example.com",
        password: "Password123",
      },
    });
    outsiderToken = bearerToken(outsider.json() as { session: { token: string } });

    const org = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Warn Org",
        slug: `warn-org-${Date.now()}`,
      },
    });
    orgId = (org.json() as { organization: { id: string } }).organization.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it("allows owner request without X-Org-Id and emits warning header", async () => {
    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        email: "warn-member-a@example.com",
        roleKey: "member",
      },
    });

    expect(invite.statusCode).toBe(201);
    const warningHeader = invite.headers["x-org-context-warning"];
    expect(typeof warningHeader).toBe("string");
    expect(String(warningHeader)).toContain("ORG_CONTEXT_REQUIRED");
  });

  it("still rejects outsider request in warn mode when membership is missing", async () => {
    const denied = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${outsiderToken}`,
        "x-org-id": orgId,
      },
      payload: {
        email: "warn-member-b@example.com",
        roleKey: "member",
      },
    });

    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { code: string }).code).toBe("ORG_ACCESS_DENIED");
  });

  it("falls back to route org when X-Org-Id mismatches and emits warning", async () => {
    const mismatched = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": crypto.randomUUID(),
      },
      payload: {
        email: "warn-member-c@example.com",
        roleKey: "member",
      },
    });

    expect(mismatched.statusCode).toBe(201);
    const warningHeader = mismatched.headers["x-org-context-warning"];
    expect(typeof warningHeader).toBe("string");
    expect(String(warningHeader)).toContain("INVALID_ORG_CONTEXT");
  });

  it("keeps oauth failure reason code in json mode", async () => {
    const invite = await server.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/start?mode=json",
    });
    const state = new URL((invite.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state");
    const cookies = extractCookies(invite, ["vespid_oauth_state", "vespid_oauth_nonce"]);

    const failed = await server.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?mode=json&code=bad-code&state=${state}`,
      headers: { cookie: cookies },
    });

    expect(failed.statusCode).toBe(401);
    expect((failed.json() as { code: string }).code).toBe("OAUTH_EXCHANGE_FAILED");
  });
});

describe("account tier and system admin policies", () => {
  it("allows organization creation in open-source tier policy", async () => {
    const server = await buildServer({
      store: new MemoryAppStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `free-user-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as any);

    const createOrg = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Free Org", slug: `free-org-${Date.now()}` },
    });
    expect(createOrg.statusCode).toBe(201);

    await server.close();
  });

  it("returns ORG_SLUG_CONFLICT when creating an existing slug", async () => {
    const server = await buildServer({
      store: new MemoryAppStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `slug-user-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as any);
    const slug = `dup-slug-${Date.now()}`;

    const createOrg1 = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Org One", slug },
    });
    expect(createOrg1.statusCode).toBe(201);

    const createOrg2 = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Org Two", slug },
    });
    expect(createOrg2.statusCode).toBe(409);
    expect((createOrg2.json() as { code: string }).code).toBe("ORG_SLUG_CONFLICT");

    await server.close();
  });

  it("still creates organization when platform_user_roles table is unavailable", async () => {
    const store = new MemoryAppStore();
    vi.spyOn(store, "listPlatformUserRoles").mockImplementation(async () => {
      const error = Object.assign(new Error('relation "platform_user_roles" does not exist'), { code: "42P01" });
      throw error;
    });

    const server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `missing-role-table-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as any);

    const createOrg = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Fallback Org", slug: `fallback-org-${Date.now()}` },
    });
    expect(createOrg.statusCode).toBe(201);

    await server.close();
  });

  it("does not enforce paid-tier org limit caps in open-source policy", async () => {
    const store = createPaidMemoryStore();
    await store.upsertPlatformSetting({
      key: "org_policy",
      value: {
        free: { canManageOrg: false, maxOrgs: 1 },
        paid: { canManageOrg: true, maxOrgs: 2 },
        enterprise: { canManageOrg: true, maxOrgs: null },
      },
    });

    const server = await buildServer({
      store,
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `paid-user-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = bearerToken(signup.json() as any);

    const createOrg1 = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Paid Org 1", slug: `paid-org-a-${Date.now()}` },
    });
    expect(createOrg1.statusCode).toBe(201);

    const createOrg2 = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Paid Org 2", slug: `paid-org-b-${Date.now()}` },
    });
    expect(createOrg2.statusCode).toBe(201);

    await server.close();
  });

  it("allows invitation acceptance without free-tier org cap restrictions", async () => {
    const server = await buildServer({
      store: new MemoryAppStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `owner-free-${Date.now()}@example.com`, password: "Password123" },
    });
    const ownerToken = bearerToken(ownerSignup.json() as any);

    const ownerMe = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const ownerOrgId = (ownerMe.json() as { defaultOrgId: string }).defaultOrgId;
    expect(typeof ownerOrgId).toBe("string");

    const inviteeEmail = `invitee-free-${Date.now()}@example.com`;
    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${ownerOrgId}/invitations`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "x-org-id": ownerOrgId,
      },
      payload: { email: inviteeEmail, roleKey: "member" },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = (invite.json() as { invitation: { token: string } }).invitation.token;

    const inviteeSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: inviteeEmail, password: "Password123" },
    });
    const inviteeToken = bearerToken(inviteeSignup.json() as any);

    const accept = await server.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/accept`,
      headers: { authorization: `Bearer ${inviteeToken}` },
    });
    expect(accept.statusCode).toBe(200);

    await server.close();
  });

  it("denies admin routes for non-system-admin users", async () => {
    const server = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `non-admin-${Date.now()}@example.com`, password: "Password123" },
    });
    const token = bearerToken(signup.json() as any);

    const denied = await server.inject({
      method: "GET",
      url: "/v1/admin/platform/settings",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(403);

    await server.close();
  });

  it("bootstraps system admin via email allowlist", async () => {
    process.env.SYSTEM_ADMIN_EMAIL_ALLOWLIST = "bootstrap-admin@example.com";
    const server = await buildServer({
      store: createPaidMemoryStore(),
      oauthService: fakeOAuthService(),
      queueProducer: createFakeQueueProducer(),
    });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "bootstrap-admin@example.com", password: "Password123" },
    });
    const token = bearerToken(signup.json() as any);

    const me = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as any).account?.isSystemAdmin).toBe(true);

    const list = await server.inject({
      method: "GET",
      url: "/v1/admin/platform/settings",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);

    await server.close();
    delete process.env.SYSTEM_ADMIN_EMAIL_ALLOWLIST;
  });
});
