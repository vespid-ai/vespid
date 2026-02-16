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

const extendedCases: CoreCase[] = [
  {
    channelId: "feishu",
    body: {
      schema: "2.0",
      header: {
        event_id: "feishu-event-1",
        create_time: "1710000200000",
      },
      event: {
        sender: {
          sender_id: { open_id: "ou_sender_1" },
        },
        message: {
          message_id: "om_feishu_1",
          chat_id: "oc_feishu_chat_1",
          chat_type: "p2p",
          content: JSON.stringify({ text: "deploy now" }),
          create_time: "1710000200000",
        },
      },
    },
  },
  {
    channelId: "mattermost",
    body: {
      event: "posted",
      data: {
        channel_type: "D",
        post: JSON.stringify({
          id: "mm-post-1",
          message: "deploy now",
          channel_id: "D123",
          user_id: "mm-user-1",
          create_at: 1710000300000,
        }),
      },
      broadcast: { channel_id: "D123" },
      sender_name: "alice",
    },
  },
  {
    channelId: "bluebubbles",
    body: {
      message: {
        guid: "bb-msg-1",
        text: "deploy now",
        handle: "+15550010",
        chatGuid: "chat123",
        isGroup: false,
        timestamp: "2026-02-16T12:00:00.000Z",
      },
      sender: {
        displayName: "Alice",
      },
    },
  },
  {
    channelId: "msteams",
    body: {
      type: "message",
      id: "teams-msg-1",
      text: "<at>bot-1</at> deploy now",
      from: { id: "29:user-1", name: "Alice" },
      recipient: { id: "bot-1", name: "Vespid Bot" },
      conversation: { id: "conv-1", conversationType: "channel" },
      entities: [{ type: "mention", mentioned: { id: "bot-1", name: "Vespid Bot" } }],
      timestamp: "2026-02-16T11:59:00.000Z",
    },
    query: { botId: "bot-1" },
  },
  {
    channelId: "line",
    body: {
      destination: "Ubot",
      events: [
        {
          type: "message",
          timestamp: 1710000100000,
          source: { type: "user", userId: "U123" },
          message: { id: "line-msg-1", type: "text", text: "deploy now" },
          webhookEventId: "line-event-1",
        },
      ],
    },
  },
  {
    channelId: "nextcloud-talk",
    body: {
      message: {
        id: "nc-msg-1",
        message: "deploy now",
        actorId: "nc-user-1",
        actorDisplayName: "Alice",
        chat_id: "nc-chat-1",
        conversationType: "oneToOne",
        timestamp: 1710000400000,
      },
      conversation: { token: "nc-chat-1", type: "oneToOne" },
    },
  },
  {
    channelId: "matrix",
    body: {
      event_id: "$abc",
      sender: "@alice:example.org",
      room_id: "!room:example.org",
      origin_server_ts: 1710000110000,
      content: {
        body: "@vespid deploy now",
        "m.mentions": { user_ids: ["@bot:example.org"] },
      },
    },
    query: { botUserId: "@bot:example.org" },
  },
  {
    channelId: "nostr",
    body: {
      event: {
        id: "nostr-event-1",
        pubkey: "nostr-user-1",
        kind: 1,
        created_at: 1710000700,
        content: "deploy now",
        tags: [["p", "nostr-bot-1"], ["e", "thread-1"]],
      },
    },
    query: { botPubKey: "nostr-bot-1" },
  },
  {
    channelId: "tlon",
    body: {
      message: {
        id: "tlon-msg-1",
        text: "deploy now",
        ship: "~zod",
        channel: "group:ops",
        mentions: ["~bot"],
      },
    },
    query: { botShip: "~bot" },
  },
  {
    channelId: "twitch",
    body: {
      subscription: { type: "channel.chat.message" },
      event: {
        message_id: "tw-msg-1",
        broadcaster_user_id: "broadcaster-1",
        chatter_user_id: "chatter-1",
        chatter_user_name: "alice",
        message: {
          text: "deploy now @vespid",
          fragments: [{ type: "text", text: "deploy now @vespid" }],
        },
      },
    },
  },
  {
    channelId: "zalo",
    body: {
      event_name: "user_send_text",
      sender: { id: "zalo-user-1", name: "Alice" },
      message: { msg_id: "zalo-msg-1", text: "deploy now" },
      timestamp: 1710000800000,
    },
  },
  {
    channelId: "zalouser",
    body: {
      message: {
        id: "zu-msg-1",
        text: "deploy now",
        sender: { id: "zu-user-1", name: "Alice" },
        conversation: { id: "zu-conv-1", type: "group" },
        mentions: [{ id: "zu-bot-1" }],
      },
      timestamp: 1710000900000,
    },
    query: { botUserId: "zu-bot-1" },
  },
  {
    channelId: "webchat",
    body: {
      message: {
        id: "wc-msg-1",
        text: "deploy now",
        author: { id: "wc-user-1", name: "Alice" },
        room: { id: "dm:wc-user-1", type: "direct" },
      },
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

  it("routes extended channel inbound messages to session bridge and workflow trigger", async () => {
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

    for (const testCase of extendedCases) {
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

    expect(redis.xadd).toHaveBeenCalledTimes(extendedCases.length);
    expect(fetchMock).toHaveBeenCalledTimes(extendedCases.length);

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain("/internal/v1/channels/trigger-run");
      expect((call[1] as { headers?: Record<string, string> }).headers?.["x-service-token"]).toBe("svc-token");
    }
  });

  it("returns normalize_failed for malformed payload across all channels", async () => {
    const manager = createChannelRuntimeManager({
      pool: {} as never,
      redis: createRedisMock() as never,
      edgeId: "edge-1",
      logger: { info: vi.fn(), error: vi.fn() } as never,
      apiBaseUrl: "http://api.internal",
      serviceToken: "svc-token",
    });

    for (const testCase of [...coreCases, ...extendedCases]) {
      dbMocks.getChannelAccountByChannelAndKeyGlobal.mockResolvedValue(baseAccount(testCase.channelId));
      const result = await manager.handleWebhook({
        channelId: testCase.channelId,
        accountKey: "main",
        headers: testCase.headers ?? {},
        query: testCase.query ?? {},
        body: {},
        requestId: `req-bad-${testCase.channelId}`,
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe("normalize_failed");
      expect(result.workflowsTriggered).toBe(0);
      expect(result.sessionRouted).toBe(false);
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

    const result = await manager.sendSessionReply({
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

    expect(result.delivered).toBe(false);
    expect(result.status).toBe("dead_letter");
    expect(result.error).toContain("CHANNEL_OUTBOUND_FAILED:500");
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
