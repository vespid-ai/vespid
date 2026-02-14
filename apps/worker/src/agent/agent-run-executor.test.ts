import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const openAiMocks = vi.hoisted(() => ({
  openAiChatCompletion: vi.fn(),
}));

vi.mock("./openai.js", () => ({
  openAiChatCompletion: openAiMocks.openAiChatCompletion,
}));

const toolMocks = vi.hoisted(() => ({
  resolveAgentTool: vi.fn(),
}));

vi.mock("./tools/index.js", () => ({
  resolveAgentTool: toolMocks.resolveAgentTool,
}));

import { createAgentRunExecutor } from "./agent-run-executor.js";

describe("agent.run executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("blocks and dispatches agent.run to node-agent when execution.mode=node, then consumes remote result on resume", async () => {
    const loadSecretValue = vi.fn(async () => "sk-secret");
    const executor = createAgentRunExecutor({
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue,
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { secretId: "00000000-0000-0000-0000-000000000000", fallbackToEnv: true } },
        execution: { mode: "node", selector: { tag: "west" } },
        prompt: { instructions: "Do the thing." },
        tools: { allow: ["connector.github.issue.create"], execution: "cloud", authDefaults: { connectors: { github: { secretId: "00000000-0000-0000-0000-000000000000" } } } },
        limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const blocked = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: {},
      organizationSettings: { tools: { shellRunEnabled: true } },
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.block?.kind).toBe("agent.run");
    expect((blocked.block as any)?.timeoutMs).toBe(10_000);
    expect((blocked.block as any)?.selectorTag).toBe("west");

    const payload = (blocked.block as any)?.payload;
    expect(payload).toBeTruthy();
    expect(payload.nodeId).toBe("n1");
    expect(payload.secrets?.llmApiKey).toBe("sk-secret");
    expect(payload.secrets?.connectorSecretsByConnectorId?.github).toBe("sk-secret");
    expect(Array.isArray(payload.effectiveToolsAllow)).toBe(true);

    const resumed = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: {},
      pendingRemoteResult: { requestId: "req-1", result: { status: "succeeded", output: { ok: true } } },
      organizationSettings: { tools: { shellRunEnabled: true } },
    });

    expect(resumed.status).toBe("succeeded");
    expect(resumed.output).toEqual({ ok: true });
    expect((resumed.runtime as any)?.pendingRemoteResult).toBeNull();
  });

  it("persists tool history across remote blocks and rebuilds context on resume", async () => {
    openAiMocks.openAiChatCompletion
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ type: "tool_call", toolId: "tool.cloud", input: { x: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ type: "tool_call", toolId: "tool.node", input: { y: 2 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ type: "final", output: { ok: true } }),
      });

    toolMocks.resolveAgentTool.mockImplementation((toolId: string) => {
      if (toolId === "tool.cloud") {
        return {
          tool: {
            id: "tool.cloud",
            description: "cloud tool",
            inputSchema: z.any(),
            async execute() {
              return { status: "succeeded", output: { cloud: true } };
            },
          },
          args: {},
        };
      }
      if (toolId === "tool.node") {
        return {
          tool: {
            id: "tool.node",
            description: "node tool",
            inputSchema: z.any(),
            async execute() {
              return {
                status: "blocked",
                block: {
                  kind: "agent.execute",
                  payload: { nodeId: "placeholder", node: { id: "placeholder", type: "agent.execute" } },
                },
              };
            },
          },
          args: {},
        };
      }
      return null;
    });

    const executor = createAgentRunExecutor({
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue: vi.fn(async () => "secret"),
      fetchImpl: vi.fn() as any,
    });

    const emitEvent = vi.fn(async () => undefined);
    const checkpointRuntime = vi.fn(async () => undefined);

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        prompt: { instructions: "Do the thing." },
        tools: { allow: ["tool.cloud", "tool.node"], execution: "node" },
        limits: { maxTurns: 8, maxToolCalls: 20, timeoutMs: 60_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const blocked = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: {},
      emitEvent,
      checkpointRuntime,
      organizationSettings: { tools: { shellRunEnabled: true } },
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.block?.dispatchNodeId).toBe("n1:tool:2");
    expect(toolMocks.resolveAgentTool).toHaveBeenCalledWith("tool.cloud");
    expect(toolMocks.resolveAgentTool).toHaveBeenCalledWith("tool.node");

    const resumed = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: blocked.runtime,
      pendingRemoteResult: { status: "succeeded", output: { node: true } },
      emitEvent,
      checkpointRuntime,
      organizationSettings: { tools: { shellRunEnabled: true } },
    });

    expect(resumed.status).toBe("succeeded");

    const thirdCall = openAiMocks.openAiChatCompletion.mock.calls[2]?.[0];
    expect(thirdCall).toBeTruthy();
    const messages = (thirdCall as any).messages as Array<{ role: string; content: string }>;
    const contents = messages.map((m) => m.content);
    expect(contents.some((c) => c.includes("\"type\":\"tool_result\"") && c.includes("tool.cloud"))).toBe(true);
    expect(contents.some((c) => c.includes("\"type\":\"tool_result\"") && c.includes("tool.node"))).toBe(true);
  });

  it("denies shell.run when org policy disables it", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({ type: "tool_call", toolId: "shell.run", input: { script: "echo hi" } }),
    });

    toolMocks.resolveAgentTool.mockReturnValue({
      tool: { id: "shell.run", description: "shell", inputSchema: z.any(), execute: vi.fn() },
      args: {},
    });

    const executor = createAgentRunExecutor({
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue: vi.fn(async () => "secret"),
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        prompt: { instructions: "Try shell." },
        tools: { allow: ["shell.run"], execution: "node" },
        limits: { maxTurns: 2, maxToolCalls: 2, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      steps: [],
      runtime: {},
      organizationSettings: { tools: { shellRunEnabled: false } },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("TOOL_POLICY_DENIED:shell.run");
    expect(toolMocks.resolveAgentTool).not.toHaveBeenCalled();
  });

  it("validates final JSON output using jsonSchema (Ajv)", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({ type: "final", output: { a: "not-a-number" } }),
    });

    const executor = createAgentRunExecutor({
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue: vi.fn(async () => "secret"),
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        prompt: { instructions: "Return JSON." },
        tools: { allow: [], execution: "cloud" },
        limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: {
          mode: "json",
          jsonSchema: {
            type: "object",
            additionalProperties: false,
            properties: { a: { type: "number" } },
            required: ["a"],
          },
        },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      steps: [],
      runtime: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("INVALID_AGENT_JSON_OUTPUT");
  });

  it("parses envelope from fenced JSON", async () => {
    openAiMocks.openAiChatCompletion.mockResolvedValueOnce({
      ok: true,
      content: "```json\n" + JSON.stringify({ type: "final", output: 1 }) + "\n```",
    });

    const executor = createAgentRunExecutor({
      githubApiBaseUrl: "https://api.github.com",
      loadSecretValue: vi.fn(async () => "secret"),
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        prompt: { instructions: "Return JSON." },
        tools: { allow: [], execution: "cloud" },
        limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      steps: [],
      runtime: {},
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toBe(1);
  });
});
