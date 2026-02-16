import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelId } from "@vespid/shared";

const dbMocks = vi.hoisted(() => ({
  appendAgentSessionEvent: vi.fn(),
  appendChannelEvent: vi.fn(),
  createChannelMessage: vi.fn(),
  createPool: vi.fn(),
  createChannelPairingRequest: vi.fn(),
  createDb: vi.fn(),
  getAgentSessionById: vi.fn(),
  getChannelAccountByChannelAndKeyGlobal: vi.fn(),
  getChannelAccountById: vi.fn(),
  listChannelAllowlistEntries: vi.fn(),
  listWorkflows: vi.fn(),
  upsertChannelConversation: vi.fn(),
  withTenantContext: vi.fn(),
}));

vi.mock("@vespid/db", () => dbMocks);

import { createChannelRuntimeManager } from "./manager.js";

type CoreCase = {
  channelId: ChannelId;
  body: unknown;
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
};

const coreCases: CoreCase[] = [
  {
    channelId: "whatsapp",
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid-1",
                    from: "sender-whatsapp",
                    timestamp: "1710000010",
                    text: { body: "deploy now" },
                  },
                ],
                contacts: [{ profile: { name: "Alice" } }],
              },
            },
          ],
        },
      ],
    },
  },
  {
    channelId: "telegram",
    body: {
      update_id: 100,
      message: {
        message_id: 200,
        date: 1710000020,
        text: "deploy now",
        from: { id: 5001, username: "alice" },
        chat: { id: 5001, type: "private" },
      },
    },
  },
  {
    channelId: "discord",
    body: {
      id: "discord-msg-1",
      channel_id: "discord-chan-1",
      guild_id: "guild-1",
      content: "deploy now",
      author: { id: "sender-discord", username: "alice" },
      mentions: [],
      timestamp: "2026-02-16T12:00:00.000Z",
    },
  },
  {
    channelId: "irc",
    body: {
      messageId: "irc-1",
      nick: "sender-irc",
      target: "#ops",
      message: "deploy now",
      timestamp: 1710000040000,
    },
  },
  {
    channelId: "slack",
    body: {
      event: {
        type: "message",
        text: "deploy now",
        user: "sender-slack",
        channel: "D12345",
        channel_type: "im",
        ts: "1710000050.0001",
      },
    },
  },
  {
    channelId: "googlechat",
    body: {
      eventTime: "2026-02-16T12:00:00.000Z",
      message: {
        name: "spaces/AAA/messages/BBB",
        text: "deploy now",
        sender: { name: "sender-googlechat", displayName: "Alice" },
        space: { name: "spaces/AAA", type: "DIRECT_MESSAGE" },
      },
    },
  },
  {
    channelId: "signal",
    body: {
      envelope: {
        source: "sender-signal",
        timestamp: 1710000060000,
        dataMessage: { message: "deploy now" },
      },
    },
  },
  {
    channelId: "imessage",
    body: {
      guid: "imessage-1",
      text: "deploy now",
      handle: "sender-imessage",
      chatGuid: "sender-imessage",
      isGroup: false,
    },
  },
];

function baseAccount(channelId: ChannelId) {
  return {
    id: `acc-${channelId}`,
    organizationId: "org-1",
    updatedByUserId: "user-1",
    enabled: true,
    channelId,
    accountKey: "main",
    dmPolicy: "open",
    groupPolicy: "open",
    requireMentionInGroup: false,
    metadata: {
      defaultSessionId: "session-1",
      sessionBridgeEnabled: true,
    },
    webhookUrl: "https://channels.example/outbound",
  };
}

function createRedisMock() {
  return {
    set: vi.fn().mockResolvedValue("OK"),
    xadd: vi.fn().mockResolvedValue("1-0"),
  };
}

