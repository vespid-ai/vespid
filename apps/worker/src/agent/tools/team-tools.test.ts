import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  openAiChatCompletion: vi.fn(),
}));

vi.mock("../openai.js", () => ({
  openAiChatCompletion: openAiMocks.openAiChatCompletion,
}));

const toolMocks = vi.hoisted(() => ({
  resolveAgentTool: vi.fn(),
}));

vi.mock("./index.js", () => ({
  resolveAgentTool: toolMocks.resolveAgentTool,
}));

import { z } from "zod";
import { teamDelegateTool, teamMapTool } from "./team-tools.js";

function baseCtx(overrides?: Partial<Parameters<typeof teamDelegateTool.execute>[0]>) {
  return {
    organizationId: "org-1",
    userId: "user-1",
    runId: "run-1",
    workflowId: "wf-1",
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
          {
            id: "dev",
            prompt: { instructions: "Implement." },
            tools: { allow: ["tool.allowed"], execution: "cloud" },
            limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 50_000 },
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
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("team.delegate runs a teammate loop and returns output", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({ type: "final", output: { ok: true } }),
    });

    const result = await teamDelegateTool.execute(baseCtx(), {
      mode: "cloud",
      args: { teammateId: "ux", task: "Check the UX." },
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") {
      throw new Error("Expected succeeded");
    }
    expect(result.output).toEqual({ teammateId: "ux", output: { ok: true } });
  });

  it("team.delegate enforces tool allowlist intersection", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({ type: "tool_call", toolId: "tool.notAllowed", input: {} }),
    });

    const result = await teamDelegateTool.execute(baseCtx(), {
      mode: "cloud",
      args: { teammateId: "dev", task: "Try calling a forbidden tool." },
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected failed");
    }
    expect(result.error).toBe("TEAM_TOOL_POLICY_DENIED:tool.notAllowed");
  });

  it("team.delegate enforces org shell.run policy (even if allowlisted)", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({ type: "tool_call", toolId: "shell.run", input: { script: "echo hi" } }),
    });

    toolMocks.resolveAgentTool.mockReturnValue({
      tool: { id: "shell.run", description: "shell", inputSchema: z.any(), execute: vi.fn() },
      args: {},
    });

    const ctx = baseCtx();
    (ctx.teamConfig as any).team.teammates = (ctx.teamConfig as any).team.teammates.map((t: any) =>
      t.id === "dev" ? { ...t, tools: { ...t.tools, allow: ["shell.run"] } } : t
    );

    const result = await teamDelegateTool.execute(ctx, {
      mode: "cloud",
      args: { teammateId: "dev", task: "Try shell." },
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected failed");
    }
    expect(result.error).toBe("TOOL_POLICY_DENIED:shell.run");
    expect(toolMocks.resolveAgentTool).not.toHaveBeenCalled();
  });

  it("team.map respects maxParallel and returns results in input order", async () => {
    const d1 = (() => {
      let resolve!: (v: any) => void;
      const promise = new Promise((r) => {
        resolve = r as any;
      });
      return { promise, resolve };
    })();
    const d2 = (() => {
      let resolve!: (v: any) => void;
      const promise = new Promise((r) => {
        resolve = r as any;
      });
      return { promise, resolve };
    })();

    openAiMocks.openAiChatCompletion.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);

    const ctx = baseCtx({ callIndex: 7 });

    const run = teamMapTool.execute(ctx, {
      mode: "cloud",
      args: {
        maxParallel: 1,
        tasks: [
          { teammateId: "ux", task: "One" },
          { teammateId: "ux", task: "Two" },
        ],
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(openAiMocks.openAiChatCompletion.mock.calls.length).toBe(1);

    d1.resolve({ ok: true, content: JSON.stringify({ type: "final", output: "r1" }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(openAiMocks.openAiChatCompletion.mock.calls.length).toBe(2);

    d2.resolve({ ok: true, content: JSON.stringify({ type: "final", output: "r2" }) });
    const result = await run;

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") {
      throw new Error("Expected succeeded");
    }

    expect(result.output).toEqual([
      { status: "succeeded", teammateId: "ux", output: "r1" },
      { status: "succeeded", teammateId: "ux", output: "r2" },
    ]);
  });
});
