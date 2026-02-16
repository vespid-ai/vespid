import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChannelId } from "@vespid/shared";
import {
  createBluebubblesWebhookAdapter,
  createDiscordWebhookAdapter,
  createFeishuWebhookAdapter,
  createGoogleChatWebhookAdapter,
  createImessageWebhookAdapter,
  createIrcWebhookAdapter,
  createLineWebhookAdapter,
  createMattermostWebhookAdapter,
  createMatrixWebhookAdapter,
  createMsteamsWebhookAdapter,
  createSignalWebhookAdapter,
  createSlackWebhookAdapter,
  createTelegramWebhookAdapter,
  createWhatsappWebhookAdapter,
} from "./core.js";
import { createDefaultChannelIngressAdapterRegistry } from "../registry.js";

function inputFor(channelId: ChannelId, body: unknown, options?: {
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
}) {
  return {
    channelId,
    accountId: "acc-1",
    accountKey: "main",
    organizationId: "org-1",
    body,
    headers: options?.headers ?? {},
    query: options?.query ?? {},
    receivedAt: new Date("2026-02-16T12:00:00.000Z"),
  };
}

describe("core channel adapters", () => {
  it("normalizes whatsapp inbound payload", () => {
    const adapter = createWhatsappWebhookAdapter();
    const envelope = adapter.normalizeWebhook(
      inputFor("whatsapp", {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: "wamid.1", from: "15550001", timestamp: "1710000010", text: { body: "hello" } }],
                  contacts: [{ profile: { name: "Alice" } }],
                },
              },
            ],
          },
        ],
      })
    );

    expect(envelope?.channelId).toBe("whatsapp");
    expect(envelope?.providerMessageId).toBe("wamid.1");
    expect(envelope?.senderId).toBe("15550001");
    expect(envelope?.event).toBe("message.dm");
  });

  it("normalizes telegram group mention", () => {
    const adapter = createTelegramWebhookAdapter();
    const envelope = adapter.normalizeWebhook(
      inputFor(
        "telegram",
        {
          update_id: 1000,
          message: {
            message_id: 77,
            date: 1710000020,
            text: "@vespid deploy now",
            from: { id: 501, username: "ops-user" },
            chat: { id: -9001, type: "supergroup" },
          },
        },
        { query: { botUsername: "@vespid" } }
      )
    );

    expect(envelope?.channelId).toBe("telegram");
    expect(envelope?.conversationId).toBe("-9001");
    expect(envelope?.event).toBe("message.mentioned");
    expect(envelope?.mentionMatched).toBe(true);
  });

  it("verifies discord signature and normalizes message", () => {
    const adapter = createDiscordWebhookAdapter();

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicSpki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const publicHex = publicSpki.subarray(-32).toString("hex");

    const body = {
      id: "dmsg-1",
      channel_id: "chan-1",
      guild_id: "guild-1",
      content: "hello <@bot-1>",
      author: { id: "user-1", username: "alice" },
      mentions: [{ id: "bot-1" }],
      timestamp: "2026-02-16T11:58:00.000Z",
    };

    const timestamp = "1710000030";
    const payload = Buffer.from(`${timestamp}${JSON.stringify(body)}`, "utf8");
    const signature = crypto.sign(null, payload, privateKey).toString("hex");

    const authResult = adapter.authenticateWebhook?.({
      ...inputFor("discord", body, {
        headers: {
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
      }),
      accountMetadata: {
        discordPublicKey: publicHex,
      },
    });
    expect(authResult?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(inputFor("discord", body, { query: { botUserId: "bot-1" } }));
    expect(envelope?.channelId).toBe("discord");
    expect(envelope?.event).toBe("message.mentioned");
    expect(envelope?.mentionMatched).toBe(true);
  });

  it("normalizes irc message with mention", () => {
    const adapter = createIrcWebhookAdapter();
    const envelope = adapter.normalizeWebhook(
      inputFor(
        "irc",
        {
          nick: "carol",
          target: "#ops",
          message: "vespid: run deploy",
          timestamp: 1710000040000,
        },
        { query: { botNick: "vespid" } }
      )
    );

    expect(envelope?.conversationId).toBe("#ops");
    expect(envelope?.event).toBe("message.mentioned");
  });

  it("validates slack signature", () => {
    const adapter = createSlackWebhookAdapter();
    const body = {
      event: {
        type: "app_mention",
        text: "<@U-BOT> ping",
        user: "U-1",
        channel: "C-1",
        event_ts: "1710000050.001",
      },
    };

    const ts = Math.floor(new Date("2026-02-16T12:00:00.000Z").getTime() / 1000).toString();
    const raw = JSON.stringify(body);
    const signature = `v0=${crypto.createHmac("sha256", "slack-secret").update(`v0:${ts}:${raw}`, "utf8").digest("hex")}`;

    const authOk = adapter.authenticateWebhook?.({
      ...inputFor("slack", body, {
        headers: {
          "x-slack-signature": signature,
          "x-slack-request-timestamp": ts,
        },
      }),
      accountMetadata: {
        signingSecret: "slack-secret",
      },
    });
    expect(authOk?.ok).toBe(true);

    const authFailed = adapter.authenticateWebhook?.({
      ...inputFor("slack", body, {
        headers: {
          "x-slack-signature": "v0=badsig",
          "x-slack-request-timestamp": ts,
        },
      }),
      accountMetadata: {
        signingSecret: "slack-secret",
      },
    });
    expect(authFailed).toEqual({ ok: false, reason: "slack_signature_invalid" });

    const envelope = adapter.normalizeWebhook(inputFor("slack", body, { query: { botUserId: "U-BOT" } }));
    expect(envelope?.event).toBe("message.mentioned");
  });

  it("normalizes google chat direct message", () => {
    const adapter = createGoogleChatWebhookAdapter();
    const envelope = adapter.normalizeWebhook(
      inputFor("googlechat", {
        eventTime: "2026-02-16T11:59:00.000Z",
        message: {
          name: "spaces/AAA/messages/BBB",
          text: "hello",
          sender: { name: "users/123", displayName: "Alice" },
          space: { name: "spaces/AAA", type: "DIRECT_MESSAGE" },
        },
      })
    );

    expect(envelope?.event).toBe("message.dm");
    expect(envelope?.conversationId).toBe("spaces/AAA");
  });

  it("validates signal ingress token and normalizes envelope", () => {
    const adapter = createSignalWebhookAdapter();

    const auth = adapter.authenticateWebhook?.({
      ...inputFor(
        "signal",
        {
          envelope: {
            source: "+15550002",
            timestamp: 1710000060000,
            dataMessage: { message: "deploy", groupInfo: { groupId: "group-1" } },
          },
        },
        {
          headers: {
            "x-signal-token": "signal-token",
          },
        }
      ),
      accountMetadata: {
        ingressToken: "signal-token",
      },
    });

    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(
      inputFor("signal", {
        envelope: {
          source: "+15550002",
          timestamp: 1710000060000,
          dataMessage: { message: "deploy", groupInfo: { groupId: "group-1" } },
        },
      })
    );

    expect(envelope?.conversationId).toBe("group-1");
    expect(envelope?.event).toBe("message.received");
  });

  it("validates imessage token and normalizes inbound", () => {
    const adapter = createImessageWebhookAdapter();

    const auth = adapter.authenticateWebhook?.({
      ...inputFor("imessage", { guid: "g-1", text: "hello", handle: "+15550003", chatGuid: "chat-1" }, {
        headers: { "x-imessage-token": "imessage-token" },
      }),
      accountMetadata: {
        ingressToken: "imessage-token",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(
      inputFor("imessage", { guid: "g-1", text: "hello", handle: "+15550003", chatGuid: "chat-1", isGroup: true })
    );
    expect(envelope?.providerMessageId).toBe("g-1");
    expect(envelope?.event).toBe("message.received");
  });

  it("validates feishu token and normalizes p2p text message", () => {
    const adapter = createFeishuWebhookAdapter();
    const body = {
      schema: "2.0",
      header: {
        event_id: "feishu-event-1",
        token: "feishu-token",
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
          mentions: [{ id: "ou_bot_1", key: "@_user_1" }],
        },
      },
    };

    const auth = adapter.authenticateWebhook?.({
      ...inputFor("feishu", body, { query: { botOpenId: "ou_bot_1" } }),
      accountMetadata: {
        verificationToken: "feishu-token",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(inputFor("feishu", body, { query: { botOpenId: "ou_bot_1" } }));
    expect(envelope?.channelId).toBe("feishu");
    expect(envelope?.event).toBe("message.dm");
    expect(envelope?.mentionMatched).toBe(true);
    expect(envelope?.conversationId).toBe("oc_feishu_chat_1");
  });

  it("validates mattermost token and normalizes posted webhook", () => {
    const adapter = createMattermostWebhookAdapter();
    const body = {
      token: "mattermost-token",
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
    };

    const auth = adapter.authenticateWebhook?.({
      ...inputFor("mattermost", body),
      accountMetadata: {
        ingressToken: "mattermost-token",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(inputFor("mattermost", body));
    expect(envelope?.channelId).toBe("mattermost");
    expect(envelope?.event).toBe("message.dm");
    expect(envelope?.senderId).toBe("mm-user-1");
  });

  it("validates bluebubbles signature and normalizes message", () => {
    const adapter = createBluebubblesWebhookAdapter();
    const body = {
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
    };

    const signature = crypto.createHmac("sha256", "bb-secret").update(JSON.stringify(body), "utf8").digest("hex");
    const auth = adapter.authenticateWebhook?.({
      ...inputFor("bluebubbles", body, {
        headers: { "x-bluebubbles-signature": signature },
      }),
      accountMetadata: {
        webhookSecret: "bb-secret",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(inputFor("bluebubbles", body));
    expect(envelope?.channelId).toBe("bluebubbles");
    expect(envelope?.event).toBe("message.dm");
    expect(envelope?.providerMessageId).toBe("bb-msg-1");
  });

  it("validates msteams token and normalizes mention message", () => {
    const adapter = createMsteamsWebhookAdapter();

    const auth = adapter.authenticateWebhook?.({
      ...inputFor(
        "msteams",
        {
          type: "message",
          id: "teams-msg-1",
          text: "<at>bot-1</at> deploy now",
          from: { id: "29:user-1", name: "Alice" },
          recipient: { id: "bot-1", name: "Vespid Bot" },
          conversation: { id: "conv-1", conversationType: "channel" },
          entities: [{ type: "mention", mentioned: { id: "bot-1", name: "Vespid Bot" } }],
          timestamp: "2026-02-16T11:59:00.000Z",
        },
        {
          headers: { "x-msteams-token": "teams-token" },
          query: { botId: "bot-1" },
        }
      ),
      accountMetadata: {
        ingressToken: "teams-token",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(
      inputFor(
        "msteams",
        {
          type: "message",
          id: "teams-msg-1",
          text: "<at>bot-1</at> deploy now",
          from: { id: "29:user-1", name: "Alice" },
          recipient: { id: "bot-1", name: "Vespid Bot" },
          conversation: { id: "conv-1", conversationType: "channel" },
          entities: [{ type: "mention", mentioned: { id: "bot-1", name: "Vespid Bot" } }],
          timestamp: "2026-02-16T11:59:00.000Z",
        },
        { query: { botId: "bot-1" } }
      )
    );
    expect(envelope?.channelId).toBe("msteams");
    expect(envelope?.event).toBe("message.mentioned");
    expect(envelope?.conversationId).toBe("conv-1");
  });

  it("validates line signature and normalizes direct message", () => {
    const adapter = createLineWebhookAdapter();
    const body = {
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
    };
    const signature = crypto.createHmac("sha256", "line-secret").update(JSON.stringify(body), "utf8").digest("base64");

    const auth = adapter.authenticateWebhook?.({
      ...inputFor("line", body, { headers: { "x-line-signature": signature } }),
      accountMetadata: {
        channelSecret: "line-secret",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(inputFor("line", body));
    expect(envelope?.channelId).toBe("line");
    expect(envelope?.event).toBe("message.dm");
    expect(envelope?.senderId).toBe("U123");
  });

  it("validates matrix token and normalizes room mention", () => {
    const adapter = createMatrixWebhookAdapter();
    const auth = adapter.authenticateWebhook?.({
      ...inputFor(
        "matrix",
        {
          event_id: "$abc",
          sender: "@alice:example.org",
          room_id: "!room:example.org",
          origin_server_ts: 1710000110000,
          content: {
            body: "@vespid deploy now",
            "m.mentions": { user_ids: ["@bot:example.org"] },
          },
        },
        {
          headers: { "x-matrix-token": "matrix-token" },
          query: { botUserId: "@bot:example.org" },
        }
      ),
      accountMetadata: {
        ingressToken: "matrix-token",
      },
    });
    expect(auth?.ok).toBe(true);

    const envelope = adapter.normalizeWebhook(
      inputFor(
        "matrix",
        {
          event_id: "$abc",
          sender: "@alice:example.org",
          room_id: "!room:example.org",
          origin_server_ts: 1710000110000,
          content: {
            body: "@vespid deploy now",
            "m.mentions": { user_ids: ["@bot:example.org"] },
          },
        },
        { query: { botUserId: "@bot:example.org" } }
      )
    );
    expect(envelope?.channelId).toBe("matrix");
    expect(envelope?.event).toBe("message.mentioned");
    expect(envelope?.conversationId).toBe("!room:example.org");
  });

  it("registers dedicated adapters for core8 + selected extended and generic adapter for others", () => {
    const registry = createDefaultChannelIngressAdapterRegistry();
    const slackAdapter = registry.get("slack");
    const feishuAdapter = registry.get("feishu");
    const mattermostAdapter = registry.get("mattermost");
    const bluebubblesAdapter = registry.get("bluebubbles");
    const msteamsAdapter = registry.get("msteams");
    const lineAdapter = registry.get("line");
    const matrixAdapter = registry.get("matrix");
    const webchatAdapter = registry.get("webchat");

    expect(slackAdapter).not.toBeNull();
    expect(typeof slackAdapter?.authenticateWebhook).toBe("function");
    expect(feishuAdapter).not.toBeNull();
    expect(typeof feishuAdapter?.authenticateWebhook).toBe("function");
    expect(mattermostAdapter).not.toBeNull();
    expect(typeof mattermostAdapter?.authenticateWebhook).toBe("function");
    expect(bluebubblesAdapter).not.toBeNull();
    expect(typeof bluebubblesAdapter?.authenticateWebhook).toBe("function");
    expect(msteamsAdapter).not.toBeNull();
    expect(typeof msteamsAdapter?.authenticateWebhook).toBe("function");
    expect(lineAdapter).not.toBeNull();
    expect(typeof lineAdapter?.authenticateWebhook).toBe("function");
    expect(matrixAdapter).not.toBeNull();
    expect(typeof matrixAdapter?.authenticateWebhook).toBe("function");
    expect(webchatAdapter).not.toBeNull();
    expect(webchatAdapter?.authenticateWebhook).toBeUndefined();
  });
});
