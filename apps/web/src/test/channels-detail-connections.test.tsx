import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import ChannelAccountDetailPage from "../app/[locale]/(app)/channels/[accountId]/page";

const mocks = vi.hoisted(() => {
  const account = {
    id: "acc_1",
    organizationId: "org_1",
    channelId: "slack",
    accountKey: "ops-bot",
    displayName: "Ops bot",
    enabled: true,
    status: "active",
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    requireMentionInGroup: true,
    webhookUrl: null,
    metadata: {},
    lastError: null,
    lastSeenAt: null,
    createdByUserId: "user_1",
    updatedByUserId: "user_1",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
  return {
    push: vi.fn(),
    account,
    statusData: {
      account,
      secretsCount: 1,
      pendingPairings: 0,
      allowlistCount: 0,
      latestEvents: [] as Array<{ conversationId: string | null }>,
    },
    runAction: vi.fn(async (_action: string) => ({ ok: true })),
  };
});

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ push: mocks.push }),
    useParams: () => ({ locale: "en", accountId: "acc_1" }),
  };
});

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } }),
}));

vi.mock("../lib/hooks/use-channels", () => ({
  useChannelAccount: () => ({ data: { account: mocks.account }, isLoading: false, isError: false, refetch: vi.fn() }),
  useChannelCatalog: () => ({
    data: {
      channels: [
        {
          id: "slack",
          label: "Slack",
          category: "core",
          docsPath: "/channels/slack",
          onboardingMode: "webhook",
          requiresExternalRuntime: false,
          defaultDmPolicy: "pairing",
          defaultRequireMentionInGroup: true,
          supportsWebhook: true,
          supportsLongPolling: false,
          supportsSocketMode: true,
        },
      ],
    },
    isError: false,
    refetch: vi.fn(),
  }),
  useChannelAllowlistEntries: () => ({ data: { entries: [] }, isError: false, refetch: vi.fn() }),
  useChannelAccountStatus: () => ({ data: { status: mocks.statusData }, isError: false, refetch: vi.fn() }),
  useChannelTestSend: () => ({ isPending: false, mutateAsync: vi.fn(async () => ({ result: { status: "accepted", delivered: true } })) }),
  useChannelPairingRequests: () => ({ data: { requests: [] }, isError: false, refetch: vi.fn() }),
  useApprovePairingRequest: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  useRejectPairingRequest: () => ({ mutateAsync: vi.fn(async () => ({})) }),
  useDeleteChannelAllowlistEntry: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useDeleteChannelAccount: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  usePutChannelAllowlistEntry: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useRunChannelAccountAction: () => ({ mutateAsync: mocks.runAction, isPending: false }),
  useUpdateChannelAccount: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Channel detail connection-first UI", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.runAction.mockClear();
    mocks.statusData.secretsCount = 1;
  });

  it("hides legacy secret form and shows connection panel", () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChannelAccountDetailPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.channels.detail.connectionTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.channels.detail.connectionConnected)).toBeInTheDocument();
    expect(screen.getByText(messages.channels.detail.connectionsConfigured)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Secret name/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Create secret/i)).not.toBeInTheDocument();
  });

  it("shows not-connected status and allows login action", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.statusData.secretsCount = 0;

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChannelAccountDetailPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(messages.channels.detail.connectionNotConnected)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(mocks.runAction).toHaveBeenCalledWith("login"));
  });
});
