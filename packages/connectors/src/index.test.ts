import { describe, expect, it } from "vitest";
import { createConnectorCatalog, defaultConnectors } from "./index.js";

describe("connectors", () => {
  it("includes jira connector", () => {
    expect(defaultConnectors.some((connector) => connector.id === "jira")).toBe(true);
  });

  it("includes migrated salesforce connector in defaults", () => {
    expect(defaultConnectors.some((connector) => connector.id === "salesforce")).toBe(true);
  });

  it("allows additional connector injection without mutating defaults", () => {
    const catalog = createConnectorCatalog({
      additionalConnectors: [
        {
          id: "notion",
          displayName: "Notion",
          requiresSecret: true,
        },
      ],
    });

    expect(catalog.some((connector) => connector.id === "notion")).toBe(true);
    expect(defaultConnectors.some((connector) => connector.id === "notion")).toBe(false);
  });
});
