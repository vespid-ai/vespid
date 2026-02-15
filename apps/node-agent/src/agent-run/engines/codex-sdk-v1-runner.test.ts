import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

let capturedPrompt = "";

vi.mock("node:child_process", async () => {
  const actual = (await vi.importActual("node:child_process")) as any;

  function spawn(_cmd: string, args: string[]) {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on("data", (chunk: any) => {
      capturedPrompt += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });

    // Emit a minimal JSONL stream and write the last message file.
    setImmediate(async () => {
      child.stdout.write(JSON.stringify({ type: "turn.started" }) + "\n");
      child.stdout.write(JSON.stringify({ type: "response.output_text.delta", delta: "hello " }) + "\n");
      child.stdout.write(JSON.stringify({ type: "response.output_text.delta", delta: "world" }) + "\n");

      const idx = args.indexOf("--output-last-message");
      const lastPath = idx >= 0 ? args[idx + 1] : null;
      if (lastPath) {
        await fs.mkdir(path.dirname(lastPath), { recursive: true });
        await fs.writeFile(lastPath, JSON.stringify({ type: "final", output: { ok: true } }), "utf8");
      }

      child.stdout.end();
      child.stderr.end();
      child.emit("exit", 0);
    });

    return child;
  }

  return { ...actual, spawn };
});

import { codexSdkV1Runner } from "./codex-sdk-v1-runner.js";

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "vespid-codex-engine-"));
}

describe("codex.sdk.v1 engine (node-agent)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    capturedPrompt = "";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns a final output via codex exec", async () => {
    const tmp = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(tmp, "workdir");
    process.env.VESPID_CODEX_PATH = "/usr/bin/codex";

    const events: any[] = [];
    const result = await codexSdkV1Runner.run({
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
          llm: { provider: "openai", model: "gpt-5-codex", auth: { fallbackToEnv: true } },
          execution: { mode: "node" },
          engine: { id: "codex.sdk.v1" },
          prompt: { instructions: "Do the thing." },
          tools: { allow: [], execution: "node" },
          limits: { maxTurns: 2, maxToolCalls: 2, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
          output: { mode: "text" },
        },
      },
      policyToolsAllow: null,
      effectiveToolsAllow: [],
      runInput: null,
      steps: [],
      organizationSettings: { tools: { shellRunEnabled: true } },
      githubApiBaseUrl: "https://api.github.com",
      secrets: { llmApiKey: "sk-test" },
      toolset: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "My Toolset",
        mcpServers: [],
        agentSkills: [
          {
            format: "agentskills-v1",
            id: "hello",
            name: "Hello",
            files: [{ path: "SKILL.md", content: "# Hello Skill\n\nDo not leak this." }],
          },
        ],
      },
      sandbox: { async executeShellTask() { return { status: "failed", error: "nope" }; } },
      emitEvent: (e: any) => events.push(e),
    } as any);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual(expect.objectContaining({ ok: true }));
    }
    expect(events.map((e) => e.kind)).toContain("agent.assistant_delta");
    expect(events.map((e) => e.kind)).toContain("agent.assistant_message");
    expect(events.map((e) => e.kind)).toContain("agent.final");

    expect(capturedPrompt).toContain("Toolset Skills (read-only context)");
    expect(capturedPrompt).toContain("Toolset: My Toolset");
    expect(capturedPrompt).toContain("# Hello Skill");

    const toolsetEvent = events.find((e) => e.kind === "toolset_skills_applied") ?? null;
    expect(toolsetEvent).toBeTruthy();
    expect(toolsetEvent?.payload).toEqual({ toolsetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", count: 1 });
  });
});
