import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEngineRunner } from "./index.js";

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "vespid-claude-engine-"));
}

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  function tool(name: string, _description: string, _schema: any, handler: any) {
    return { name, handler };
  }
  function createSdkMcpServer(input: any) {
    return { name: input.name, tools: input.tools };
  }
  function query(input: any) {
    const options = input.options ?? {};
    const servers = options.mcpServers ?? {};
    const server = servers["vespid-tools"];

    return (async function* () {
      // Exercise a tool call to ensure wiring works.
      expect(options.allowedTools).toContain("mcp__vespid-tools__shell_run");
      const shellTool = server.tools.find((t: any) => t.name === "shell_run");
      expect(shellTool).toBeTruthy();
      await shellTool.handler({ input: { script: "echo hi" } });

      // Return a valid final envelope.
      yield { type: "result", subtype: "success", result: JSON.stringify({ type: "final", output: { ok: true } }) };
    })();
  }

  return { tool, createSdkMcpServer, query };
});

describe("claude.agent-sdk.v1 engine adapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("runs with allowed MCP tools and can execute shell.run", async () => {
    const tmp = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(tmp, "workdir");
    process.env.VESPID_CLAUDE_CODE_PATH = "/usr/local/bin/claude";

    const engine = createEngineRunner();
    const events: any[] = [];
    const sandbox = {
      async executeShellTask() {
        return { status: "succeeded", output: { stdout: "ok\n" } };
      },
    };

    const result = await engine.run({
      requestId: "req-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      workflowId: "44444444-4444-4444-8444-444444444444",
      attemptCount: 1,
      nodeId: "n1",
      node: {
        id: "n1",
        type: "agent.run",
        config: {
          llm: { provider: "anthropic", model: "claude-3-5-sonnet-latest", auth: { fallbackToEnv: true } },
          execution: { mode: "node" },
          engine: { id: "claude.agent-sdk.v1" },
          prompt: { instructions: "Do the thing." },
          tools: { allow: ["shell.run"], execution: "node" },
          limits: { maxTurns: 4, maxToolCalls: 4, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
          output: { mode: "text" },
        },
      },
      policyToolsAllow: null,
      effectiveToolsAllow: ["shell.run"],
      runInput: null,
      steps: [],
      organizationSettings: { tools: { shellRunEnabled: true } },
      githubApiBaseUrl: "https://api.github.com",
      secrets: { llmApiKey: "anthropic-secret" },
      sandbox,
      emitEvent: (e: any) => events.push(e),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual(expect.objectContaining({ ok: true }));
    }
    expect(events.map((e) => e.kind)).toContain("agent.tool_call");
    expect(events.map((e) => e.kind)).toContain("agent.tool_result");
    expect(events.map((e) => e.kind)).toContain("agent.final");
  });
});
