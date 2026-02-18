import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import ModelConnectionsPage from "../app/[locale]/(app)/models/model-connections-client";

const mocks = vi.hoisted(() => {
  return {
    push: vi.fn(),
    searchParams: new URLSearchParams(),
    updateSettingsMutate: vi.fn(async () => ({})),
    createSecretMutate: vi.fn(async () => ({})),
    rotateSecretMutate: vi.fn(async () => ({})),
    deleteSecretMutate: vi.fn(async () => ({})),
    testKeyMutate: vi.fn(async () => ({ valid: true, provider: "openai", apiKind: "openai-compatible", checkedAt: new Date().toISOString() })),
    apiFetchJson: vi.fn(),
    refetch: vi.fn(async () => ({})),
    secrets: [] as Array<{ id: string; connectorId: string; name: string; createdAt: string; updatedAt: string; updatedByUserId: string }>,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } }),
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => ({
    data: {
      settings: {
        llm: {
          defaults: {
            primary: { provider: "openai", model: "gpt-5.3-codex", secretId: null },
          },
          providers: {},
        },
      },
    },
    isError: false,
    refetch: mocks.refetch,
  }),
  useUpdateOrgSettings: () => ({
    isPending: false,
    mutateAsync: mocks.updateSettingsMutate,
  }),
}));

vi.mock("../lib/hooks/use-secrets", () => ({
  useSecrets: () => ({
    data: { secrets: mocks.secrets },
    isError: false,
    refetch: mocks.refetch,
  }),
  useCreateSecret: () => ({ mutateAsync: mocks.createSecretMutate }),
  useRotateSecret: () => ({ mutateAsync: mocks.rotateSecretMutate }),
  useDeleteSecret: () => ({ mutateAsync: mocks.deleteSecretMutate }),
}));

vi.mock("../lib/hooks/use-llm-provider-key-test", () => ({
  useTestLlmProviderApiKey: () => ({
    mutateAsync: mocks.testKeyMutate,
  }),
}));

vi.mock("../lib/api", () => ({
  apiFetchJson: (...args: unknown[]) => mocks.apiFetchJson(...args),
  isUnauthorizedError: () => false,
}));

vi.mock("../components/app/llm/llm-config-field", () => ({
  LlmConfigField: () => <div data-testid="llm-config-field" />,
}));

vi.mock("../components/app/llm/provider-picker", () => ({
  ProviderPicker: ({
    value,
    onChange,
    items,
  }: {
    value: string;
    onChange: (value: string) => void;
    items: Array<{ id: string; label: string }>;
  }) => (
    <select data-testid="provider-picker" value={value} onChange={(e) => onChange(e.target.value)}>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));

function readMessages() {
  const filePath = path.join(process.cwd(), "messages", "en.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function renderPage() {
  const messages = readMessages();
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ModelConnectionsPage />
    </NextIntlClientProvider>
  );
}

describe("ModelConnectionsPage provider connections", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.updateSettingsMutate.mockClear();
    mocks.createSecretMutate.mockClear();
    mocks.rotateSecretMutate.mockClear();
    mocks.deleteSecretMutate.mockClear();
    mocks.testKeyMutate.mockClear();
    mocks.apiFetchJson.mockReset();
    mocks.refetch.mockClear();
    mocks.secrets = [];
  });

  it("does not render expanded API key input by default", () => {
    renderPage();
    expect(screen.queryByPlaceholderText("Paste API key...")).not.toBeInTheDocument();
  });

  it("keeps Save disabled until API key test succeeds", async () => {
    const user = userEvent.setup();
    renderPage();

    const openAiRow = screen.getByTestId("provider-row-openai");
    await user.click(within(openAiRow).getByRole("button", { name: "Connect" }));

    const input = await screen.findByPlaceholderText("Paste API key...");
    await user.type(input, "sk-live-test");

    const saveButton = screen.getByTestId("api-key-save-button");
    const testButton = screen.getByTestId("api-key-test-button");
    expect(saveButton).toBeDisabled();

    await user.click(testButton);
    await waitFor(() => expect(mocks.testKeyMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("redirects to provider page for OAuth start when authorizationUrl is returned", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => window);
    mocks.apiFetchJson.mockImplementation(async (path: string) => {
      if (path.includes("/llm/oauth/google-antigravity/start")) {
        return { authorizationUrl: "https://provider.local/oauth/start" };
      }
      throw new Error(`Unexpected call: ${path}`);
    });

    try {
      renderPage();
      await user.click(screen.getByRole("tab", { name: "OAuth" }));
      const row = screen.getByTestId("provider-row-google-antigravity");
      await user.click(within(row).getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith("https://provider.local/oauth/start", "_self");
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  it("falls back to device flow and opens verification page", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mocks.apiFetchJson.mockImplementation(async (path: string) => {
      if (path.includes("/llm/oauth/github-copilot/start")) {
        throw { payload: { code: "LLM_OAUTH_USE_DEVICE_FLOW" }, message: "Use device flow" };
      }
      if (path.includes("/llm/oauth/github-copilot/device/start")) {
        return {
          deviceCode: "device-code-1",
          userCode: "ABCD-1234",
          verificationUri: "https://device.provider.local/verify",
        };
      }
      throw new Error(`Unexpected call: ${path}`);
    });

    try {
      renderPage();
      await user.click(screen.getByRole("tab", { name: "OAuth" }));
      const row = screen.getByTestId("provider-row-github-copilot");
      await user.click(within(row).getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith("https://device.provider.local/verify", "_blank", "noopener,noreferrer");
      });
      expect(await screen.findByText("User code: ABCD-1234")).toBeInTheDocument();
    } finally {
      openSpy.mockRestore();
    }
  });
});
