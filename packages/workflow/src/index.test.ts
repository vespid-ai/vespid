import { describe, expect, it } from "vitest";
import { executeWorkflow, workflowDslSchema } from "./index.js";

describe("workflow dsl", () => {
  it("accepts a minimal v2 workflow", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [{ id: "n1", type: "agent.execute" }],
    });

    expect(parsed.version).toBe("v2");
  });

  it("accepts an agent.run node", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
            execution: { mode: "cloud" },
            prompt: { instructions: "Say hello." },
            tools: {
              allow: [],
              execution: "cloud",
              authDefaults: { connectors: { github: { secretId: "00000000-0000-0000-0000-000000000000" } } },
            },
            limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
            output: { mode: "text" },
            team: {
              mode: "supervisor",
              maxParallel: 3,
              leadMode: "normal",
              teammates: [
                {
                  id: "ux",
                  prompt: { instructions: "Review UX." },
                  tools: { allow: [], execution: "cloud" },
                  limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
                  output: { mode: "json", jsonSchema: { type: "object" } },
                },
              ],
            },
          },
        },
      ],
    });

    expect(parsed.nodes[0]?.type).toBe("agent.run");
  });

  it("accepts agent.run with anthropic provider and node execution selector", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            llm: { provider: "anthropic", model: "claude-3-5-sonnet-latest", auth: { fallbackToEnv: true } },
            execution: { mode: "node", selector: { tag: "west" } },
            prompt: { instructions: "Say hello." },
            tools: { allow: [], execution: "cloud" },
            limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
            output: { mode: "text" },
          },
        },
      ],
    });

    expect(parsed.nodes[0]?.type).toBe("agent.run");
  });

  it("rejects external engine when execution.mode is not node", () => {
    expect(() =>
      workflowDslSchema.parse({
        version: "v2",
        trigger: { type: "trigger.manual" },
        nodes: [
          {
            id: "n1",
            type: "agent.run",
            config: {
              llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
              execution: { mode: "cloud" },
              engine: { id: "codex.sdk.v1" },
              prompt: { instructions: "Say hello." },
              tools: { allow: [], execution: "cloud" },
              limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
              output: { mode: "text" },
            },
          },
        ],
      })
    ).toThrow();
  });

  it("accepts agent.run when tools.allow is empty", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
            prompt: { instructions: "Call no tools." },
            tools: { allow: [], execution: "cloud" },
            limits: { maxTurns: 2, maxToolCalls: 0, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
            output: { mode: "text" },
          },
        },
      ],
    });

    expect(parsed.nodes[0]?.type).toBe("agent.run");
  });

  it("executes nodes in sequence and returns success output", () => {
    const dsl = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        { id: "n1", type: "http.request" },
        { id: "n2", type: "agent.execute" },
        { id: "n3", type: "condition" },
        { id: "n4", type: "parallel.join" },
      ],
    });

    const result = executeWorkflow({ dsl, runInput: { ticket: "ABC-123" } });
    expect(result.status).toBe("succeeded");
    expect(result.steps).toHaveLength(4);
    expect(result.output.completedNodeCount).toBe(4);
    expect(result.output.failedNodeId).toBeNull();
  });
});
