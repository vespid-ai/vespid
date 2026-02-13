import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { createConnectorActionExecutor } from "./connector-action.js";

describe("github issue create executor", () => {
  let baseUrl: string;
  let server: http.Server;
  let lastAuth: string | null = null;

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method !== "POST" || url.pathname !== "/repos/octo/test/issues") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      lastAuth = req.headers.authorization ?? null;

      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ number: 101, html_url: "https://github.local/issues/101" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start stub server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it("calls GitHub API with bearer token and returns issue metadata", async () => {
    const token = "ghp_unit_test_token";
    const executor = createConnectorActionExecutor({
      githubApiBaseUrl: baseUrl,
      async loadConnectorSecretValue(input) {
        expect(input).toEqual(
          expect.objectContaining({
            organizationId: "org-1",
            userId: "user-1",
            secretId: expect.any(String),
          })
        );
        return token;
      },
    });

    const result = await executor.execute({
      organizationId: "org-1",
      workflowId: "wf-1",
      runId: "run-1",
      attemptCount: 1,
      requestedByUserId: "user-1",
      nodeId: "n1",
      nodeType: "connector.action",
      node: {
        id: "n1",
        type: "connector.action",
        config: {
          connectorId: "github",
          actionId: "issue.create",
          input: {
            repo: "octo/test",
            title: "Hello",
          },
          auth: { secretId: "00000000-0000-0000-0000-000000000000" },
        },
      },
      runInput: null,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ issueNumber: 101, url: "https://github.local/issues/101" });
    expect(lastAuth).toBe(`Bearer ${token}`);
  });
});
