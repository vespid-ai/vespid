import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const connectorMocks = vi.hoisted(() => ({
  getCommunityConnectorAction: vi.fn(),
}));

vi.mock("@vespid/connectors", () => ({
  getCommunityConnectorAction: connectorMocks.getCommunityConnectorAction,
}));

import { connectorActionTool } from "./connector-tool.js";

describe("connector.action tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects secretId from toolAuthDefaults when auth is omitted", async () => {
    const execute = vi.fn(async () => ({ status: "succeeded", output: { ok: true } }));
    connectorMocks.getCommunityConnectorAction.mockReturnValue({
      connectorId: "github",
      actionId: "issue.create",
      displayName: "Create",
      requiresSecret: true,
      inputSchema: z.object({ repo: z.string() }),
      execute,
    });

    const loadSecretValue = vi.fn(async () => "ghp_test");

    const result = await connectorActionTool.execute(
      {
        organizationId: "org-1",
        userId: "user-1",
        runId: "run-1",
        workflowId: "wf-1",
        attemptCount: 1,
        nodeId: "n1",
        toolAuthDefaults: { connectors: { github: { secretId: "00000000-0000-0000-0000-000000000000" } } },
        githubApiBaseUrl: "https://api.github.com",
        loadSecretValue,
        fetchImpl: vi.fn() as any,
      },
      {
        mode: "cloud",
        args: {
          connectorId: "github",
          actionId: "issue.create",
          input: { repo: "a/b" },
        },
      }
    );

    expect(result.status).toBe("succeeded");
    expect(loadSecretValue).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "00000000-0000-0000-0000-000000000000" })
    );
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ secret: "ghp_test" }));
  });

  it("fails with SECRET_REQUIRED when no secretId is provided and no defaults exist", async () => {
    connectorMocks.getCommunityConnectorAction.mockReturnValue({
      connectorId: "github",
      actionId: "issue.create",
      displayName: "Create",
      requiresSecret: true,
      inputSchema: z.object({ repo: z.string() }),
      execute: vi.fn(),
    });

    const result = await connectorActionTool.execute(
      {
        organizationId: "org-1",
        userId: "user-1",
        runId: "run-1",
        workflowId: "wf-1",
        attemptCount: 1,
        nodeId: "n1",
        toolAuthDefaults: null,
        githubApiBaseUrl: "https://api.github.com",
        loadSecretValue: vi.fn(async () => "secret"),
        fetchImpl: vi.fn() as any,
      },
      {
        mode: "cloud",
        args: {
          connectorId: "github",
          actionId: "issue.create",
          input: { repo: "a/b" },
        },
      }
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected failed result");
    }
    expect(result.error).toBe("SECRET_REQUIRED");
  });
});
