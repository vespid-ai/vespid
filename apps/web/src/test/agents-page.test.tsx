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
    provider: "npm-registry" as const,
    delivery: "npm" as const,
    fallbackReason: null as string | null,
    packageName: "@vespid/node-agent",
    distTag: "latest",
    registryUrl: "https://registry.npmjs.org",
    docsUrl: "https://docs.vespid.ai/agent",
    commands: {
      connect: 'npx -y @vespid/node-agent@latest connect --pairing-token "<pairing-token>" --api-base "<api-base>"',
      start: "npx -y @vespid/node-agent@latest start",
    },
  },
  agentsData: [] as any[],
  deleteAgent: vi.fn(async () => ({})),
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
    data: { agents: mocks.agentsData },
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
  useDeleteAgent: () => ({
    isPending: false,
    mutateAsync: mocks.deleteAgent,
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
    mocks.agentsData = [];
    mocks.deleteAgent.mockReset();
    mocks.pairingPayload = {
      token: "test-pairing-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  });

  it("shows installer panel with npm command guidance", async () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.agents.installer.title)).toBeInTheDocument();
    expect(screen.getByText("@vespid/node-agent@latest")).toBeInTheDocument();
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
      expect(screen.getByText(/npx -y @vespid\/node-agent@latest connect --pairing-token \"test-pairing-token\"/)).toBeInTheDocument();
    });
  });

  it("shows unavailable notice when installer metadata is unavailable", () => {
    mocks.installerMode = "error";
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.agents.installer.fallbackTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.agents.installer.fallbackDescription)).toBeInTheDocument();
    expect(screen.getByText(messages.agents.installer.fallbackUsingDefaults)).toBeInTheDocument();
    expect(screen.getByText(messages.agents.installer.connectCommand)).toBeInTheDocument();
    expect(screen.getByText(messages.agents.installer.startCommand)).toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.sourceConnectCommand)).not.toBeInTheDocument();
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
      expect(screen.getAllByText(/<pairing-token>/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(messages.agents.installer.tokenExpired)).toBeInTheDocument();
  });

  it("shows only connect and restart command blocks", () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.agents.installer.connectCommand)).toBeInTheDocument();
    expect(screen.getByText("Restart command")).toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.downloadCommand)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.sourceConnectCommand)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.sourceStartCommand)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.binaryArgsConnect)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.agents.installer.binaryArgsStart)).not.toBeInTheDocument();
  });

  it("shows delete action for revoked worker nodes", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.agentsData = [
      {
        id: "executor-1",
        name: "Revoked Node",
        status: "revoked",
        revokedAt: "2026-02-19T01:00:00.000Z",
        lastSeenAt: "2026-02-19T01:00:00.000Z",
        createdAt: "2026-02-18T01:00:00.000Z",
        tags: [],
        reportedTags: [],
      },
    ];

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AgentsPage />
      </NextIntlClientProvider>
    );

    expect(screen.queryByRole("button", { name: messages.agents.revoke })).not.toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: messages.common.delete });
    await user.click(deleteButtons[0]!);
    await screen.findByText("Delete revoked worker node");
    const confirmDeleteButtons = screen.getAllByRole("button", { name: messages.common.delete });
    await user.click(confirmDeleteButtons[confirmDeleteButtons.length - 1]!);

    await waitFor(() => {
      expect(mocks.deleteAgent).toHaveBeenCalledWith("executor-1");
    });
  });
});
