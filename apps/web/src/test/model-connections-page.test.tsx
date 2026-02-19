import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import ModelConnectionsPage from "../app/[locale]/(app)/models/model-connections-client";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  apiFetchJson: vi.fn(),
  refetch: vi.fn(async () => ({})),
  authStatusRefetch: vi.fn(async () => ({})),
  updateOrgSettingsMutate: vi.fn(async () => ({})),
  createSecretMutate: vi.fn(async () => ({ secret: { id: "sec_1" } })),
  rotateSecretMutate: vi.fn(async () => ({})),
  deleteSecretMutate: vi.fn(async () => ({})),
  secrets: [] as Array<{ id: string; connectorId: string; name: string; createdAt: string; updatedAt: string; updatedByUserId: string }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ locale: "en" }),
}));

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } }),
}));

vi.mock("../lib/hooks/use-secrets", () => ({
  useSecrets: () => ({
    data: { secrets: mocks.secrets },
    isError: false,
    refetch: mocks.refetch,
  }),
  useCreateSecret: () => ({ mutateAsync: mocks.createSecretMutate, isPending: false }),
  useRotateSecret: () => ({ mutateAsync: mocks.rotateSecretMutate, isPending: false }),
  useDeleteSecret: () => ({ mutateAsync: mocks.deleteSecretMutate, isPending: false }),
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => ({
    data: {
      settings: {
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
      },
    },
    isError: false,
  }),
  useUpdateOrgSettings: () => ({ mutateAsync: mocks.updateOrgSettingsMutate, isPending: false }),
}));

vi.mock("../lib/api", () => ({
  apiFetchJson: (...args: unknown[]) => mocks.apiFetchJson(...args),
  isUnauthorizedError: () => false,
}));

function readMessages() {
  const filePath = path.join(process.cwd(), "messages", "en.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

const queryClients: QueryClient[] = [];

function renderPage() {
  const messages = readMessages();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } } });
  queryClients.push(client);
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <ModelConnectionsPage />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("ModelConnectionsPage wizard", () => {
  afterEach(() => {
    cleanup();
    for (const client of queryClients) {
      client.clear();
    }
    queryClients.length = 0;
  });

  beforeEach(() => {
    mocks.push.mockReset();
    mocks.apiFetchJson.mockReset();
    mocks.refetch.mockReset();
    mocks.authStatusRefetch.mockReset();
    mocks.updateOrgSettingsMutate.mockReset();
    mocks.createSecretMutate.mockClear();
    mocks.rotateSecretMutate.mockClear();
    mocks.deleteSecretMutate.mockClear();
    mocks.secrets = [];

    mocks.apiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/v1/agent/engines") {
        return {
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
        };
      }
      if (path === "/v1/orgs/org_1/engines/auth-status") {
        return {
          organizationId: "org_1",
          engines: {
            "gateway.codex.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
            "gateway.claude.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
            "gateway.opencode.v2": { onlineExecutors: 0, verifiedCount: 0, unverifiedCount: 0, executors: [] },
          },
        };
      }
      throw new Error(`Unexpected call: ${path}`);
    });
  });

  it("renders wizard with engine rail", async () => {
    renderPage();
    await screen.findByTestId("model-connections-wizard");
    expect(screen.getByTestId("engine-rail-item-gateway.codex.v2")).toBeInTheDocument();
    expect(screen.getByTestId("engine-rail-item-gateway.claude.v2")).toBeInTheDocument();
    expect(screen.getByTestId("engine-rail-item-gateway.opencode.v2")).toBeInTheDocument();
  });

  it("shows Claude API key + Base URL fields and saves both auth/runtime defaults", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("engine-rail-item-gateway.claude.v2");
    await user.click(screen.getByTestId("engine-rail-item-gateway.claude.v2"));

    const claudeInput = await screen.findByTestId("api-key-input-gateway.claude.v2");
    const claudeBaseUrlInput = screen.getByTestId("base-url-input-gateway.claude.v2");

    await user.type(claudeInput, "sk-claude-test");
    await user.type(claudeBaseUrlInput, "http://127.0.0.1:8045");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.createSecretMutate).toHaveBeenCalledWith({
        connectorId: "agent.claude",
        name: "default",
        value: "sk-claude-test",
      });
    });

    await waitFor(() => {
      expect(mocks.updateOrgSettingsMutate).toHaveBeenCalledWith({
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
  });

  it("renders OpenCode executor-managed path without OAuth account wording", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("engine-rail-item-gateway.opencode.v2");
    await user.click(screen.getByTestId("engine-rail-item-gateway.opencode.v2"));
    await user.click(screen.getByTestId("connection-path-oauth_executor"));

    expect(screen.getAllByText("Executor-managed provider profile").length).toBeGreaterThan(0);
    expect(screen.getByText("OpenCode provider profile template")).toBeInTheDocument();
    expect(screen.queryByText("OAuth account")).not.toBeInTheDocument();
  });
});
