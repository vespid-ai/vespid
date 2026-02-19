import { describe, expect, it } from "vitest";
import {
  executeWorkflow,
  upgradeV2ToV3,
  validateV3GraphConstraints,
  workflowDslAnySchema,
  workflowDslSchema,
  workflowDslV3Schema,
} from "./index.js";

describe("workflow dsl", () => {
  it("accepts a minimal v2 workflow", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [{ id: "n1", type: "agent.execute" }],
    });

    expect(parsed.version).toBe("v2");
  });

  it("accepts heartbeat trigger for v2 workflow", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: {
        type: "trigger.heartbeat",
        config: {
          intervalSec: 60,
          jitterSec: 5,
          maxSkewSec: 30,
        },
      },
      nodes: [{ id: "n1", type: "agent.execute" }],
    });

    expect(parsed.trigger.type).toBe("trigger.heartbeat");
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
            toolsetId: "00000000-0000-0000-0000-000000000000",
            engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
            execution: { mode: "gateway" },
            prompt: { instructions: "Say hello." },
            tools: {
              allow: [],
              execution: "cloud",
              authDefaults: { connectors: { github: { secretId: "00000000-0000-0000-0000-000000000000" } } },
            },
            limits: { maxTurns: 2, maxToolCalls: 1, timeoutMs: 1000, maxOutputChars: 1000, maxRuntimeChars: 2048 },
            output: { mode: "text" },
          },
        },
      ],
    });

    expect(parsed.nodes[0]?.type).toBe("agent.run");
  });

  it("accepts agent.run with claude engine and gateway execution selector", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            engine: { id: "gateway.claude.v2", model: "claude-3-5-sonnet-latest" },
            execution: { mode: "gateway", selector: { tag: "west" } },
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

  it("accepts supported gateway engine ids", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            execution: { mode: "gateway" },
            engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
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

  it("rejects unsupported engine id", () => {
    expect(() =>
      workflowDslSchema.parse({
        version: "v2",
        trigger: { type: "trigger.manual" },
        nodes: [
          {
            id: "n1",
            type: "agent.run",
            config: {
              engine: { id: "gateway.invalid.v2" as any, model: "invalid-model" },
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

  it("accepts codex engine with optional secret", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            engine: { id: "gateway.codex.v2", model: "gpt-5-codex", auth: { secretId: "00000000-0000-0000-0000-000000000000" } },
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

  it("accepts agent.run when tools.allow is empty", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        {
          id: "n1",
          type: "agent.run",
          config: {
            engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
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

  it("accepts a minimal v3 workflow", () => {
    const parsed = workflowDslV3Schema.parse({
      version: "v3",
      trigger: { type: "trigger.manual" },
      graph: {
        nodes: {
          n1: { id: "n1", type: "agent.execute" },
        },
        edges: [],
      },
    });
    expect(parsed.version).toBe("v3");
    expect(Object.keys(parsed.graph.nodes)).toEqual(["n1"]);
  });

  it("workflowDslAnySchema accepts v2 and v3", () => {
    expect(
      workflowDslAnySchema.parse({
        version: "v2",
        trigger: { type: "trigger.manual" },
        nodes: [{ id: "n1", type: "agent.execute" }],
      }).version
    ).toBe("v2");

    expect(
      workflowDslAnySchema.parse({
        version: "v3",
        trigger: { type: "trigger.manual" },
        graph: { nodes: { n1: { id: "n1", type: "agent.execute" } }, edges: [] },
      }).version
    ).toBe("v3");
  });

  it("rejects v3 cycles", () => {
    const dsl = workflowDslV3Schema.parse({
      version: "v3",
      trigger: { type: "trigger.manual" },
      graph: {
        nodes: {
          a: { id: "a", type: "http.request" },
          b: { id: "b", type: "http.request" },
        },
        edges: [
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "a" },
        ],
      },
    });
    const result = validateV3GraphConstraints(dsl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GRAPH_CYCLE_DETECTED");
    }
  });

  it("enforces condition edge constraints", () => {
    const dsl = workflowDslV3Schema.parse({
      version: "v3",
      trigger: { type: "trigger.manual" },
      graph: {
        nodes: {
          c1: { id: "c1", type: "condition", config: { path: "x", op: "exists" } },
          t: { id: "t", type: "http.request" },
        },
        edges: [{ id: "e1", from: "c1", to: "t", kind: "cond_true" }],
      },
    });
    const result = validateV3GraphConstraints(dsl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONDITION_EDGE_CONSTRAINTS");
      expect(result.issues?.[0]?.nodeId).toBe("c1");
    }
  });

  it("rejects remote nodes inside parallel regions in v3 MVP", () => {
    const dsl = workflowDslV3Schema.parse({
      version: "v3",
      trigger: { type: "trigger.manual" },
      graph: {
        nodes: {
          root: { id: "root", type: "http.request" },
          a: { id: "a", type: "agent.execute", config: { execution: { mode: "executor" } } },
          b: { id: "b", type: "http.request" },
          join: { id: "join", type: "parallel.join", config: { mode: "all", failFast: true } },
        },
        edges: [
          { id: "e1", from: "root", to: "a" },
          { id: "e2", from: "root", to: "b" },
          { id: "e3", from: "a", to: "join" },
          { id: "e4", from: "b", to: "join" },
        ],
      },
    });
    const result = validateV3GraphConstraints(dsl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PARALLEL_REMOTE_NOT_SUPPORTED");
      expect(result.issues?.[0]?.nodeId).toBe("a");
    }
  });

  it("upgrades v2 -> v3 as a linear graph", () => {
    const v2 = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [
        { id: "n1", type: "http.request" },
        { id: "n2", type: "agent.execute" },
      ],
    });
    const v3 = upgradeV2ToV3(v2);
    expect(v3.version).toBe("v3");
    expect(Object.keys(v3.graph.nodes)).toEqual(["n1", "n2"]);
    expect(v3.graph.edges).toHaveLength(1);
    expect(validateV3GraphConstraints(v3).ok).toBe(true);
  });
});
