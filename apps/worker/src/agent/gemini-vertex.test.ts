import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runAgentLoop } from "./agent-loop.js";

function baseInput() {
  return {
    organizationId: "org-1",
    workflowId: "wf-1",
    runId: "run-1",
    attemptCount: 1,
    requestedByUserId: "user-1",
    nodeId: "n1",
    nodeType: "agent.run",
    githubApiBaseUrl: "https://api.github.com",
    loadSecretValue: vi.fn(async () => "secret"),
    fetchImpl: vi.fn(),
    config: {
      llm: { provider: "openai" as const, model: "gpt-4o-mini", auth: { fallbackToEnv: true as const } },
      prompt: { instructions: "Return a final JSON envelope.", system: "" },
      tools: { allow: [], execution: "cloud" as const },
      limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 10_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 },
      output: { mode: "json" as const },
    },
  };
}

describe("LLM providers (gemini + vertex)", () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalVertexClientId = process.env.GOOGLE_VERTEX_CLIENT_ID;
  const originalVertexClientSecret = process.env.GOOGLE_VERTEX_CLIENT_SECRET;

  afterEach(() => {
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalVertexClientId === undefined) delete process.env.GOOGLE_VERTEX_CLIENT_ID;
    else process.env.GOOGLE_VERTEX_CLIENT_ID = originalVertexClientId;
    if (originalVertexClientSecret === undefined) delete process.env.GOOGLE_VERTEX_CLIENT_SECRET;
    else process.env.GOOGLE_VERTEX_CLIENT_SECRET = originalVertexClientSecret;
  });

  it("charges managed credits for gemini when using env auth", async () => {
    process.env.GEMINI_API_KEY = "gemini-test";
    const base = baseInput();

    const fetchImpl = vi.fn(async (url: any) => {
      expect(String(url)).toContain("generativelanguage.googleapis.com");
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{\"type\":\"final\",\"output\":{\"ok\":true}}" }] } }],
          usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200, totalTokenCount: 1100 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const charge = vi.fn<(input: any) => Promise<void>>(async () => {});
    const result = await runAgentLoop({
      ...(base as any),
      fetchImpl,
      config: {
        ...base.config,
        llm: { provider: "gemini" as const, model: "gemini-2.0-flash", auth: { fallbackToEnv: true as const } },
      },
      managedCredits: {
        ensureAvailable: vi.fn(async () => true),
        charge,
      },
    });

    expect(result.status).toBe("succeeded");
    expect(charge).toHaveBeenCalledTimes(1);
    const arg = charge.mock.calls[0]?.[0] as any;
    expect(arg).toMatchObject({
      credits: 2,
      inputTokens: 900,
      outputTokens: 200,
      provider: "gemini",
      model: "gemini-2.0-flash",
      turn: 1,
    });
  });

  it("executes vertex provider via refresh token without managed credits", async () => {
    process.env.GOOGLE_VERTEX_CLIENT_ID = "vertex-client";
    process.env.GOOGLE_VERTEX_CLIENT_SECRET = "vertex-secret";

    const base = baseInput();
    const loadSecretValue = vi.fn(async () =>
      JSON.stringify({
        refreshToken: "rt_test",
        projectId: "proj-1",
        location: "us-central1",
      })
    );

    const fetchImpl = vi.fn(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr === "https://oauth2.googleapis.com/token") {
        expect(String(init?.body ?? "")).toContain("grant_type=refresh_token");
        return new Response(JSON.stringify({ access_token: "at_test", expires_in: 3600, token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(urlStr).toContain("aiplatform.googleapis.com");
      expect(init?.headers?.authorization).toBe("Bearer at_test");
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{\"type\":\"final\",\"output\":{\"ok\":true}}" }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const charge = vi.fn<(input: any) => Promise<void>>(async () => {});
    const ensureAvailable = vi.fn(async () => true);
    const result = await runAgentLoop({
      ...(base as any),
      fetchImpl,
      loadSecretValue,
      config: {
        ...base.config,
        llm: {
          provider: "vertex" as const,
          model: "gemini-2.0-flash-001",
          auth: { secretId: "00000000-0000-0000-0000-000000000000", fallbackToEnv: true as const },
        },
      },
      managedCredits: { ensureAvailable, charge },
    });

    expect(result.status).toBe("succeeded");
    expect(ensureAvailable).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });
});
