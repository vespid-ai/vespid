import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runVespidLoopV1 } from "./vespid-loop-v1.js";

function mockResponse(input: { ok: boolean; status: number; body: unknown }) {
  const text = JSON.stringify(input.body);
  return {
    ok: input.ok,
    status: input.status,
    async text() {
      return text;
    },
  } as any;
}

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "vespid-loop-"));
}

describe("vespid.loop.v1 (node-agent)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("can execute a local skill tool call", async () => {
    const tmp = await mkTmpDir();
    process.env.VESPID_AGENT_SKILLS_DIR = path.join(tmp, "skills");
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(tmp, "workdir");

    const skillDir = path.join(process.env.VESPID_AGENT_SKILLS_DIR, "hello");
    await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "skill.json"),
      JSON.stringify({
        id: "hello",
        version: "1.0.0",
        description: "Hello skill",
        entrypoint: "scripts/run.sh",
        runtime: "shell",
        inputSchema: { type: "object", additionalProperties: true },
        outputMode: "json",
        sandbox: { backend: "host", network: "enabled", timeoutMs: 10_000 },
      }),
      "utf8"
    );
    await fs.writeFile(path.join(skillDir, "scripts", "run.sh"), "echo ok", "utf8");

    let llmCalls = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (!u.includes("api.openai.com/v1/chat/completions")) {
        throw new Error(`unexpected fetch: ${u}`);
      }
      llmCalls += 1;
      if (llmCalls === 1) {
        return mockResponse({
          ok: true,
          status: 200,
          body: {
            choices: [
              {
                message: {
                  content: JSON.stringify({ type: "tool_call", toolId: "skill.hello", input: { name: "vespid" } }),
                },
              },
            ],
          },
        });
      }
      return mockResponse({
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify({ type: "final", output: { ok: true } }) } }] },
      });
    }) as any;

    const sandbox = {
      async executeShellTask(ctx: any) {
        expect(ctx.script).toContain(`skills/hello/`);
        expect(ctx.taskEnv.VESPID_SKILL_ID).toBe("hello");
        return { status: "succeeded", output: { stdout: "{\"fromSkill\":true}" } };
      },
    } as any;

    const out = await runVespidLoopV1({
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
          llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
          execution: { mode: "node" },
          prompt: { instructions: "Use a skill." },
          tools: { allow: ["skill.hello"], execution: "node" },
          limits: { maxTurns: 4, maxToolCalls: 4, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
          output: { mode: "text" },
        },
      },
      policyToolsAllow: null,
      effectiveToolsAllow: ["skill.hello"],
      runInput: null,
      steps: [],
      organizationSettings: { tools: { shellRunEnabled: true } },
      githubApiBaseUrl: "https://api.github.com",
      secrets: { llmApiKey: "sk-test" },
      sandbox,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.output).toEqual(expect.objectContaining({ ok: true }));
    }
  });

  it("injects toolset skills as read-only system context without leaking content in events", async () => {
    const tmp = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(tmp, "workdir");

    const toolsetSkillMd = "# Hello Skill\n\nDo not leak this.";
    const toolsetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    let capturedSystem: string | null = null;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      capturedSystem =
        Array.isArray(body?.messages) && typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : null;

      return mockResponse({
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify({ type: "final", output: { ok: true } }) } }] },
      });
    }) as any;

    const events: any[] = [];
    const out = await runVespidLoopV1({
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
          llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
          execution: { mode: "node" },
          prompt: { instructions: "Use toolset docs." },
          tools: { allow: [], execution: "node" },
          limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
          output: { mode: "text" },
        },
      },
      policyToolsAllow: null,
      effectiveToolsAllow: [],
      toolset: {
        id: toolsetId,
        name: "My Toolset",
        mcpServers: [],
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "hello",
            name: "Hello",
            files: [{ path: "SKILL.md", content: toolsetSkillMd }],
          },
        ],
      },
      runInput: null,
      steps: [],
      organizationSettings: { tools: { shellRunEnabled: false } },
      githubApiBaseUrl: "https://api.github.com",
      secrets: { llmApiKey: "sk-test" },
      sandbox: { async executeShellTask() { return { status: "failed", error: "nope" }; } } as any,
      emitEvent: (e) => events.push(e),
    });

    expect(out.ok).toBe(true);
    expect(typeof capturedSystem).toBe("string");
    expect(capturedSystem).toContain("Toolset Skills (read-only context)");
    expect(capturedSystem).toContain("Toolset: My Toolset");
    expect(capturedSystem).toContain(toolsetSkillMd);

    const toolsetEvent = events.find((e) => e.kind === "toolset_skills_applied") ?? null;
    expect(toolsetEvent).toBeTruthy();
    expect(toolsetEvent?.payload).toEqual({ toolsetId, count: 1 });
    expect(JSON.stringify(toolsetEvent)).not.toContain(toolsetSkillMd);
  });
});
