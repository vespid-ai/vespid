import { describe, expect, it } from "vitest";
import { createConnectorCatalog, defaultConnectors } from "./index.js";

describe("connectors", () => {
  it("includes jira connector", () => {
    expect(defaultConnectors.some((connector) => connector.id === "jira")).toBe(true);
  });

  it("allows enterprise connector injection without mutating defaults", () => {
    const catalog = createConnectorCatalog({
      enterpriseConnectors: [
        {
          id: "salesforce",
          displayName: "Salesforce",
          requiresSecret: true,
        },
      ],
    });

    expect(catalog.some((connector) => connector.id === "salesforce" && connector.source === "enterprise")).toBe(
      true
    );
    expect(defaultConnectors.some((connector) => connector.id === "salesforce")).toBe(false);
  });
});
