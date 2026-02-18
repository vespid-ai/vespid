import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  createSecretMutate: vi.fn(async () => ({})),
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

function renderPage() {
  const messages = readMessages();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <ModelConnectionsPage />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("ModelConnectionsPage engine connections", () => {
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

  it("renders three supported engine cards", async () => {
    renderPage();
    await screen.findByTestId("engine-card-gateway.codex.v2");
    expect(screen.getByTestId("engine-card-gateway.claude.v2")).toBeInTheDocument();
    expect(screen.getByTestId("engine-card-gateway.opencode.v2")).toBeInTheDocument();
  });

  it("creates connector secret for engine API key", async () => {
    const user = userEvent.setup();
    renderPage();

    const codexCard = await screen.findByTestId("engine-card-gateway.codex.v2");
    const input = within(codexCard).getByLabelText("API key");
    await user.type(input, "sk-codex-test");
    await user.click(within(codexCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.createSecretMutate).toHaveBeenCalledWith({
        connectorId: "agent.codex",
        name: "default",
        value: "sk-codex-test",
      });
    });
  });
});
