import { describe, expect, it } from "vitest";
import { __testables } from "./runtime.js";

describe("gateway engine runtime base URL helpers", () => {
  it("reads baseUrl from org settings for supported engines only", () => {
    expect(
      __testables.readEngineRuntimeBaseUrlFromOrgSettings({
        organizationSettings: {
          agents: {
            engineRuntimeDefaults: {
              "gateway.codex.v2": { baseUrl: "http://127.0.0.1:8045" },
            },
          },
        },
        engineId: "gateway.codex.v2",
      })
    ).toBe("http://127.0.0.1:8045");

    expect(
      __testables.readEngineRuntimeBaseUrlFromOrgSettings({
        organizationSettings: {
          agents: {
            engineRuntimeDefaults: {
              "gateway.codex.v2": { baseUrl: "http://127.0.0.1:8045" },
            },
          },
        },
        engineId: "gateway.unsupported.v2",
      })
    ).toBeNull();
  });

  it("reads baseUrl from session runtime map", () => {
    expect(
      __testables.readEngineRuntimeBaseUrlFromSession({
        sessionRuntime: {
          engine: {
            "gateway.claude.v2": {
              baseUrl: "http://localhost:9999",
            },
          },
        },
        engineId: "gateway.claude.v2",
      })
    ).toBe("http://localhost:9999");

    expect(
      __testables.readEngineRuntimeBaseUrlFromSession({
        sessionRuntime: {},
        engineId: "gateway.claude.v2",
      })
    ).toBeNull();
  });

  it("normalizes unsupported session stream kinds to tool_log", () => {
    expect(__testables.normalizeSessionStreamKind("turn_started")).toBe("turn_started");
    expect(__testables.normalizeSessionStreamKind("tool_call")).toBe("tool_call");
    expect(__testables.normalizeSessionStreamKind("unknown_kind")).toBe("tool_log");
  });
});
