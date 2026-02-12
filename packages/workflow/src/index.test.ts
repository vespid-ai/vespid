import { describe, expect, it } from "vitest";
import { workflowDslSchema } from "./index.js";

describe("workflow dsl", () => {
  it("accepts a minimal v2 workflow", () => {
    const parsed = workflowDslSchema.parse({
      version: "v2",
      trigger: { type: "trigger.manual" },
      nodes: [{ id: "n1", type: "agent.execute" }],
    });

    expect(parsed.version).toBe("v2");
  });
});
