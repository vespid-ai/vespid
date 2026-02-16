import { describe, expect, it, vi } from "vitest";
import { createAgentRunExecutor } from "./agent-run-executor.js";

describe("agent.run executor", () => {
  it("always blocks agent.run to gateway brain", async () => {
    const loadSecretValue = vi.fn(async () => "sk-secret");
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue,
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        execution: { mode: "gateway", selector: { tag: "west" } },
        prompt: { instructions: "Do the thing." },
        tools: { allow: ["connector.action"], execution: "executor" },
        limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "00000000-0000-0000-0000-000000000001",
      attemptCount: 1,
      requestedByUserId: "00000000-0000-0000-0000-000000000002",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: {},
      organizationSettings: {},
    });

    expect(result.status).toBe("blocked");
    expect(result.block?.kind).toBe("agent.run");
    expect((result.block as any)?.selectorTag).toBe("west");
    expect(loadSecretValue).not.toHaveBeenCalled();
  });

  it("passes only secret references (not decrypted secret values)", async () => {
    const loadSecretValue = vi.fn(async () => "sk-secret");
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue,
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: {
          provider: "openai",
          model: "gpt-4.1-mini",
          auth: { secretId: "11111111-1111-4111-8111-111111111111", fallbackToEnv: true },
        },
        execution: { mode: "gateway" },
        prompt: { instructions: "Do the thing." },
        tools: {
          allow: ["connector.action"],
          execution: "executor",
          authDefaults: { connectors: { github: { secretId: "22222222-2222-4222-8222-222222222222" } } },
        },
        limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "00000000-0000-0000-0000-000000000001",
      attemptCount: 1,
      requestedByUserId: "00000000-0000-0000-0000-000000000002",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: { a: 1 },
      steps: [],
      runtime: {},
      organizationSettings: {},
    });

    expect(result.status).toBe("blocked");
    const payload = (result.block as any)?.payload;
    expect(payload.secretRefs?.llmSecretId).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.secretRefs?.connectorSecretIdsByConnectorId?.github).toBe("22222222-2222-4222-8222-222222222222");
    expect(payload.secrets).toBeUndefined();
    expect(loadSecretValue).not.toHaveBeenCalled();
  });

  it("forces provider based on gateway engine id", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
        execution: { mode: "gateway" },
        engine: { id: "gateway.claude.v2" },
        prompt: { instructions: "Do the thing." },
        tools: { allow: [], execution: "cloud" },
        limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
        output: { mode: "text" },
      },
    };

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "00000000-0000-0000-0000-000000000001",
      attemptCount: 1,
      requestedByUserId: "00000000-0000-0000-0000-000000000002",
      nodeId: "n1",
      nodeType: "agent.run",
      node,
      runInput: {},
      steps: [],
      runtime: {},
      organizationSettings: {},
    });

    const payload = (result.block as any)?.payload;
    expect(payload.node.config.llm.provider).toBe("anthropic");
  });
});
