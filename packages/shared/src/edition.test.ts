import { describe, expect, it } from "vitest";
import { communityFeatureCapabilities } from "./edition.js";

describe("edition capabilities", () => {
  it("keeps tenant rls baseline capability", () => {
    expect(communityFeatureCapabilities.includes("tenant_rls")).toBe(true);
  });
});
