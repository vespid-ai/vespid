import { pathToFileURL } from "node:url";

export type ChannelId =
  | "whatsapp"
  | "telegram"
  | "discord"
  | "irc"
  | "slack"
  | "googlechat"
  | "signal"
  | "imessage"
  | "feishu"
  | "mattermost"
  | "bluebubbles"
  | "msteams"
  | "line"
  | "nextcloud-talk"
  | "matrix"
  | "nostr"
  | "tlon"
  | "twitch"
  | "zalo"
  | "zalouser"
  | "webchat";

export const CHANNEL_IDS = [
  "whatsapp",
  "telegram",
  "discord",
  "irc",
  "slack",
  "googlechat",
  "signal",
  "imessage",
  "feishu",
  "mattermost",
  "bluebubbles",
  "msteams",
  "line",
  "nextcloud-talk",
  "matrix",
  "nostr",
  "tlon",
  "twitch",
  "zalo",
  "zalouser",
  "webchat",
] as const satisfies readonly ChannelId[];

export type ChannelCase = {
  happyBody: unknown;
};

export const CHANNEL_CASES: Record<ChannelId, ChannelCase> = {
  whatsapp: {
    happyBody: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "smoke-wa-1",
                    from: "smoke-whatsapp-user",
                    timestamp: "1710000010",
                    text: { body: "deploy now" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  telegram: {
    happyBody: {
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
  discord: {
    happyBody: {
      id: "smoke-discord-1",
      channel_id: "discord-chan-1",
      guild_id: "guild-1",
      content: "deploy now",
      author: { id: "sender-discord", username: "alice" },
      mentions: [],
      timestamp: "2026-02-16T12:00:00.000Z",
    },
  },
  irc: {
    happyBody: {
      messageId: "smoke-irc-1",
      nick: "sender-irc",
      target: "#ops",
      message: "deploy now",
      timestamp: 1710000040000,
    },
  },
  slack: {
    happyBody: {
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
  googlechat: {
    happyBody: {
      eventTime: "2026-02-16T12:00:00.000Z",
      message: {
        name: "spaces/AAA/messages/BBB",
        text: "deploy now",
        sender: { name: "sender-googlechat", displayName: "Alice" },
        space: { name: "spaces/AAA", type: "DIRECT_MESSAGE" },
      },
    },
  },
  signal: {
    happyBody: {
      envelope: {
        source: "sender-signal",
        timestamp: 1710000060000,
        dataMessage: { message: "deploy now" },
      },
    },
  },
  imessage: {
    happyBody: {
      guid: "smoke-imessage-1",
      text: "deploy now",
      handle: "sender-imessage",
      chatGuid: "sender-imessage",
      isGroup: false,
    },
  },
  feishu: {
    happyBody: {
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
  mattermost: {
    happyBody: {
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
  bluebubbles: {
    happyBody: {
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
  msteams: {
    happyBody: {
      type: "message",
      id: "teams-msg-1",
      text: "<at>bot-1</at> deploy now",
      from: { id: "29:user-1", name: "Alice" },
      recipient: { id: "bot-1", name: "Vespid Bot" },
      conversation: { id: "conv-1", conversationType: "channel" },
      entities: [{ type: "mention", mentioned: { id: "bot-1", name: "Vespid Bot" } }],
      timestamp: "2026-02-16T11:59:00.000Z",
    },
  },
  line: {
    happyBody: {
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
  "nextcloud-talk": {
    happyBody: {
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
  matrix: {
    happyBody: {
      event_id: "$abc",
      sender: "@alice:example.org",
      room_id: "!room:example.org",
      origin_server_ts: 1710000110000,
      content: {
        body: "@vespid deploy now",
        "m.mentions": { user_ids: ["@bot:example.org"] },
      },
    },
  },
  nostr: {
    happyBody: {
      event: {
        id: "nostr-event-1",
        pubkey: "nostr-user-1",
        kind: 1,
        created_at: 1710000700,
        content: "deploy now",
        tags: [["p", "nostr-bot-1"], ["e", "thread-1"]],
      },
    },
  },
  tlon: {
    happyBody: {
      message: {
        id: "tlon-msg-1",
        text: "deploy now",
        ship: "~zod",
        channel: "group:ops",
        mentions: ["~bot"],
      },
    },
  },
  twitch: {
    happyBody: {
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
  zalo: {
    happyBody: {
      event_name: "user_send_text",
      sender: { id: "zalo-user-1", name: "Alice" },
      message: { msg_id: "zalo-msg-1", text: "deploy now" },
      timestamp: 1710000800000,
    },
  },
  zalouser: {
    happyBody: {
      message: {
        id: "zu-msg-1",
        text: "deploy now",
        sender: { id: "zu-user-1", name: "Alice" },
        conversation: { id: "zu-conv-1", type: "group" },
        mentions: [{ id: "zu-bot-1" }],
      },
      timestamp: 1710000900000,
    },
  },
  webchat: {
    happyBody: {
      message: {
        id: "wc-msg-1",
        text: "deploy now",
        author: { id: "wc-user-1", name: "Alice" },
        room: { id: "dm:wc-user-1", type: "direct" },
      },
    },
  },
};

type WorkflowRunList = {
  runs: Array<{ id: string; triggerType: string }>;
};

type SessionInfo = {
  token: string;
  orgId: string;
  email: string;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withOrgHeaders(token: string, orgId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-org-id": orgId,
    "content-type": "application/json",
  };
}

async function requestJson<T>(input: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus: number;
}): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
  });
  if (response.status !== input.expectedStatus) {
    const text = await response.text();
    throw new Error(`${input.method} ${input.url} -> ${response.status}, expected ${input.expectedStatus}: ${text}`);
  }
  return (await response.json()) as T;
}

async function createSession(apiBaseUrl: string): Promise<SessionInfo> {
  const presetToken = process.env.CHANNEL_SMOKE_TOKEN;
  const presetOrgId = process.env.CHANNEL_SMOKE_ORG_ID;
  if (presetToken && presetOrgId) {
    return {
      token: presetToken,
      orgId: presetOrgId,
      email: "existing-session",
    };
  }

  const email = process.env.CHANNEL_SMOKE_EMAIL ?? `channels-smoke-${Date.now()}@example.com`;
  const password = env("CHANNEL_SMOKE_PASSWORD", "Password123");

  const signup = await requestJson<{ session: { token: string } }>({
    method: "POST",
    url: new URL("/v1/auth/signup", apiBaseUrl).toString(),
    headers: { "content-type": "application/json" },
    body: { email, password },
    expectedStatus: 201,
  });

  const me = await requestJson<{ defaultOrgId: string }>({
    method: "GET",
    url: new URL("/v1/me", apiBaseUrl).toString(),
    headers: { authorization: `Bearer ${signup.session.token}` },
    expectedStatus: 200,
  });

  return {
    token: signup.session.token,
    orgId: me.defaultOrgId,
    email,
  };
}

async function listRunCount(apiBaseUrl: string, token: string, orgId: string, workflowId: string): Promise<number> {
  const runs = await requestJson<WorkflowRunList>({
    method: "GET",
    url: new URL(`/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=50`, apiBaseUrl).toString(),
    headers: withOrgHeaders(token, orgId),
    expectedStatus: 200,
  });
  return runs.runs.length;
}

async function waitForRunCountIncrease(input: {
  apiBaseUrl: string;
  token: string;
  orgId: string;
  workflowId: string;
  before: number;
  timeoutMs: number;
  intervalMs: number;
}): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < input.timeoutMs) {
    const count = await listRunCount(input.apiBaseUrl, input.token, input.orgId, input.workflowId);
    if (count > input.before) {
      return count;
    }
    await sleep(input.intervalMs);
  }
  return input.before;
}

async function ensureChannelAccount(input: {
  apiBaseUrl: string;
  token: string;
  orgId: string;
  channelId: ChannelId;
  accountKey: string;
  runId: string;
}): Promise<string> {
  const accountRes = await requestJson<{ account: { id: string } }>({
    method: "POST",
    url: new URL(`/v1/orgs/${input.orgId}/channels/accounts`, input.apiBaseUrl).toString(),
    headers: withOrgHeaders(input.token, input.orgId),
    body: {
      channelId: input.channelId,
      accountKey: input.accountKey,
      displayName: `${input.channelId}-smoke-${input.runId}`,
      enabled: true,
      dmPolicy: "open",
      groupPolicy: "open",
      requireMentionInGroup: false,
      metadata: {
        sessionBridgeEnabled: false,
      },
    },
    expectedStatus: 201,
  });

  await requestJson({
    method: "PUT",
    url: new URL(`/v1/orgs/${input.orgId}/channels/accounts/${accountRes.account.id}/allowlist`, input.apiBaseUrl).toString(),
    headers: withOrgHeaders(input.token, input.orgId),
    body: {
      scope: "sender",
      subject: "*",
    },
    expectedStatus: 201,
  });

  return accountRes.account.id;
}

async function createPublishedWorkflow(input: {
  apiBaseUrl: string;
  token: string;
  orgId: string;
  channelId: ChannelId;
  accountKey: string;
  runId: string;
}): Promise<string> {
  const workflowRes = await requestJson<{ workflow: { id: string } }>({
    method: "POST",
    url: new URL(`/v1/orgs/${input.orgId}/workflows`, input.apiBaseUrl).toString(),
    headers: withOrgHeaders(input.token, input.orgId),
    body: {
      name: `smoke-${input.channelId}-${input.runId}`,
      dsl: {
        version: "v2",
        trigger: {
          type: "trigger.channel",
          config: {
            channelId: input.channelId,
            accountKey: input.accountKey,
            match: { textContains: "deploy" },
          },
        },
        nodes: [{ id: "n1", type: "agent.execute" }],
      },
    },
    expectedStatus: 201,
  });

  await requestJson({
    method: "POST",
    url: new URL(`/v1/orgs/${input.orgId}/workflows/${workflowRes.workflow.id}/publish`, input.apiBaseUrl).toString(),
    headers: withOrgHeaders(input.token, input.orgId),
    body: {},
    expectedStatus: 200,
  });

  return workflowRes.workflow.id;
}

async function postIngress(input: {
  gatewayBaseUrl: string;
  channelId: ChannelId;
  accountKey: string;
  body: unknown;
}): Promise<{ accepted: boolean; reason: string; workflowsTriggered: number }> {
  return requestJson({
    method: "POST",
    url: new URL(`/ingress/channels/${input.channelId}/${input.accountKey}`, input.gatewayBaseUrl).toString(),
    headers: { "content-type": "application/json" },
    body: input.body,
    expectedStatus: 202,
  });
}

async function run(): Promise<void> {
  const apiBaseUrl = env("CHANNEL_SMOKE_API_BASE_URL", "http://localhost:3001");
  const gatewayBaseUrl = env("CHANNEL_SMOKE_GATEWAY_BASE_URL", "http://localhost:3002");
  const accountKey = env("CHANNEL_SMOKE_ACCOUNT_KEY", "main");
  const runId = `${Date.now()}`;
  const timeoutMs = Number(env("CHANNEL_SMOKE_TIMEOUT_MS", "5000"));
  const intervalMs = Number(env("CHANNEL_SMOKE_POLL_INTERVAL_MS", "100"));

  const channelArg = process.argv.find((arg) => arg.startsWith("--channels="));
  const selectedChannels = channelArg
    ? channelArg
        .slice("--channels=".length)
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is ChannelId => CHANNEL_IDS.includes(item as ChannelId))
    : [...CHANNEL_IDS];

  if (selectedChannels.length === 0) {
    throw new Error("No valid channels selected. Use --channels=<comma-separated-channel-ids>.");
  }

  const session = await createSession(apiBaseUrl);
  console.log(`Running channel smoke matrix as ${session.email} in org ${session.orgId}`);

  const failures: Array<{ channelId: ChannelId; error: string }> = [];
  const successes: ChannelId[] = [];

  for (const channelId of selectedChannels) {
    try {
      const accountId = await ensureChannelAccount({
        apiBaseUrl,
        token: session.token,
        orgId: session.orgId,
        channelId,
        accountKey,
        runId,
      });
      const workflowId = await createPublishedWorkflow({
        apiBaseUrl,
        token: session.token,
        orgId: session.orgId,
        channelId,
        accountKey,
        runId,
      });

      const beforeCount = await listRunCount(apiBaseUrl, session.token, session.orgId, workflowId);
      const happyRes = await postIngress({
        gatewayBaseUrl,
        channelId,
        accountKey,
        body: CHANNEL_CASES[channelId].happyBody,
      });
      if (!happyRes.accepted || happyRes.workflowsTriggered < 1) {
        throw new Error(`happy-path rejected: reason=${happyRes.reason}, workflowsTriggered=${happyRes.workflowsTriggered}`);
      }

      const afterCount = await waitForRunCountIncrease({
        apiBaseUrl,
        token: session.token,
        orgId: session.orgId,
        workflowId,
        before: beforeCount,
        timeoutMs,
        intervalMs,
      });
      if (afterCount <= beforeCount) {
        throw new Error(`workflow run was not enqueued for happy-path (before=${beforeCount}, after=${afterCount})`);
      }

      const badRes = await postIngress({
        gatewayBaseUrl,
        channelId,
        accountKey,
        body: {},
      });
      if (badRes.accepted || badRes.reason !== "normalize_failed") {
        throw new Error(`malformed payload expected normalize_failed, got accepted=${badRes.accepted}, reason=${badRes.reason}`);
      }

      const finalCount = await listRunCount(apiBaseUrl, session.token, session.orgId, workflowId);
      if (finalCount !== afterCount) {
        throw new Error(`malformed payload unexpectedly triggered workflow (after=${afterCount}, final=${finalCount})`);
      }

      successes.push(channelId);
      console.log(`[PASS] ${channelId} (account=${accountId}, workflow=${workflowId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ channelId, error: message });
      console.error(`[FAIL] ${channelId}: ${message}`);
    }
  }

  console.log("");
  console.log(`Smoke summary: ${successes.length}/${selectedChannels.length} channels passed`);
  if (successes.length > 0) {
    console.log(`Passed: ${successes.join(", ")}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`- ${failure.channelId}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
