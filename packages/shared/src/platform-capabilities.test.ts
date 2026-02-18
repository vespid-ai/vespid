import { describe, expect, it } from "vitest";
import { platformCapabilities } from "./platform-capabilities.js";

describe("platform capabilities", () => {
  it("keeps tenant rls baseline capability", () => {
    expect(platformCapabilities.includes("tenant_rls")).toBe(true);
  });
});
