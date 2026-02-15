import { describe, expect, it } from "vitest";

const e2eEnabled = Boolean(process.env.VESPID_CLAUDE_E2E);

(e2eEnabled ? describe : describe.skip)("claude-agent-sdk e2e (opt-in)", () => {
  it("can start a query and register an SDK MCP server", async () => {
    const pathToClaudeCodeExecutable = process.env.VESPID_CLAUDE_CODE_PATH;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!pathToClaudeCodeExecutable || !apiKey) {
      throw new Error("Missing VESPID_CLAUDE_CODE_PATH or ANTHROPIC_API_KEY");
    }

    const { query, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");

    const vespidTools = createSdkMcpServer({ name: "vespid-tools", tools: [] });
    const q: any = query({
      prompt: "ping",
      options: {
        pathToClaudeCodeExecutable,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
        // Ensure the SDK path uses dynamic MCP wiring (no settings dependency).
        mcpServers: { "vespid-tools": vespidTools },
        allowedTools: [],
        permissionMode: "dontAsk",
      },
    });

    try {
      if (typeof q.initializationResult === "function") {
        await q.initializationResult();
      }
      const status = typeof q.mcpServerStatus === "function" ? await q.mcpServerStatus() : [];
      expect(Array.isArray(status)).toBe(true);
      expect(status.some((s: any) => s && s.name === "vespid-tools")).toBe(true);
    } finally {
      // Best-effort cleanup. Query is also an AsyncIterable, but we don't need to drain it here.
      if (q && typeof q.close === "function") {
        q.close();
      }
    }
  }, 60_000);
});

