import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import AgentsPage from "../app/[locale]/(app)/agents/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  pairingPayload: {
    token: "test-pairing-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  installerMode: "ready" as "ready" | "error" | "loading",
  installerData: {
    provider: "github-releases" as const,
    repository: "vespid-ai/vespid-community",
    channel: "latest",
    docsUrl: "https://docs.vespid.ai/agent",
    checksumsUrl: "https://github.com/vespid-ai/vespid-community/releases/latest/download/vespid-agent-checksums.txt",
    artifacts: [
      {
        platformId: "darwin-arm64" as const,
        os: "darwin" as const,
        arch: "arm64" as const,
        fileName: "vespid-agent-darwin-arm64.tar.gz",
        archiveType: "tar.gz" as const,
        downloadUrl: "https://github.com/vespid-ai/vespid-community/releases/latest/download/vespid-agent-darwin-arm64.tar.gz",
      },
      {
        platformId: "linux-x64" as const,
        os: "linux" as const,
        arch: "x64" as const,
        fileName: "vespid-agent-linux-x64.tar.gz",
        archiveType: "tar.gz" as const,
        downloadUrl: "https://github.com/vespid-ai/vespid-community/releases/latest/download/vespid-agent-linux-x64.tar.gz",
      },
      {
        platformId: "windows-x64" as const,
        os: "windows" as const,
        arch: "x64" as const,
        fileName: "vespid-agent-windows-x64.zip",
        archiveType: "zip" as const,
        downloadUrl: "https://github.com/vespid-ai/vespid-community/releases/latest/download/vespid-agent-windows-x64.zip",
      },
    ],
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ locale: "en" }),
}));

vi.mock("../lib/hooks/use-active-org-name", () => ({
  useActiveOrgName: () => ({
    orgId: "org_1",
    orgName: "Personal workspace",
  }),
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({
    isLoading: false,
    data: {
      session: { token: "tok", expiresAt: Date.now() + 60_000 },
      user: { email: "ops@vespid.ai" },
    },
  }),
}));

vi.mock("../lib/hooks/use-agents", () => ({
  useAgents: () => ({
    data: { agents: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => ({})),
  }),
  useAgentInstaller: () => {
    if (mocks.installerMode === "loading") {
      return { isLoading: true, isError: false, error: null, data: undefined };
    }
    if (mocks.installerMode === "error") {
      return { isLoading: false, isError: true, error: new Error("AGENT_INSTALLER_UNAVAILABLE"), data: undefined };
    }
    return { isLoading: false, isError: false, error: null, data: mocks.installerData };
  },
  useCreatePairingToken: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => mocks.pairingPayload),
  }),
  useRevokeAgent: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => ({})),
  }),
  useUpdateAgentTags: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => ({})),
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Agents page installer experience", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.installerMode = "ready";
    mocks.pairingPayload = {
      token: "test-pairing-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  });

  it("shows installer panel and platform tabs", async () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.agents.installer.title)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.agents.installer.platforms.darwinArm64 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.agents.installer.platforms.linuxX64 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.agents.installer.platforms.windowsX64 })).toBeInTheDocument();
  });

  it("builds connect command with the created pairing token", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    const createButtons = screen.getAllByRole("button", { name: messages.agents.createPairingToken });
    await user.click(createButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/\.\/vespid-agent connect --pairing-token \"test-pairing-token\"/)).toBeInTheDocument();
    });
  });

  it("shows fallback command when installer metadata is unavailable", () => {
    mocks.installerMode = "error";
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.agents.installer.fallbackTitle)).toBeInTheDocument();
    expect(screen.getByText(/pnpm --filter @vespid\/node-agent dev -- connect --pairing-token/)).toBeInTheDocument();
  });

  it("uses placeholder token in connect command when token is expired", async () => {
    const user = userEvent.setup();
    mocks.pairingPayload = {
      token: "expired-pairing-token",
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    const createButtons = screen.getAllByRole("button", { name: messages.agents.createPairingToken });
    await user.click(createButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/<pairing-token>/)).toBeInTheDocument();
    });
    expect(screen.getByText(messages.agents.installer.tokenExpired)).toBeInTheDocument();
  });
});
