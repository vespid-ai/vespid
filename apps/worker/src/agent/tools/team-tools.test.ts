import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("@vespid/agent-runtime", () => ({
  runAgentLoop: runtimeMocks.runAgentLoop,
}));

import { teamDelegateTool, teamMapTool } from "./team-tools.js";

function baseCtx(overrides?: Partial<Parameters<typeof teamDelegateTool.execute>[0]>) {
  return {
    organizationId: "org-1",
    userId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    workflowId: "00000000-0000-4000-8000-000000000003",
    attemptCount: 1,
    nodeId: "n1",
    callIndex: 1,
    toolAuthDefaults: null,
    githubApiBaseUrl: "https://api.github.com",
    loadSecretValue: vi.fn(async () => "secret"),
    fetchImpl: vi.fn() as any,
    emitEvent: vi.fn(async () => undefined),
    teamConfig: {
      team: {
        mode: "supervisor",
        maxParallel: 3,
        leadMode: "normal",
        teammates: [
          {
            id: "ux",
            prompt: { instructions: "Review UX." },
            tools: { allow: [], execution: "cloud" },
            limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 50_000 },
            output: { mode: "text" },
          },
        ],
      },
      parent: {
        nodeId: "n1",
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        policyToolAllow: ["tool.allowed", "shell.run"],
        runInput: { a: 1 },
        steps: [],
        organizationSettings: { tools: { shellRunEnabled: false } },
      },
    },
    ...overrides,
  };
}

describe("team tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("team.delegate returns teammate output when runAgentLoop succeeds", async () => {
    runtimeMocks.runAgentLoop.mockResolvedValueOnce({
      status: "succeeded",
      output: { ok: true },
    });

    const result = await teamDelegateTool.execute(baseCtx(), {
      mode: "cloud",
      args: { teammateId: "ux", task: "Check the UX." },
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected succeeded");
    expect(result.output).toEqual({ teammateId: "ux", output: { ok: true } });
  });

  it("team.delegate maps tool policy deny errors from teammate loop", async () => {
    runtimeMocks.runAgentLoop.mockResolvedValueOnce({
      status: "failed",
      error: "TOOL_NOT_ALLOWED:tool.denied",
    });

    const result = await teamDelegateTool.execute(baseCtx(), {
      mode: "cloud",
      args: { teammateId: "ux", task: "Try forbidden tool." },
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected failed");
    expect(result.error).toBe("TEAM_TOOL_POLICY_DENIED:tool.denied");
  });

  it("team.map preserves task order", async () => {
    runtimeMocks.runAgentLoop
      .mockResolvedValueOnce({ status: "succeeded", output: "r1" })
      .mockResolvedValueOnce({ status: "succeeded", output: "r2" });

    const result = await teamMapTool.execute(baseCtx({ callIndex: 7 }), {
      mode: "cloud",
      args: {
        maxParallel: 1,
        tasks: [
          { teammateId: "ux", task: "One" },
          { teammateId: "ux", task: "Two" },
        ],
      },
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected succeeded");
    expect(result.output).toEqual([
      { status: "succeeded", teammateId: "ux", output: "r1" },
      { status: "succeeded", teammateId: "ux", output: "r2" },
    ]);
  });
});

