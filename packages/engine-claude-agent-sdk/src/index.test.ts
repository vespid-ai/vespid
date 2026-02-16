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
    const serverCfg = servers["vespid-tools"];
    const server = serverCfg && typeof serverCfg === "object" && "instance" in serverCfg ? (serverCfg as any).instance : serverCfg;

    return (async function* () {
      // Exercise a tool call to ensure wiring works.
      expect(options.allowedTools).toContain("mcp__vespid-tools__shell_run");
      const shellTool = server.tools.find((t: any) => t.name === "shell_run");
      expect(shellTool).toBeTruthy();
      await shellTool.handler({ input: { script: "echo hi" } });

      if (servers["ext-mcp"]) {
        expect(options.allowedTools).toContain("mcp__ext-mcp__*");
      }
      if (Array.isArray(options.settingSources) && options.settingSources.includes("project")) {
        expect(options.allowedTools).toContain("Skill");
      }

      yield {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
      };

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
          execution: { mode: "executor" },
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
    expect(events.map((e) => e.kind)).toContain("agent.assistant_delta");
    expect(events.map((e) => e.kind)).toContain("agent.final");
  });

  it("stages agent skills and wires external MCP servers from toolset", async () => {
    const tmp = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(tmp, "workdir");
    process.env.VESPID_CLAUDE_CODE_PATH = "/usr/local/bin/claude";
    process.env.TEST_TOKEN = "token-123";

    const engine = createEngineRunner();
    const sandbox = {
      async executeShellTask() {
        return { status: "succeeded", output: { stdout: "ok\n" } };
      },
    };

    const orgId = "11111111-1111-4111-8111-111111111111";
    const runId = "33333333-3333-4333-8333-333333333333";
    const nodeId = "n1";
    const attemptCount = 1;

    const result = await engine.run({
      requestId: "req-2",
      organizationId: orgId,
      userId: "22222222-2222-4222-8222-222222222222",
      runId,
      workflowId: "44444444-4444-4444-8444-444444444444",
      attemptCount,
      nodeId,
      node: {
        id: nodeId,
        type: "agent.run",
        config: {
          llm: { provider: "anthropic", model: "claude-3-5-sonnet-latest", auth: { fallbackToEnv: true } },
          execution: { mode: "executor" },
          engine: { id: "claude.agent-sdk.v1" },
          prompt: { instructions: "Do the thing." },
          tools: { allow: ["shell.run"], execution: "node" },
          limits: { maxTurns: 4, maxToolCalls: 4, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
          output: { mode: "text" },
        },
      },
      policyToolsAllow: null,
      effectiveToolsAllow: ["shell.run"],
      toolset: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "My Toolset",
        mcpServers: [
          {
            name: "ext-mcp",
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
      runInput: null,
      steps: [],
      organizationSettings: { tools: { shellRunEnabled: true } },
      githubApiBaseUrl: "https://api.github.com",
      secrets: { llmApiKey: "anthropic-secret" },
      sandbox,
    });

    expect(result.ok).toBe(true);

    const staged = path.join(process.env.VESPID_AGENT_WORKDIR_ROOT, orgId, runId, nodeId, String(attemptCount), ".claude", "skills", "hello-skill", "SKILL.md");
    const raw = await fs.readFile(staged, "utf8");
    expect(raw).toContain("Hello");
  });
});