describe("channel runtime manager", () => {
  const envBackup = {
    runtime: process.env.CHANNEL_RUNTIME_ENABLED,
    outboundAttempts: process.env.CHANNEL_OUTBOUND_MAX_ATTEMPTS,
    outboundBackoff: process.env.CHANNEL_OUTBOUND_RETRY_BASE_MS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHANNEL_RUNTIME_ENABLED = "1";
    process.env.CHANNEL_OUTBOUND_MAX_ATTEMPTS = "2";
    process.env.CHANNEL_OUTBOUND_RETRY_BASE_MS = "10";

    dbMocks.createDb.mockReturnValue({});
    dbMocks.withTenantContext.mockImplementation(async (_pool: unknown, _context: unknown, fn: (db: unknown) => Promise<unknown>) =>
      fn({})
    );
    dbMocks.listChannelAllowlistEntries.mockResolvedValue([{ scope: "sender", subject: "*" }]);
    dbMocks.upsertChannelConversation.mockResolvedValue({ sessionId: null });
    dbMocks.getAgentSessionById.mockResolvedValue({ id: "session-1" });
    dbMocks.appendAgentSessionEvent.mockResolvedValue({
      seq: 101,
      eventType: "user_message",
      level: "info",
      payload: { message: "deploy now" },
      createdAt: new Date("2026-02-16T12:00:00.000Z"),
    });
    dbMocks.createChannelMessage.mockResolvedValue({});
    dbMocks.appendChannelEvent.mockResolvedValue({});
    dbMocks.createChannelPairingRequest.mockResolvedValue({});
    dbMocks.getChannelAccountById.mockResolvedValue(baseAccount("telegram"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.CHANNEL_RUNTIME_ENABLED = envBackup.runtime;
    process.env.CHANNEL_OUTBOUND_MAX_ATTEMPTS = envBackup.outboundAttempts;
    process.env.CHANNEL_OUTBOUND_RETRY_BASE_MS = envBackup.outboundBackoff;
  });

  it("routes Core8 inbound messages to session bridge and workflow trigger", async () => {
    const redis = createRedisMock();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("{\"ok\":true}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const manager = createChannelRuntimeManager({
      pool: {} as never,
      redis: redis as never,
      edgeId: "edge-1",
      logger: { info: vi.fn(), error: vi.fn() } as never,
      apiBaseUrl: "http://api.internal",
      serviceToken: "svc-token",
    });

    for (const testCase of coreCases) {
      dbMocks.getChannelAccountByChannelAndKeyGlobal.mockResolvedValue(baseAccount(testCase.channelId));
      dbMocks.listWorkflows.mockResolvedValue({
        rows: [
          {
            id: `wf-${testCase.channelId}`,
            status: "published",
            createdByUserId: "user-1",
            dsl: {
              version: "v2",
              trigger: {
                type: "trigger.channel",
                config: {
                  channelId: testCase.channelId,
                  accountKey: "main",
                  match: { textContains: "deploy" },
                },
              },
              nodes: [{ id: "n1", type: "agent.execute" }],
            },
          },
        ],
      });

      const result = await manager.handleWebhook({
        channelId: testCase.channelId,
        accountKey: "main",
        headers: testCase.headers ?? {},
        query: testCase.query ?? {},
        body: testCase.body,
        requestId: `req-${testCase.channelId}`,
      });

      expect(result.accepted).toBe(true);
      expect(result.sessionRouted).toBe(true);
      expect(result.workflowsTriggered).toBe(1);
    }

    expect(redis.xadd).toHaveBeenCalledTimes(coreCases.length);
    expect(fetchMock).toHaveBeenCalledTimes(coreCases.length);

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain("/internal/v1/channels/trigger-run");
      expect((call[1] as { headers?: Record<string, string> }).headers?.["x-service-token"]).toBe("svc-token");
    }
  });

  it("drops ingress when adapter authentication fails", async () => {
    dbMocks.getChannelAccountByChannelAndKeyGlobal.mockResolvedValue({
      ...baseAccount("slack"),
      metadata: {
        defaultSessionId: "session-1",
        signingSecret: "slack-secret",
      },
    });

    const manager = createChannelRuntimeManager({
      pool: {} as never,
      redis: createRedisMock() as never,
      edgeId: "edge-1",
      logger: { info: vi.fn(), error: vi.fn() } as never,
      apiBaseUrl: "http://api.internal",
      serviceToken: "svc-token",
    });

    const result = await manager.handleWebhook({
      channelId: "slack",
      accountKey: "main",
      headers: {},
      query: {},
      body: {
        event: {
          type: "message",
          text: "deploy now",
          user: "sender-slack",
          channel: "D12345",
          channel_type: "im",
        },
      },
      requestId: "req-auth-fail",
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("slack_signature_missing");
    expect(dbMocks.createChannelMessage).not.toHaveBeenCalled();
  });

  it("retries outbound and marks dead letter on repeated failures", async () => {
    dbMocks.getChannelAccountById.mockResolvedValue({
      ...baseAccount("telegram"),
      webhookUrl: "https://channel.example/outbound",
    });

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("upstream failed", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const manager = createChannelRuntimeManager({
      pool: {} as never,
      redis: createRedisMock() as never,
      edgeId: "edge-1",
      logger: { info: vi.fn(), error: vi.fn() } as never,
      apiBaseUrl: "http://api.internal",
      serviceToken: "svc-token",
    });

    await manager.sendSessionReply({
      organizationId: "org-1",
      sessionId: "session-1",
      sessionEventSeq: 203,
      source: {
        channelId: "telegram",
        accountId: "acc-telegram",
        accountKey: "main",
        conversationId: "conv-1",
        providerMessageId: "provider-1",
        mentionMatched: false,
        event: "message.dm",
      },
      text: "ack",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dbMocks.createChannelMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        accountId: "acc-telegram",
        direction: "outbound",
        status: "dead_letter",
        attemptCount: 2,
        sessionEventSeq: 203,
      })
    );
  });
});
