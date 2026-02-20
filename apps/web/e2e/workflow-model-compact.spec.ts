import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function mockWorkflowApis(page: Page) {
  const orgId = "org_1";
  const now = new Date().toISOString();

  await page.addInitScript(() => {
    window.localStorage.setItem("vespid.active-org-id", "org_1");
    window.localStorage.setItem("vespid.known-org-ids", JSON.stringify(["org_1"]));
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith("/api/session") && method === "GET") {
      return fulfillJson(route, {
        session: { token: "tok_e2e", expiresAt: Date.now() + 30 * 60 * 1000 },
        user: { id: "usr_1", email: "e2e@example.com" },
      });
    }

    if (pathname === "/api/proxy/v1/me" && method === "GET") {
      return fulfillJson(route, { defaultOrgId: orgId });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/settings` && method === "GET") {
      return fulfillJson(route, {
        settings: {
          llm: {
            defaults: {
              primary: {
                provider: "openai",
                model: "gpt-5.3-codex",
                secretId: null,
              },
            },
          },
        },
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/secrets` && method === "GET") {
      return fulfillJson(route, { secrets: [] });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows` && method === "GET") {
      return fulfillJson(route, { workflows: [], nextCursor: null });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/wf_graph` && method === "GET") {
      return fulfillJson(route, {
        workflow: {
          id: "wf_graph",
          name: "Graph Workflow",
          status: "draft",
          createdAt: now,
          updatedAt: now,
          dsl: {
            version: "v3",
            graph: {
              nodes: {
                root: {
                  id: "root",
                  type: "agent.run",
                  config: {
                    engine: { id: "gateway.codex.v2", model: "gpt-5-codex" },
                    prompt: { instructions: "Initial node" },
                  },
                },
              },
              edges: [],
            },
          },
          editorState: null,
        },
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/wf_graph` && method === "PUT") {
      return fulfillJson(route, { workflow: { id: "wf_graph", name: "Graph Workflow", status: "draft" } });
    }

    return route.continue();
  });
}

test.describe("workflow model compact UX", () => {
  test("workflows create page shows chip-first model config and advanced provider settings", async ({ page }) => {
    await mockWorkflowApis(page);
    await page.goto("/en/workflows");

    const compact = page.getByTestId("workflow-default-llm-compact");
    await expect(compact).toBeVisible();
    await expect(page.getByTestId("workflow-default-llm-compact-chip")).toBeVisible();

    await expect(page.getByRole("button", { name: "Choose provider" })).toHaveCount(0);
    await compact.getByRole("button", { name: "Show" }).click();
    await expect(page.getByRole("button", { name: "Choose provider" })).toBeVisible();
  });

  test("workflow graph editor uses compact model config for bulk and node paths", async ({ page }) => {
    await mockWorkflowApis(page);
    await page.goto("/en/workflows/wf_graph/graph");

    const rightPanel = page.getByTestId("workflow-graph-right-panel");
    await expect(rightPanel).toHaveAttribute("data-state", "collapsed");
    await page.getByTestId("workflow-graph-right-panel-toggle").click();
    await expect(rightPanel).toHaveAttribute("data-state", "expanded");

    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByTestId("workflow-graph-bulk-agent-llm-compact")).toBeVisible();

    await expect(page.getByTestId("workflow-graph-auto-layout")).toBeVisible();
    await page.getByTestId("workflow-graph-auto-layout").click();
    await expect(page.getByTestId("workflow-graph-fullscreen-toggle")).toBeVisible();

    const bulkTeammateChip = page.getByTestId("workflow-graph-bulk-teammate-model");
    await expect(bulkTeammateChip).toBeVisible();
    await page.getByTestId("workflow-graph-bulk-teammate-model-clear").click();
    await expect(bulkTeammateChip).toContainText("(inherit)");

    await page.getByRole("button", { name: "agent.run", exact: true }).click();
    await expect(page.locator("[data-testid^='workflow-graph-node-llm-compact-']").first()).toBeVisible();
  });
});
