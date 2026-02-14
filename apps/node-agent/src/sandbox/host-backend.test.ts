import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHostBackend } from "./host-backend.js";

describe("host sandbox backend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a script and captures stdout", async () => {
    const backend = createHostBackend();
    const result = await backend.executeShellTask({
      requestId: "req-1",
      organizationId: "org-1",
      userId: "user-1",
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "n1",
      attemptCount: 1,
      script: "echo hi",
      shell: "sh",
      taskEnv: {},
      networkMode: "enabled",
      timeoutMs: 5_000,
      dockerImage: null,
      envPassthroughAllowlist: [],
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") {
      throw new Error("expected succeeded");
    }
    expect((result.output as any).stdout).toContain("hi");
  });

  it("returns HOST_NETWORK_MODE_UNSUPPORTED when networkMode is none", async () => {
    const backend = createHostBackend();
    const result = await backend.executeShellTask({
      requestId: "req-1",
      organizationId: "org-1",
      userId: "user-1",
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "n1",
      attemptCount: 1,
      script: "echo hi",
      shell: "sh",
      taskEnv: {},
      networkMode: "none",
      timeoutMs: 5_000,
      dockerImage: null,
      envPassthroughAllowlist: [],
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(result.error).toBe("HOST_NETWORK_MODE_UNSUPPORTED");
  });
});

