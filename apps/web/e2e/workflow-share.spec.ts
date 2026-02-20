import { expect, test, type Page, type Route } from "@playwright/test";

type MockUser = {
  id: string;
  email: string;
  roleKey: "owner" | "admin" | "member";
};

type MockState = {
  invitationToken: string;
  shareId: string;
  sharedRunIds: string[];
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function mockWorkflowShareApis(page: Page, user: MockUser, state: MockState) {
  const orgId = "org_1";
  const workflowId = "wf_1";
  const now = new Date().toISOString();

  await page.addInitScript(
    (payload: { orgId: string }) => {
      window.localStorage.setItem("vespid.active-org-id", payload.orgId);
      window.localStorage.setItem("vespid.known-org-ids", JSON.stringify([payload.orgId]));
    },
    { orgId }
  );

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.endsWith("/api/session") && method === "GET") {
      return fulfillJson(route, {
        session: { token: "tok_e2e", expiresAt: Date.now() + 30 * 60 * 1000 },
        user: { id: user.id, email: user.email },
      });
    }

    if (pathname === "/api/proxy/v1/me" && method === "GET") {
      return fulfillJson(route, {
        defaultOrgId: orgId,
        orgs: [{ id: orgId, name: "Shared Org", roleKey: user.roleKey }],
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/${workflowId}` && method === "GET") {
      return fulfillJson(route, {
        workflow: {
          id: workflowId,
          name: "Shared workflow target",
          status: "published",
          revision: 1,
          familyId: workflowId,
          sourceWorkflowId: null,
          createdAt: now,
          updatedAt: now,
          dsl: { version: "v2", trigger: { type: "trigger.manual" }, nodes: [{ id: "node_1", type: "agent.execute" }] },
        },
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/${workflowId}/runs` && method === "GET") {
      return fulfillJson(route, { runs: [] });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/${workflowId}/revisions` && method === "GET") {
      return fulfillJson(route, { workflows: [] });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/${workflowId}/shares` && method === "GET") {
      return fulfillJson(route, {
        shares: [],
        invitations: [],
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/workflows/${workflowId}/shares/invitations` && method === "POST") {
      const body = request.postDataJSON() as { email: string };
      return fulfillJson(
        route,
        {
          invitation: {
            id: "inv_1",
            organizationId: orgId,
            workflowId,
            email: body.email,
            accessRole: "runner",
            token: state.invitationToken,
            status: "pending",
            invitedByUserId: user.id,
            acceptedByUserId: null,
            expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
            acceptedAt: null,
            createdAt: now,
          },
          inviteUrl: `http://localhost:3000/en/workflow-share/${encodeURIComponent(state.invitationToken)}`,
        },
        201
      );
    }

    if (pathname === `/api/proxy/v1/workflow-shares/invitations/${state.invitationToken}/accept` && method === "POST") {
      if (user.email.toLowerCase() !== "mangaohua@gmail.com") {
        return fulfillJson(route, { code: "WORKFLOW_SHARE_INVITATION_EMAIL_MISMATCH", message: "email mismatch" }, 403);
      }
      return fulfillJson(route, {
        invitation: {
          id: "inv_1",
          organizationId: orgId,
          workflowId,
          email: "mangaohua@gmail.com",
          accessRole: "runner",
          token: state.invitationToken,
          status: "accepted",
          invitedByUserId: "owner_1",
          acceptedByUserId: user.id,
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
          acceptedAt: now,
          createdAt: now,
        },
        share: {
          id: state.shareId,
          organizationId: orgId,
          workflowId,
          userId: user.id,
          accessRole: "runner",
          sourceInvitationId: "inv_1",
          createdByUserId: user.id,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        workflow: {
          id: workflowId,
          name: "Shared workflow target",
          status: "published",
        },
      });
    }

    if (pathname === `/api/proxy/v1/workflow-shares/${state.shareId}` && method === "GET") {
      return fulfillJson(route, {
        share: {
          id: state.shareId,
          organizationId: orgId,
          workflowId,
          userId: user.id,
          accessRole: "runner",
          sourceInvitationId: "inv_1",
          createdByUserId: user.id,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        workflow: {
          id: workflowId,
          name: "Shared workflow target",
          status: "published",
        },
      });
    }

    if (pathname === `/api/proxy/v1/workflow-shares/${state.shareId}/runs` && method === "GET") {
      return fulfillJson(route, {
        runs: state.sharedRunIds.map((id) => ({
          id,
          status: "queued",
          createdAt: now,
        })),
      });
    }

    if (pathname === `/api/proxy/v1/workflow-shares/${state.shareId}/runs` && method === "POST") {
      const runId = `run_${state.sharedRunIds.length + 1}`;
      state.sharedRunIds.push(runId);
      return fulfillJson(route, { run: { id: runId, status: "queued", createdAt: now } }, 201);
    }

    if (pathname.startsWith(`/api/proxy/v1/workflow-shares/${state.shareId}/runs/`) && pathname.endsWith("/events")) {
      return fulfillJson(route, {
        events: [
          {
            id: "evt_1",
            eventType: "run.started",
            message: "Run started",
            createdAt: now,
          },
        ],
      });
    }

    return route.continue();
  });
}

test.describe("workflow share e2e", () => {
  test("owner creates workflow share invitation link", async ({ page }) => {
    const state: MockState = {
      invitationToken: "org_1.wf_1.token_1",
      shareId: "share_1",
      sharedRunIds: [],
    };
    await mockWorkflowShareApis(page, { id: "owner_1", email: "owner@example.com", roleKey: "owner" }, state);
    await page.goto("/en/workflows/wf_1");

    await page.getByRole("button", { name: "Share workflow" }).click();
    await page.getByLabel("Email").fill("mangaohua@gmail.com");
    await page.getByRole("button", { name: "Create invite link" }).click();

    await expect(page.getByText("Latest invite link")).toBeVisible();
    await expect(page.getByText("/en/workflow-share/")).toBeVisible();
  });

  test("invited user accepts invite and runs shared workflow", async ({ page }) => {
    const state: MockState = {
      invitationToken: "org_1.wf_1.token_1",
      shareId: "share_1",
      sharedRunIds: [],
    };
    await mockWorkflowShareApis(page, { id: "target_1", email: "mangaohua@gmail.com", roleKey: "member" }, state);
    await page.goto(`/en/workflow-share/${encodeURIComponent(state.invitationToken)}`);

    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(`/en/shared-workflows/${state.shareId}`);
    await expect(page.getByText("Runner-only access. You can run and view your own runs only.")).toBeVisible();

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(() => state.sharedRunIds.length).toBe(1);
    await expect(page.getByText(state.sharedRunIds[0]!)).toBeVisible();
  });
});
