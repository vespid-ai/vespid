import { expect, test, type Page, type Route } from "@playwright/test";

type EngineId = "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2";

type OrgSettings = {
  tools: { shellRunEnabled: boolean };
  toolsets: { defaultToolsetId: string | null };
  agents: {
    engineAuthDefaults: Record<EngineId, { mode: "oauth_executor" | "api_key"; secretId: string | null }>;
    engineRuntimeDefaults: Record<EngineId, { baseUrl: string | null }>;
  };
};

type MockRecorder = {
  settingsUpdates: Array<unknown>;
  secretCreates: Array<{ connectorId: string; name: string; value: string }>;
  secretRotations: Array<{ secretId: string; value: string }>;
};

function cloneSettings(input: OrgSettings): OrgSettings {
  return JSON.parse(JSON.stringify(input)) as OrgSettings;
}

function mergeSettingsPatch(current: OrgSettings, patch: any): OrgSettings {
  const next = cloneSettings(current);
  const authDefaults = patch?.agents?.engineAuthDefaults;
  if (authDefaults && typeof authDefaults === "object") {
    for (const [engineId, rawValue] of Object.entries(authDefaults as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(next.agents.engineAuthDefaults, engineId)) continue;
      const value = rawValue as { mode?: "oauth_executor" | "api_key"; secretId?: string | null };
      const target = next.agents.engineAuthDefaults[engineId as EngineId];
      if (value.mode === "api_key" || value.mode === "oauth_executor") {
        target.mode = value.mode;
      }
      if (Object.prototype.hasOwnProperty.call(value, "secretId")) {
        target.secretId = value.secretId ?? null;
      }
    }
  }

  const runtimeDefaults = patch?.agents?.engineRuntimeDefaults;
  if (runtimeDefaults && typeof runtimeDefaults === "object") {
    for (const [engineId, rawValue] of Object.entries(runtimeDefaults as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(next.agents.engineRuntimeDefaults, engineId)) continue;
      const value = rawValue as { baseUrl?: string | null };
      const target = next.agents.engineRuntimeDefaults[engineId as EngineId];
      if (Object.prototype.hasOwnProperty.call(value, "baseUrl")) {
        target.baseUrl = value.baseUrl ?? null;
      }
    }
  }
  return next;
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function mockModelsApi(page: Page): Promise<MockRecorder> {
  const orgId = "org_1";
  const recorder: MockRecorder = {
    settingsUpdates: [],
    secretCreates: [],
    secretRotations: [],
  };
  const now = new Date().toISOString();
  let secretCounter = 1;
  let secrets: Array<{
    id: string;
    connectorId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    updatedByUserId: string;
  }> = [];

  let settings: OrgSettings = {
    tools: { shellRunEnabled: false },
    toolsets: { defaultToolsetId: null },
    agents: {
      engineAuthDefaults: {
        "gateway.codex.v2": { mode: "api_key", secretId: null },
        "gateway.claude.v2": { mode: "api_key", secretId: null },
        "gateway.opencode.v2": { mode: "api_key", secretId: null },
      },
      engineRuntimeDefaults: {
        "gateway.codex.v2": { baseUrl: null },
        "gateway.claude.v2": { baseUrl: null },
        "gateway.opencode.v2": { baseUrl: null },
      },
    },
  };

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

    if (pathname === "/api/proxy/v1/agent/engines" && method === "GET") {
      return fulfillJson(route, {
        engines: [
          {
            id: "gateway.codex.v2",
            displayName: "Codex",
            cliCommand: "codex",
            defaultModel: "gpt-5-codex",
            defaultSecretConnectorId: "agent.codex",
          },
          {
            id: "gateway.claude.v2",
            displayName: "Claude Code",
            cliCommand: "claude",
            defaultModel: "claude-sonnet-4-20250514",
            defaultSecretConnectorId: "agent.claude",
          },
          {
            id: "gateway.opencode.v2",
            displayName: "OpenCode",
            cliCommand: "opencode",
            defaultModel: "claude-opus-4-6",
            defaultSecretConnectorId: "agent.opencode",
          },
        ],
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/engines/auth-status` && method === "GET") {
      return fulfillJson(route, {
        organizationId: orgId,
        engines: {
          "gateway.codex.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
          "gateway.claude.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
          "gateway.opencode.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
        },
      });
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/settings`) {
      if (method === "GET") {
        return fulfillJson(route, { settings });
      }
      if (method === "PUT") {
        const patch = request.postDataJSON();
        recorder.settingsUpdates.push(patch);
        settings = mergeSettingsPatch(settings, patch);
        return fulfillJson(route, { settings });
      }
    }

    if (pathname === `/api/proxy/v1/orgs/${orgId}/secrets`) {
      if (method === "GET") {
        return fulfillJson(route, { secrets });
      }
      if (method === "POST") {
        const body = request.postDataJSON() as { connectorId: string; name: string; value: string };
        recorder.secretCreates.push(body);
        const secret = {
          id: `sec_${secretCounter++}`,
          connectorId: body.connectorId,
          name: body.name,
          createdAt: now,
          updatedAt: now,
          updatedByUserId: "usr_1",
        };
        secrets = [...secrets, secret];
        return fulfillJson(route, { secret });
      }
    }

    if (pathname.startsWith(`/api/proxy/v1/orgs/${orgId}/secrets/`)) {
      const secretId = pathname.split("/").at(-1) ?? "";
      if (method === "PUT") {
        const body = request.postDataJSON() as { value: string };
        recorder.secretRotations.push({ secretId, value: body.value });
        return fulfillJson(route, { secret: { id: secretId } });
      }
      if (method === "DELETE") {
        secrets = secrets.filter((item) => item.id !== secretId);
        return fulfillJson(route, { ok: true });
      }
    }

    return route.continue();
  });

  return recorder;
}

test.describe("models connections wizard e2e", () => {
  test("renders wizard shell and three engines", async ({ page }) => {
    await mockModelsApi(page);
    await page.goto("/zh-CN/models");

    await expect(page.getByTestId("model-connections-wizard")).toBeVisible();
    await expect(page.getByTestId("engine-rail-item-gateway.codex.v2")).toBeVisible();
    await expect(page.getByTestId("engine-rail-item-gateway.claude.v2")).toBeVisible();
    await expect(page.getByTestId("engine-rail-item-gateway.opencode.v2")).toBeVisible();
    await expect(page.getByText("3 步完成模型连接")).toBeVisible();
  });

  test("saves Claude api key mode with runtime baseUrl in one flow", async ({ page }) => {
    const recorder = await mockModelsApi(page);
    await page.goto("/zh-CN/models");

    await page.getByTestId("engine-rail-item-gateway.claude.v2").click();
    await page.getByTestId("connection-path-api_key").click();
    await page.getByTestId("api-key-input-gateway.claude.v2").fill("sk-claude-test");
    await page.getByTestId("base-url-input-gateway.claude.v2").fill("http://127.0.0.1:8045");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect.poll(() => recorder.secretCreates.length).toBe(1);
    expect(recorder.secretCreates[0]).toMatchObject({
      connectorId: "agent.claude",
      name: "default",
      value: "sk-claude-test",
    });

    await expect.poll(() => recorder.settingsUpdates.length).toBeGreaterThan(0);
    expect(recorder.settingsUpdates.at(-1)).toMatchObject({
      agents: {
        engineAuthDefaults: {
          "gateway.claude.v2": {
            mode: "api_key",
            secretId: "sec_1",
          },
        },
        engineRuntimeDefaults: {
          "gateway.claude.v2": {
            baseUrl: "http://127.0.0.1:8045",
          },
        },
      },
    });
  });

  test("shows OpenCode executor-managed template without OAuth verification wording", async ({ page }) => {
    await mockModelsApi(page);
    await page.goto("/zh-CN/models");

    await page.getByTestId("engine-rail-item-gateway.opencode.v2").click();
    await page.getByTestId("connection-path-oauth_executor").click();

    await expect(page.getByText("OpenCode Provider 配置模板")).toBeVisible();
    await expect(page.getByText("Provider JSON 存放在执行器主机，本页只保存模式选择。")).toBeVisible();
    await expect(page.getByText("OAuth 验证状态来自执行器心跳与鉴权探测结果。")).toHaveCount(0);
  });

  test("keeps Base URL when switching to OAuth and marks API key-only runtime effect", async ({ page }) => {
    const recorder = await mockModelsApi(page);
    await page.goto("/zh-CN/models");

    await page.getByTestId("engine-rail-item-gateway.claude.v2").click();
    await page.getByTestId("connection-path-api_key").click();
    await page.getByTestId("api-key-input-gateway.claude.v2").fill("sk-claude-test");
    await page.getByTestId("base-url-input-gateway.claude.v2").fill("http://127.0.0.1:8045");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect.poll(() => recorder.settingsUpdates.length).toBeGreaterThan(0);

    await page.getByTestId("connection-path-oauth_executor").click();
    await page.getByRole("button", { name: "保存当前路径", exact: true }).click();

    await expect.poll(() => recorder.settingsUpdates.length).toBeGreaterThan(1);
    expect(recorder.settingsUpdates.at(-1)).toMatchObject({
      agents: {
        engineAuthDefaults: {
          "gateway.claude.v2": {
            mode: "oauth_executor",
            secretId: null,
          },
        },
        engineRuntimeDefaults: {
          "gateway.claude.v2": {
            baseUrl: "http://127.0.0.1:8045",
          },
        },
      },
    });

    await expect(page.getByText(/当前 Base URL/)).toBeVisible();
    await expect(page.getByText(/仅在 API Key 模式启用时/)).toBeVisible();
  });
});
