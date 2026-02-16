import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runAgentLoop } from "./agent-loop.js";

function makeBaseInput() {
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

describe("managed credits metering (agent.run)", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test";
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("fails fast with CREDITS_EXHAUSTED when credits are unavailable", async () => {
    const base = makeBaseInput();
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch should not be called");
    });

    const result = await runAgentLoop({
      ...(base as any),
      fetchImpl,
      managedCredits: {
        ensureAvailable: vi.fn(async () => false),
        charge: vi.fn(async () => {
          throw new Error("charge should not be called");
        }),
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("CREDITS_EXHAUSTED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("charges managed credits on successful LLM calls based on token usage", async () => {
    const base = makeBaseInput();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"type\":\"final\",\"output\":{\"ok\":true}}" } }],
          usage: { prompt_tokens: 800, completion_tokens: 700, total_tokens: 1500 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const charge = vi.fn(async () => {});
    const result = await runAgentLoop({
      ...(base as any),
      fetchImpl,
      managedCredits: {
        ensureAvailable: vi.fn(async () => true),
        charge,
      },
    });

    expect(result.status).toBe("succeeded");
    expect(charge).toHaveBeenCalledTimes(1);
    const calls = charge.mock.calls as unknown[][];
    const firstArg = (calls[0] ? calls[0][0] : null) as any;
    expect(firstArg).toMatchObject({
      credits: 2,
      inputTokens: 800,
      outputTokens: 700,
      provider: "openai",
      model: "gpt-4o-mini",
      turn: 1,
    });
  });
});
