import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import type { ChannelId } from "@vespid/shared";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

type AuthCase = {
  channelId: ChannelId;
  metadata: Record<string, unknown>;
  expectedReason: string;
};

const authCases: AuthCase[] = [
  { channelId: "whatsapp", metadata: { appSecret: "wa-secret" }, expectedReason: "whatsapp_signature_missing" },
  { channelId: "telegram", metadata: { webhookSecretToken: "tg-secret" }, expectedReason: "telegram_secret_token_invalid" },
  {
    channelId: "discord",
    metadata: { discordPublicKey: Buffer.alloc(32, 7).toString("hex") },
    expectedReason: "discord_signature_missing",
  },
  { channelId: "irc", metadata: { ingressToken: "irc-token" }, expectedReason: "irc_token_invalid" },
  { channelId: "slack", metadata: { signingSecret: "slack-secret" }, expectedReason: "slack_signature_missing" },
  { channelId: "googlechat", metadata: { verificationToken: "gc-token" }, expectedReason: "googlechat_token_invalid" },
  { channelId: "signal", metadata: { webhookSecret: "signal-secret" }, expectedReason: "signal_signature_missing" },
  { channelId: "imessage", metadata: { ingressToken: "imessage-token" }, expectedReason: "imessage_token_invalid" },
  { channelId: "feishu", metadata: { verificationToken: "feishu-token" }, expectedReason: "feishu_token_invalid" },
  { channelId: "mattermost", metadata: { ingressToken: "mattermost-token" }, expectedReason: "mattermost_token_invalid" },
  { channelId: "bluebubbles", metadata: { webhookSecret: "bb-secret" }, expectedReason: "bluebubbles_signature_missing" },
  { channelId: "msteams", metadata: { ingressToken: "teams-token" }, expectedReason: "msteams_token_invalid" },
  { channelId: "line", metadata: { channelSecret: "line-secret" }, expectedReason: "line_signature_missing" },
  { channelId: "nextcloud-talk", metadata: { ingressToken: "nc-token" }, expectedReason: "nextcloud_talk_token_invalid" },
  { channelId: "matrix", metadata: { ingressToken: "matrix-token" }, expectedReason: "matrix_token_invalid" },
  { channelId: "nostr", metadata: { ingressToken: "nostr-token" }, expectedReason: "nostr_token_invalid" },
  { channelId: "tlon", metadata: { ingressToken: "tlon-token" }, expectedReason: "tlon_token_invalid" },
  { channelId: "twitch", metadata: { webhookSecret: "twitch-secret" }, expectedReason: "twitch_signature_missing" },
  { channelId: "zalo", metadata: { webhookSecret: "zalo-secret" }, expectedReason: "zalo_signature_missing" },
  { channelId: "zalouser", metadata: { ingressToken: "zu-token" }, expectedReason: "zalouser_token_invalid" },
  { channelId: "webchat", metadata: { ingressToken: "wc-token" }, expectedReason: "webchat_token_invalid" },
];

async function canConnectRedis(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const port = Number(parsed.port || 6379);
  const host = parsed.hostname || "localhost";
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

describe("channels auth integration", () => {
  let available = false;
  let api: Awaited<ReturnType<typeof buildServer>> | null = null;
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | null = null;
  let gatewayBaseUrl: string | null = null;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      return;
    }
    if (!(await canConnectRedis(redisUrl))) {
      return;
    }

    await migrateUp(databaseUrl);

    process.env.SECRETS_KEK_ID = "ci-kek-v1";
    process.env.SECRETS_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
    process.env.GATEWAY_SERVICE_TOKEN = "ci-gateway-token";
    process.env.INTERNAL_API_SERVICE_TOKEN = "ci-internal-token";

    api = await buildServer();
    const apiAddress = await api.listen({ port: 0, host: "127.0.0.1" });
    process.env.API_HTTP_URL = apiAddress;

    gateway = await buildGatewayServer();
    gatewayBaseUrl = await gateway.listen({ port: 0, host: "127.0.0.1" });

    available = true;
  });

  afterAll(async () => {
    if (gateway) {
      await gateway.close();
    }
    if (api) {
      await api.close();
    }
  });

  it("rejects unsigned or token-less ingress when channel auth metadata is configured", async () => {
    if (!available || !api || !gatewayBaseUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `channels-auth-${Date.now()}@example.com`, password: "Password123" },
    });
    expect(signup.statusCode).toBe(201);
    const token = (signup.json() as { session: { token: string } }).session.token;

    const me = await api.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    const orgId = (me.json() as { defaultOrgId: string }).defaultOrgId;

    for (const testCase of authCases) {
      const accountRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/channels/accounts`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        payload: {
          channelId: testCase.channelId,
          accountKey: "main",
          displayName: `${testCase.channelId}-auth-account`,
          enabled: true,
          dmPolicy: "open",
          groupPolicy: "open",
          requireMentionInGroup: false,
          metadata: testCase.metadata,
        },
      });
      expect(accountRes.statusCode).toBe(201);

      const res = await fetch(new URL(`/ingress/channels/${testCase.channelId}/main`, gatewayBaseUrl).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: "deploy now",
          senderId: `sender-${testCase.channelId}`,
          conversationId: `sender-${testCase.channelId}`,
          isDirectMessage: true,
          mentionMatched: false,
          messageId: `message-${testCase.channelId}`,
        }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as {
        accepted: boolean;
        reason: string;
        workflowsTriggered: number;
      };
      expect(body.accepted).toBe(false);
      expect(body.workflowsTriggered).toBe(0);
      expect(body.reason).toBe(testCase.expectedReason);
    }
  });
});
