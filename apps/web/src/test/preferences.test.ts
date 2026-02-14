import { describe, expect, it } from "vitest";
import { applyDensityToDocument, normalizeDensity } from "../lib/preferences";

describe("preferences", () => {
  it("normalizes density", () => {
    expect(normalizeDensity("compact")).toBe("compact");
    expect(normalizeDensity("comfortable")).toBe("comfortable");
    expect(normalizeDensity("weird")).toBe("comfortable");
  });

  it("applies density to document", () => {
    applyDensityToDocument("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
