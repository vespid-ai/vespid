import { describe, expect, it } from "vitest";
import { defaultConnectors } from "./index.js";

describe("connectors", () => {
  it("includes jira connector", () => {
    expect(defaultConnectors.some((connector) => connector.id === "jira")).toBe(true);
  });
});
