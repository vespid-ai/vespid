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

vi.mock("../lib/hooks/use-sessions", () => ({
  useSessions: () => ({ data: { sessions: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateSession: () => ({ isPending: false, mutateAsync: mocks.createSession }),
}));

vi.mock("../components/app/llm/llm-config-field", () => ({
  LlmConfigField: () => <div data-testid="llm-config-field" />,
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
  });

  it("submits quick mode payload with minimal defaults", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationsPage />
      </NextIntlClientProvider>
    );

    await user.type(screen.getByLabelText(messages.sessions.chat.message), "Ship this sprint");
    await user.click(screen.getByRole("button", { name: messages.sessions.chat.send }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    const payload = mocks.createSession.mock.calls[0]?.[0] as any;

    expect(payload.engineId).toBe("gateway.loop.v2");
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
    expect(payload.executorSelector).toEqual({ pool: "managed", tag: "west" });
    expect(payload.prompt.system).toBe("System prompt");
    expect(payload.prompt.instructions).toBe("Use policy-safe responses.");
  });
});
