import { describe, expect, it } from "vitest";
import { roles } from "./schema.js";

describe("schema", () => {
  it("exports core roles table", () => {
    expect(roles).toBeDefined();
    expect(Object.keys(roles)).toContain("key");
  });
});
