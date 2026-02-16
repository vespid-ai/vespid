import { CHANNEL_CASES, CHANNEL_IDS, type ChannelId } from "./channel-smoke-matrix.ts";

type WorkflowRunList = {
  runs: Array<{ id: string; triggerType: string }>;
};

type SessionInfo = {
  token: string;
  orgId: string;
  email: string;
};

type IngressResult = {
  accepted: boolean;
  reason: string;
  workflowsTriggered: number;
};

type ChannelLoadSummary = {
  channelId: ChannelId;
  totalMessages: number;
  accepted: number;
  workflowsTriggered: number;
  durationMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
};

function argValue(name: string): string | undefined {
  const key = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(key));
  return found ? found.slice(key.length).trim() : undefined;
}

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

function parsePositiveInt(raw: string, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field}: ${raw}`);
  }
  return value;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
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
  const presetToken = process.env.CHANNEL_LOAD_TOKEN;
  const presetOrgId = process.env.CHANNEL_LOAD_ORG_ID;
  if (presetToken && presetOrgId) {
    return {
      token: presetToken,
      orgId: presetOrgId,
      email: "existing-session",
    };
  }

  const email = process.env.CHANNEL_LOAD_EMAIL ?? `channels-load-${Date.now()}@example.com`;
  const password = env("CHANNEL_LOAD_PASSWORD", "Password123");

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
    url: new URL(`/v1/orgs/${orgId}/workflows/${workflowId}/runs?limit=200`, apiBaseUrl).toString(),
    headers: withOrgHeaders(token, orgId),
    expectedStatus: 200,
  });
  return runs.runs.length;
}

async function waitForRunCountAtLeast(input: {
  apiBaseUrl: string;
  token: string;
  orgId: string;
  workflowId: string;
  target: number;
  timeoutMs: number;
  intervalMs: number;
}): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < input.timeoutMs) {
    const count = await listRunCount(input.apiBaseUrl, input.token, input.orgId, input.workflowId);
    if (count >= input.target) {
      return count;
    }
    await sleep(input.intervalMs);
  }
  return listRunCount(input.apiBaseUrl, input.token, input.orgId, input.workflowId);
}

async function createChannelAccount(input: {
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
      displayName: `${input.channelId}-load-${input.runId}`,
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
      name: `load-${input.channelId}-${input.runId}`,
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
}): Promise<IngressResult> {
  return requestJson<IngressResult>({
    method: "POST",
    url: new URL(`/ingress/channels/${input.channelId}/${input.accountKey}`, input.gatewayBaseUrl).toString(),
    headers: { "content-type": "application/json" },
    body: input.body,
    expectedStatus: 202,
  });
}

function mutateHappyBody(input: { channelId: ChannelId; sequence: number; runId: string }): unknown {
  const cloned = structuredClone(CHANNEL_CASES[input.channelId].happyBody) as Record<string, any>;
  const now = Date.now() + input.sequence;
  const seconds = Math.floor(now / 1000);
  const marker = `${input.runId}-${input.sequence}`;
  const text = `deploy now load-${marker}`;

  switch (input.channelId) {
    case "whatsapp": {
      const message = cloned.entry[0].changes[0].value.messages[0];
      message.id = `wa-${marker}`;
      message.timestamp = String(seconds);
      message.text = { ...(message.text ?? {}), body: text };
      break;
    }
    case "telegram": {
      cloned.update_id = input.sequence;
      const message = cloned.message;
      message.message_id = input.sequence;
      message.date = seconds;
      message.text = text;
      break;
    }
    case "discord": {
      cloned.id = `discord-${marker}`;
      cloned.content = text;
      cloned.timestamp = new Date(now).toISOString();
      break;
    }
    case "irc": {
      cloned.messageId = `irc-${marker}`;
      cloned.message = text;
      cloned.timestamp = now;
      break;
    }
    case "slack": {
      cloned.event.ts = `${seconds}.${String(input.sequence).padStart(4, "0")}`;
      cloned.event.text = text;
      break;
    }
    case "googlechat": {
      cloned.eventTime = new Date(now).toISOString();
      cloned.message.name = `spaces/AAA/messages/${marker}`;
      cloned.message.text = text;
      break;
    }
    case "signal": {
      cloned.envelope.timestamp = now;
      cloned.envelope.dataMessage.message = text;
      break;
    }
    case "imessage": {
      cloned.guid = `imessage-${marker}`;
      cloned.text = text;
      break;
    }
    case "feishu": {
      cloned.header.event_id = `feishu-${marker}`;
      cloned.header.create_time = String(now);
      cloned.event.message.message_id = `om_${marker}`;
      cloned.event.message.create_time = String(now);
      cloned.event.message.content = JSON.stringify({ text });
      break;
    }
    case "mattermost": {
      const post = JSON.parse(String(cloned.data.post));
      post.id = `mattermost-${marker}`;
      post.message = text;
      post.create_at = now;
      cloned.data.post = JSON.stringify(post);
      break;
    }
    case "bluebubbles": {
      cloned.message.guid = `bluebubbles-${marker}`;
      cloned.message.text = text;
      cloned.message.timestamp = new Date(now).toISOString();
      break;
    }
    case "msteams": {
      cloned.id = `teams-${marker}`;
      cloned.text = `<at>bot-1</at> ${text}`;
      cloned.timestamp = new Date(now).toISOString();
      break;
    }
    case "line": {
      cloned.events[0].timestamp = now;
      cloned.events[0].webhookEventId = `line-${marker}`;
      cloned.events[0].message.id = `line-msg-${marker}`;
      cloned.events[0].message.text = text;
      break;
    }
    case "nextcloud-talk": {
      cloned.message.id = `nextcloud-${marker}`;
      cloned.message.timestamp = now;
      cloned.message.message = text;
      break;
    }
    case "matrix": {
      cloned.event_id = `$${marker}`;
      cloned.origin_server_ts = now;
      cloned.content.body = text;
      break;
    }
    case "nostr": {
      cloned.event.id = `nostr-${marker}`;
      cloned.event.created_at = seconds;
      cloned.event.content = text;
      break;
    }
    case "tlon": {
      cloned.message.id = `tlon-${marker}`;
      cloned.message.text = text;
      break;
    }
    case "twitch": {
      cloned.event.message_id = `twitch-${marker}`;
      cloned.event.message.text = `${text} @vespid`;
      cloned.event.message.fragments = [{ type: "text", text: `${text} @vespid` }];
      break;
    }
    case "zalo": {
      cloned.timestamp = now;
      cloned.message.msg_id = `zalo-${marker}`;
      cloned.message.text = text;
      break;
    }
    case "zalouser": {
      cloned.timestamp = now;
      cloned.message.id = `zalouser-${marker}`;
      cloned.message.text = text;
      break;
    }
    case "webchat": {
      cloned.message.id = `webchat-${marker}`;
      cloned.message.text = text;
      break;
    }
    default: {
      const exhausted: never = input.channelId;
      throw new Error(`Unsupported channel: ${exhausted}`);
    }
  }

  return cloned;
}

async function runLoadForChannel(input: {
  apiBaseUrl: string;
  gatewayBaseUrl: string;
  token: string;
  orgId: string;
  channelId: ChannelId;
  iterations: number;
  concurrency: number;
  timeoutMs: number;
  pollIntervalMs: number;
  runId: string;
  baseAccountKey: string;
}): Promise<ChannelLoadSummary> {
  const accountKey = `${input.baseAccountKey}-${input.channelId}-${input.runId}`;
  await createChannelAccount({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
    orgId: input.orgId,
    channelId: input.channelId,
    accountKey,
    runId: input.runId,
  });

  const workflowId = await createPublishedWorkflow({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
    orgId: input.orgId,
    channelId: input.channelId,
    accountKey,
    runId: input.runId,
  });

  const beforeCount = await listRunCount(input.apiBaseUrl, input.token, input.orgId, workflowId);
  const latencies: number[] = [];
  const failures: string[] = [];
  let accepted = 0;
  let workflowsTriggered = 0;
  const startedAt = Date.now();

  let sent = 0;
  while (sent < input.iterations) {
    const batchSize = Math.min(input.concurrency, input.iterations - sent);
    const batchStart = sent;
    const batch = Array.from({ length: batchSize }, (_, offset) => {
      const sequence = batchStart + offset + 1;
      const body = mutateHappyBody({
        channelId: input.channelId,
        sequence,
        runId: input.runId,
      });
      const started = Date.now();
      return postIngress({
        gatewayBaseUrl: input.gatewayBaseUrl,
        channelId: input.channelId,
        accountKey,
        body,
      })
        .then((result) => {
          latencies.push(Date.now() - started);
          if (!result.accepted) {
            failures.push(`message#${sequence} rejected: ${result.reason}`);
            return;
          }
          if (result.workflowsTriggered < 1) {
            failures.push(`message#${sequence} accepted but workflowsTriggered=${result.workflowsTriggered}`);
            return;
          }
          accepted += 1;
          workflowsTriggered += result.workflowsTriggered;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`message#${sequence} request failed: ${message}`);
        });
    });

    await Promise.all(batch);
    sent += batchSize;
  }

  if (failures.length > 0) {
    throw new Error(`Load ingress failures (${failures.length}): ${failures.slice(0, 5).join(" | ")}`);
  }

  const expectedCount = beforeCount + input.iterations;
  const finalCount = await waitForRunCountAtLeast({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
    orgId: input.orgId,
    workflowId,
    target: expectedCount,
    timeoutMs: input.timeoutMs,
    intervalMs: input.pollIntervalMs,
  });

  if (finalCount < expectedCount) {
    throw new Error(`Expected at least ${expectedCount} workflow runs, got ${finalCount}`);
  }

  const malformed = await postIngress({
    gatewayBaseUrl: input.gatewayBaseUrl,
    channelId: input.channelId,
    accountKey,
    body: {},
  });
  if (malformed.accepted || malformed.reason !== "normalize_failed") {
    throw new Error(`Malformed payload expected normalize_failed, got accepted=${malformed.accepted}, reason=${malformed.reason}`);
  }

  return {
    channelId: input.channelId,
    totalMessages: input.iterations,
    accepted,
    workflowsTriggered,
    durationMs: Date.now() - startedAt,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

async function run(): Promise<void> {
  const apiBaseUrl = env("CHANNEL_LOAD_API_BASE_URL", "http://localhost:3001");
  const gatewayBaseUrl = env("CHANNEL_LOAD_GATEWAY_BASE_URL", "http://localhost:3002");
  const baseAccountKey = env("CHANNEL_LOAD_ACCOUNT_KEY", "load");
  const runId = `${Date.now()}`;

  const iterations = parsePositiveInt(argValue("iterations") ?? env("CHANNEL_LOAD_ITERATIONS", "40"), "iterations");
  const concurrency = parsePositiveInt(argValue("concurrency") ?? env("CHANNEL_LOAD_CONCURRENCY", "8"), "concurrency");
  const timeoutMs = parsePositiveInt(argValue("timeout-ms") ?? env("CHANNEL_LOAD_TIMEOUT_MS", "30000"), "timeout-ms");
  const pollIntervalMs = parsePositiveInt(
    argValue("poll-interval-ms") ?? env("CHANNEL_LOAD_POLL_INTERVAL_MS", "150"),
    "poll-interval-ms"
  );

  const channelsRaw = argValue("channels") ?? env("CHANNEL_LOAD_CHANNELS", "telegram,slack,webchat");
  const selectedChannels = Array.from(
    new Set(
      channelsRaw
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is ChannelId => CHANNEL_IDS.includes(item as ChannelId))
    )
  );

  if (selectedChannels.length === 0) {
    throw new Error("No valid channels selected. Use --channels=<comma-separated-channel-ids>.");
  }

  const session = await createSession(apiBaseUrl);
  console.log(`Running channel load matrix as ${session.email} in org ${session.orgId}`);
  console.log(
    `Configuration: channels=${selectedChannels.join(",")}, iterations=${iterations}, concurrency=${concurrency}, timeoutMs=${timeoutMs}`
  );

  const summaries: ChannelLoadSummary[] = [];
  const failures: Array<{ channelId: ChannelId; error: string }> = [];

  for (const channelId of selectedChannels) {
    try {
      const summary = await runLoadForChannel({
        apiBaseUrl,
        gatewayBaseUrl,
        token: session.token,
        orgId: session.orgId,
        channelId,
        iterations,
        concurrency,
        timeoutMs,
        pollIntervalMs,
        runId,
        baseAccountKey,
      });
      summaries.push(summary);
      console.log(
        `[PASS] ${channelId}: accepted=${summary.accepted}/${summary.totalMessages}, p50=${summary.latencyP50Ms}ms, p95=${summary.latencyP95Ms}ms, duration=${summary.durationMs}ms`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ channelId, error: message });
      console.error(`[FAIL] ${channelId}: ${message}`);
    }
  }

  console.log("");
  console.log(`Load summary: ${summaries.length}/${selectedChannels.length} channels passed`);
  for (const summary of summaries) {
    console.log(
      `- ${summary.channelId}: accepted=${summary.accepted}/${summary.totalMessages}, triggered=${summary.workflowsTriggered}, p50=${summary.latencyP50Ms}ms, p95=${summary.latencyP95Ms}ms`
    );
  }

  if (failures.length > 0) {
    console.error("Load failures:");
    for (const failure of failures) {
      console.error(`- ${failure.channelId}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
