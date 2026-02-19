import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import ConversationsPage from "../app/[locale]/(app)/conversations/page";

const mocks = vi.hoisted(() => {
  return {
    push: vi.fn(),
    createSession: vi.fn(async (_input: unknown) => ({ session: { id: "session_1" } })),
    updateOrgSettings: vi.fn(async (_input: unknown) => ({})),
    createPairingToken: vi.fn(async () => ({
      token: "org_1.pairing-token",
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    })),
    archiveSession: vi.fn(async (_sessionId: string) => ({ ok: true })),
    restoreSession: vi.fn(async (_sessionId: string) => ({ ok: true })),
    refetchEngineAuthStatus: vi.fn(async () => ({ data: undefined })),
    onlineExecutorCount: 1,
    sessionsData: [] as any[],
  };
});

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ push: mocks.push }),
    useParams: () => ({ locale: "en" }),
  };
});

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: 1 }, user: { email: "ops@vespid.ai" } } }),
}));

vi.mock("../lib/hooks/use-me", () => ({
  useMe: () => ({ data: { orgs: [{ id: "org_1", roleKey: "owner" }] } }),
}));

vi.mock("../lib/hooks/use-toolsets", () => ({
  useToolsets: () => ({ data: { toolsets: [] }, isError: false, refetch: vi.fn() }),
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => ({ data: { settings: {} }, isError: false, refetch: vi.fn() }),
  useUpdateOrgSettings: () => ({ isPending: false, mutateAsync: mocks.updateOrgSettings }),
}));

vi.mock("../lib/hooks/use-agents", () => ({
  useAgentInstaller: () => ({
    data: {
      provider: "npm-registry",
      delivery: "npm",
      fallbackReason: null,
      packageName: "@vespid/node-agent",
      distTag: "latest",
      registryUrl: "https://registry.npmjs.org",
      docsUrl: "https://docs.vespid.ai/agent",
      commands: {
        connect: 'npx -y @vespid/node-agent@latest connect --pairing-token "<pairing-token>" --api-base "<api-base>"',
        start: "npx -y @vespid/node-agent@latest start",
      },
    },
    isLoading: false,
  }),
  useCreatePairingToken: () => ({ isPending: false, mutateAsync: mocks.createPairingToken }),
}));

vi.mock("../lib/hooks/use-engine-auth-status", () => ({
  useEngineAuthStatus: () => ({
    isSuccess: true,
    data: {
      organizationId: "org_1",
      engines: {
        "gateway.codex.v2": {
          onlineExecutors: mocks.onlineExecutorCount,
          verifiedCount: mocks.onlineExecutorCount,
          unverifiedCount: 0,
          executors: Array.from({ length: mocks.onlineExecutorCount }, (_, idx) => ({
            executorId: `exec_${idx + 1}`,
            name: `Executor ${idx + 1}`,
            verified: true,
            checkedAt: new Date().toISOString(),
            reason: "verified",
          })),
        },
        "gateway.claude.v2": {
          onlineExecutors: mocks.onlineExecutorCount,
          verifiedCount: 0,
          unverifiedCount: mocks.onlineExecutorCount,
          executors: Array.from({ length: mocks.onlineExecutorCount }, (_, idx) => ({
            executorId: `exec_${idx + 1}`,
            name: `Executor ${idx + 1}`,
            verified: false,
            checkedAt: new Date().toISOString(),
            reason: "not_required",
          })),
        },
        "gateway.opencode.v2": {
          onlineExecutors: mocks.onlineExecutorCount,
          verifiedCount: mocks.onlineExecutorCount,
          unverifiedCount: 0,
          executors: Array.from({ length: mocks.onlineExecutorCount }, (_, idx) => ({
            executorId: `exec_${idx + 1}`,
            name: `Executor ${idx + 1}`,
            verified: true,
            checkedAt: new Date().toISOString(),
            reason: "not_required",
          })),
        },
      },
    },
    refetch: mocks.refetchEngineAuthStatus,
    isFetching: false,
  }),
}));

