import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

describe("UI copy simplification guard", () => {
  it("does not reference removed onboarding empty-state subtitle", () => {
    const output = execSync(
      "rg -n 'description=\\{t\\(\"onboarding.subtitle\"\\)\\}' 'src/app/[locale]/(app)' -S || true",
      { cwd: process.cwd(), encoding: "utf8" }
    );
    expect(output.trim()).toBe("");
  });

  it("does not reference removed developer-facing hint keys", () => {
    const output = execSync(
      [
        "rg -n",
        "'sessions\\.create\\.quickHint|sessions\\.create\\.advancedDescription|sessions\\.toolsetHint|sessions\\.selectorHint|sessions\\.toolsHint|workflows\\.builderHint|workflows\\.advancedDescription|workflows\\.list\\.hint|workflows\\.detail\\.runsHint|workflows\\.detail\\.noRunsHint|workflows\\.detail\\.queueRunHint|runs\\.detailsHint|runs\\.summaryHint|runs\\.runHint|runs\\.inspectorHint|runs\\.trustHint|runs\\.healthHint|runs\\.tip|secrets\\.internalOnlyHint|models\\.connections\\.runtimeHint|channels\\.detail\\.connectionHint|onboarding\\.subtitle'",
        "src --glob '!src/test/**' -S || true",
      ].join(" "),
      { cwd: process.cwd(), encoding: "utf8" }
    );
    expect(output.trim()).toBe("");
  });
});
