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
