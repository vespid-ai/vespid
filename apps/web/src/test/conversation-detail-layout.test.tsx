import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import ConversationDetailPage from "../app/[locale]/(app)/conversations/[conversationId]/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  sessionData: {
    session: {
      id: "session_1",
      title: "Ops Chat",
    },
  },
  eventsData: {
    events: [
      {
        id: "event_1",
        organizationId: "org_1",
        sessionId: "session_1",
        seq: 1,
        eventType: "user_message",
        level: "info",
        handoffFromAgentId: null,
        handoffToAgentId: null,
        idempotencyKey: null,
        payload: { message: "Need an incident summary." },
        createdAt: "2026-02-17T10:00:00.000Z",
      },
      {
        id: "event_2",
        organizationId: "org_1",
        sessionId: "session_1",
        seq: 2,
        eventType: "agent_message",
        level: "info",
        handoffFromAgentId: null,
        handoffToAgentId: null,
        idempotencyKey: null,
        payload: { message: "Summarizing now." },
        createdAt: "2026-02-17T10:00:05.000Z",
      },
    ],
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useParams: () => ({ locale: "en", conversationId: "session_1" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: Date.now() + 60_000 }, user: { email: "ops@vespid.ai" } } }),
}));

vi.mock("../lib/hooks/use-sessions", () => ({
  useSession: () => ({
    isLoading: false,
    isError: false,
    data: mocks.sessionData,
    refetch: vi.fn(),
  }),
  useSessionEvents: () => ({
    isLoading: false,
    isError: false,
    data: mocks.eventsData,
    refetch: vi.fn(),
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;

  url: string;

  readyState = 1;

  onopen: ((event: Event) => void) | null = null;

  onclose: (() => void) | null = null;

  onerror: (() => void) | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;

  send = vi.fn();

  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(new Event("open")), 0);
  }
}

describe("Conversation detail layout", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the simplified stream and keeps send behavior intact", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConversationDetailPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("conversation-detail-layout")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-message-stream")).toBeInTheDocument();
    expect(screen.getByText(messages.sessions.chat.roleUser)).toBeInTheDocument();
    expect(screen.getByText(messages.sessions.chat.roleAssistant)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.sessions.ws.reconnect })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(messages.sessions.ws.connected)).toBeInTheDocument();
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });

    const input = screen.getByPlaceholderText(messages.sessions.chat.placeholder);
    await user.type(input, "Ping the node{enter}");

    await waitFor(() => {
      const sent = FakeWebSocket.instances[0]?.send.mock.calls.map((call) => JSON.parse(call[0]));
      expect(sent?.some((payload: any) => payload.type === "session_send" && payload.message === "Ping the node")).toBe(true);
    });
  });
});
