import { describe, expect, it, vi } from "vitest";
import { createAgentRunExecutor } from "./agent-run-executor.js";

describe("agent.run executor", () => {
  it("blocks agent.run to gateway brain when no pending remote result exists", async () => {
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
        engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
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
    expect((result.block as any)?.executorSelector?.tag).toBe("west");
    expect((result.block as any)?.executorSelector?.pool).toBe("byon");
    expect(loadSecretValue).not.toHaveBeenCalled();
  });

  it("resumes from pending remote success result without re-dispatching", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
        execution: { mode: "gateway" },
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
      runtime: { pendingRemoteResult: { requestId: "req-1", result: { status: "succeeded", output: { text: "ok" } } } },
      pendingRemoteResult: { requestId: "req-1", result: { status: "succeeded", output: { text: "ok" } } },
      organizationSettings: {},
    });

    expect(result.status).toBe("succeeded");
    expect((result as any).output).toEqual({ text: "ok" });
    expect((result as any).runtime?.pendingRemoteResult).toBeNull();
  });

  it("resumes from pending remote failure result", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
        execution: { mode: "gateway" },
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
      runtime: { pendingRemoteResult: { requestId: "req-1", result: { status: "failed", error: "UPSTREAM_FAIL" } } },
      pendingRemoteResult: { requestId: "req-1", result: { status: "failed", error: "UPSTREAM_FAIL" } },
      organizationSettings: {},
    });

    expect(result.status).toBe("failed");
    expect((result as any).error).toBe("UPSTREAM_FAIL");
    expect((result as any).runtime?.pendingRemoteResult).toBeNull();
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
        engine: {
          id: "gateway.codex.v2",
          model: "gpt-5-codex",
          auth: { secretId: "11111111-1111-4111-8111-111111111111" },
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
    expect(payload.secretRefs?.engineSecretId).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.secretRefs?.connectorSecretIdsByConnectorId?.github).toBe("22222222-2222-4222-8222-222222222222");
    expect(payload.secrets).toBeUndefined();
    expect(loadSecretValue).not.toHaveBeenCalled();
  });

  it("passes configured engine id to gateway payload", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        engine: { id: "gateway.claude.v2", model: "claude-sonnet-4-20250514" },
        execution: { mode: "gateway" },
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
    expect(payload.node.config.engine.id).toBe("gateway.claude.v2");
  });

  it("uses org engine auth default secretId when node auth is omitted", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
        execution: { mode: "gateway" },
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
      organizationSettings: {
        agents: {
          engineAuthDefaults: {
            "gateway.codex.v2": {
              mode: "api_key",
              secretId: "33333333-3333-4333-8333-333333333333",
            },
          },
        },
      },
    });

    const payload = (result.block as any)?.payload;
    expect(payload.secretRefs?.engineSecretId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("does not assign engine secret in oauth_executor mode", async () => {
    const executor = createAgentRunExecutor({
      getGithubApiBaseUrl: () => "https://api.github.com",
      loadSecretValue: vi.fn(async () => "sk-secret"),
      fetchImpl: vi.fn() as any,
    });

    const node = {
      id: "n1",
      type: "agent.run",
      config: {
        engine: { id: "gateway.claude.v2", model: "claude-sonnet-4-20250514" },
        execution: { mode: "gateway" },
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
      organizationSettings: {
        agents: {
          engineAuthDefaults: {
            "gateway.claude.v2": {
              mode: "oauth_executor",
              secretId: "44444444-4444-4444-8444-444444444444",
            },
          },
        },
      },
    });

    const payload = (result.block as any)?.payload;
    expect(payload.secretRefs?.engineSecretId).toBeUndefined();
  });
});
