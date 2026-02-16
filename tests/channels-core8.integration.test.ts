import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import { buildServer } from "../apps/api/src/server.js";
import { buildGatewayServer } from "../apps/gateway/src/server.js";
import { migrateUp } from "../packages/db/src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

type CoreChannelCase = {
  channelId: "whatsapp" | "telegram" | "discord" | "irc" | "slack" | "googlechat" | "signal" | "imessage";
  happyBody: unknown;
  failureBody: unknown;
  query?: Record<string, string>;
};

const coreCases: CoreChannelCase[] = [
  {
    channelId: "whatsapp",
    happyBody: {
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
              },
            },
          ],
        },
      ],
    },
    failureBody: { entry: [] },
  },
  {
    channelId: "telegram",
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
    failureBody: { update_id: 101, message: { message_id: 201, from: { id: 5001 }, chat: { id: 5001, type: "private" } } },
  },
  {
    channelId: "discord",
    happyBody: {
      id: "discord-msg-1",
      channel_id: "discord-chan-1",
      guild_id: "guild-1",
      content: "deploy now",
      author: { id: "sender-discord", username: "alice" },
      mentions: [],
      timestamp: "2026-02-16T12:00:00.000Z",
    },
    failureBody: { id: "discord-msg-2", channel_id: "discord-chan-1", author: { id: "sender-discord" } },
  },
  {
    channelId: "irc",
    happyBody: {
      messageId: "irc-1",
      nick: "sender-irc",
      target: "#ops",
      message: "deploy now",
      timestamp: 1710000040000,
    },
    failureBody: { messageId: "irc-2", nick: "sender-irc", target: "#ops" },
  },
  {
    channelId: "slack",
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
    failureBody: { event: { type: "message", user: "sender-slack", channel: "D12345" } },
  },
  {
    channelId: "googlechat",
    happyBody: {
      eventTime: "2026-02-16T12:00:00.000Z",
      message: {
        name: "spaces/AAA/messages/BBB",
        text: "deploy now",
        sender: { name: "sender-googlechat", displayName: "Alice" },
        space: { name: "spaces/AAA", type: "DIRECT_MESSAGE" },
      },
    },
    failureBody: { eventTime: "2026-02-16T12:00:10.000Z", message: { name: "spaces/AAA/messages/CCC" } },
  },
  {
    channelId: "signal",
    happyBody: {
      envelope: {
        source: "sender-signal",
        timestamp: 1710000060000,
        dataMessage: { message: "deploy now" },
      },
    },
    failureBody: { envelope: { source: "sender-signal", timestamp: 1710000060000, dataMessage: {} } },
  },
  {
    channelId: "imessage",
    happyBody: {
      guid: "imessage-1",
      text: "deploy now",
      handle: "sender-imessage",
      chatGuid: "sender-imessage",
      isGroup: false,
    },
    failureBody: { guid: "imessage-2", handle: "sender-imessage", chatGuid: "sender-imessage", isGroup: false },
  },
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

describe("channels core8 ingress integration", () => {
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
    const gatewayAddress = await gateway.listen({ port: 0, host: "127.0.0.1" });
    gatewayBaseUrl = gatewayAddress;

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

  it("processes Core8 happy path and rejects malformed payload without creating extra runs", async () => {
    if (!available || !api || !gatewayBaseUrl) {
      return;
    }

    const signup = await api.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `channels-core8-${Date.now()}@example.com`, password: "Password123" },
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

    for (const testCase of coreCases) {
      const accountRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/channels/accounts`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        payload: {
          channelId: testCase.channelId,
          accountKey: "main",
          displayName: `${testCase.channelId}-account`,
          enabled: true,
          dmPolicy: "open",
          groupPolicy: "open",
          requireMentionInGroup: false,
          metadata: {
            sessionBridgeEnabled: false,
          },
        },
      });
      expect(accountRes.statusCode).toBe(201);
      const accountId = (accountRes.json() as { account: { id: string } }).account.id;

      const allowlistRes = await api.inject({
        method: "PUT",
        url: `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        payload: {
          scope: "sender",
          subject: "*",
        },
      });
      expect(allowlistRes.statusCode).toBe(201);

      const workflowRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        payload: {
          name: `${testCase.channelId}-workflow`,
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
      });
      expect(workflowRes.statusCode).toBe(201);
      const workflowId = (workflowRes.json() as { workflow: { id: string } }).workflow.id;

      const publishRes = await api.inject({
        method: "POST",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        payload: {},
      });
      expect(publishRes.statusCode).toBe(200);

      const listBefore = await api.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=50`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      });
      expect(listBefore.statusCode).toBe(200);
      const runsBefore = (listBefore.json() as { runs: Array<{ id: string; triggerType: string }> }).runs;
      const beforeCount = runsBefore.length;

      const happyUrl = new URL(`/ingress/channels/${testCase.channelId}/main`, gatewayBaseUrl);
      if (testCase.query) {
        for (const [key, value] of Object.entries(testCase.query)) {
          happyUrl.searchParams.set(key, value);
        }
      }
      const happyRes = await fetch(happyUrl.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(testCase.happyBody),
      });
      expect(happyRes.status).toBe(202);
      const happyJson = (await happyRes.json()) as {
        accepted: boolean;
        reason: string;
        workflowsTriggered: number;
      };
      expect(happyJson.accepted).toBe(true);
      expect(happyJson.reason).toBe("accepted");
      expect(happyJson.workflowsTriggered).toBe(1);

      let afterCount = beforeCount;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const listAfter = await api.inject({
          method: "GET",
          url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=50`,
          headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
        });
        expect(listAfter.statusCode).toBe(200);
        const runs = (listAfter.json() as { runs: Array<{ id: string; triggerType: string }> }).runs;
        afterCount = runs.length;
        if (afterCount > beforeCount) {
          expect(runs[0]?.triggerType).toBe("channel");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(afterCount).toBeGreaterThan(beforeCount);

      const badRes = await fetch(new URL(`/ingress/channels/${testCase.channelId}/main`, gatewayBaseUrl).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(testCase.failureBody),
      });
      expect(badRes.status).toBe(202);
      const badJson = (await badRes.json()) as {
        accepted: boolean;
        reason: string;
        workflowsTriggered: number;
      };
      expect(badJson.accepted).toBe(false);
      expect(badJson.reason).toBe("normalize_failed");
      expect(badJson.workflowsTriggered).toBe(0);

      const listFinal = await api.inject({
        method: "GET",
        url: `/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=50`,
        headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
      });
      expect(listFinal.statusCode).toBe(200);
      const runsFinal = (listFinal.json() as { runs: Array<{ id: string; triggerType: string }> }).runs;
      expect(runsFinal.length).toBe(afterCount);
    }
  });
});