vi.mock("../lib/hooks/use-sessions", () => ({
  useSessions: () => ({ data: { sessions: mocks.sessionsData }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateSession: () => ({ isPending: false, mutateAsync: mocks.createSession }),
  useArchiveSession: () => ({ isPending: false, mutateAsync: mocks.archiveSession }),
  useRestoreSession: () => ({ isPending: false, mutateAsync: mocks.restoreSession }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Conversations create modes", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.createSession.mockClear();
    mocks.updateOrgSettings.mockClear();
    mocks.createPairingToken.mockClear();
    mocks.archiveSession.mockClear();
    mocks.restoreSession.mockClear();
    mocks.refetchEngineAuthStatus.mockReset();
    mocks.refetchEngineAuthStatus.mockResolvedValue({ data: undefined });
    mocks.onlineExecutorCount = 1;
    mocks.sessionsData = [];
  });

  it("submits quick mode payload with minimal defaults", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("conversation-create-layout")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-composer")).toBeInTheDocument();
    expect(screen.getByTestId("session-model-chip")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-recent-list")).toBeInTheDocument();

    await user.type(screen.getByLabelText(messages.sessions.chat.message), "Ship this sprint");
    await user.click(screen.getByRole("button", { name: messages.sessions.chat.send }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    const payload = mocks.createSession.mock.calls[0]?.[0] as any;

    expect(payload.engine.id).toBe("gateway.codex.v2");
    expect(payload.prompt.instructions).toBe("Help me accomplish my task safely and efficiently.");
    expect(payload.tools.allow).toEqual(["connector.action"]);
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("toolsetId");
    expect(payload).not.toHaveProperty("executorSelector");
  });

  it("submits advanced fields when configured", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationsPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.sessions.create.configureAdvanced }));
    await screen.findByText(messages.sessions.create.advancedTitle, { selector: "div" });

    await user.type(screen.getByLabelText(messages.sessions.fields.title), "Ops assistant");
    await user.clear(screen.getByLabelText(messages.sessions.fields.instructions));
    await user.type(screen.getByLabelText(messages.sessions.fields.instructions), "Use policy-safe responses.");
    await user.type(screen.getByLabelText(messages.sessions.fields.system), "System prompt");
    await user.type(screen.getByLabelText(messages.sessions.fields.toolset), "toolset_1");
    await user.type(screen.getByLabelText(messages.sessions.fields.selectorTag), "west");
    await user.click(screen.getByRole("button", { name: messages.common.close }));

    await user.type(screen.getByLabelText(messages.sessions.chat.message), "Summarize incidents");
    await user.click(screen.getByRole("button", { name: messages.sessions.chat.send }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    const payload = mocks.createSession.mock.calls[0]?.[0] as any;

    expect(payload.title).toBe("Ops assistant");
    expect(payload.toolsetId).toBe("toolset_1");
    expect(payload.executorSelector).toEqual({ pool: "byon", tag: "west" });
    expect(payload.prompt.system).toBe("System prompt");
    expect(payload.prompt.instructions).toBe("Use policy-safe responses.");
  });

  it("shows executor onboarding and still allows creating a chat when no executor is online", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.onlineExecutorCount = 0;

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationsPage />
      </NextIntlClientProvider>
    );

    expect(await screen.findByTestId("executor-onboarding-guide")).toBeInTheDocument();
    await waitFor(() => expect(mocks.createPairingToken).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(messages.sessions.chat.message), "Try to start");
    const send = screen.getByRole("button", { name: messages.sessions.chat.send });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.refetchEngineAuthStatus).not.toHaveBeenCalled();
  });

  it("supports list archive and restore actions", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.sessionsData = [
      {
        id: "session_active",
        title: "Active chat",
        status: "active",
        llmProvider: "codex",
        llmModel: "gpt-5-codex",
        lastActivityAt: new Date().toISOString(),
      },
      {
        id: "session_archived",
        title: "Archived chat",
        status: "archived",
        llmProvider: "codex",
        llmModel: "gpt-5-codex",
        lastActivityAt: new Date().toISOString(),
      },
    ];

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationsPage />
      </NextIntlClientProvider>
    );

    const deleteButtons = screen.getAllByRole("button", { name: messages.sessions.actions.delete });
    await user.click(deleteButtons[0]!);
    await waitFor(() => expect(mocks.archiveSession).toHaveBeenCalledWith("session_active"));

    await user.click(screen.getByRole("button", { name: messages.sessions.list.filterArchived }));
    const restoreButtons = screen.getAllByRole("button", { name: messages.sessions.actions.restore });
    await user.click(restoreButtons[0]!);
    await waitFor(() => expect(mocks.restoreSession).toHaveBeenCalledWith("session_archived"));
  });
});
