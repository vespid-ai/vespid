import crypto from "node:crypto";
import {
  appendAgentSessionEvent,
  appendChannelEvent,
  createChannelMessage,
  createPool,
  createChannelPairingRequest,
  createDb,
  getAgentSessionById,
  getChannelAccountByChannelAndKeyGlobal,
  getChannelAccountById,
  listChannelAllowlistEntries,
  listWorkflows,
  upsertChannelConversation,
  withTenantContext,
} from "@vespid/db";
import type { ChannelId, ChannelSessionSource, GatewayBrainSessionEventV2 } from "@vespid/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { streamToBrain } from "../bus/keys.js";
import { xaddJson } from "../bus/streams.js";
import type { EdgeToBrainRequest } from "../bus/types.js";
import { createDefaultChannelIngressAdapterRegistry, type ChannelIngressAdapterRegistry } from "./registry.js";
import { collectChannelTriggeredWorkflows } from "./router.js";
import { evaluateChannelSecurity } from "./security.js";

type ChannelWebhookInput = {
  channelId: ChannelId;
  accountKey: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  requestId: string;
  remoteIp?: string;
};

type ChannelWebhookResult = {
  accepted: boolean;
  reason: string;
  organizationId?: string;
  accountId?: string;
  sessionRouted: boolean;
  workflowsTriggered: number;
};

type SessionReplyInput = {
  organizationId: string;
  sessionId: string;
  sessionEventSeq: number;
  source: ChannelSessionSource;
  text: string;
};

type SessionRoute = {
  sessionId: string;
  userId: string;
  userEventSeq: number;
  source: ChannelSessionSource;
  sessionEvent: GatewayBrainSessionEventV2;
};

type ManagerDeps = {
  pool: ReturnType<typeof createPool>;
  redis: Redis;
  edgeId: string;
  logger: FastifyBaseLogger;
  apiBaseUrl: string;
  serviceToken: string;
  adapterRegistry?: ChannelIngressAdapterRegistry;
  onSessionBroadcast?: (input: { sessionId: string; event: GatewayBrainSessionEventV2 }) => void;
};

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isChannelRuntimeEnabled(channelId: ChannelId): boolean {
  if (!envFlag("CHANNEL_RUNTIME_ENABLED", true)) {
    return false;
  }
  const key = `CHANNEL_${channelId.toUpperCase().replace(/-/g, "_")}_ENABLED`;
  return envFlag(key, true);
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hmacHex(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function verifySignature(input: { payload: unknown; secret: string; signatureHeader: string | undefined }): boolean {
  const signature = parseString(input.signatureHeader);
  if (!signature) {
    return false;
  }
  const body = JSON.stringify(input.payload ?? {});
  const expected = hmacHex(body, input.secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function randomPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "A";
  }
  return out;
}

async function postInternalTrigger(input: {
  apiBaseUrl: string;
  serviceToken: string;
  payload: { organizationId: string; workflowId: string; requestedByUserId: string; payload: unknown };
}): Promise<void> {
  const url = new URL("/internal/v1/channels/trigger-run", input.apiBaseUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": input.serviceToken,
    },
    body: JSON.stringify(input.payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CHANNEL_TRIGGER_RUN_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
}

async function postOutboundWebhook(input: {
  webhookUrl: string;
  serviceToken: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const response = await fetch(input.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": input.serviceToken,
    },
    body: JSON.stringify(input.payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CHANNEL_OUTBOUND_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
}

export type ChannelRuntimeManager = {
  handleWebhook(input: ChannelWebhookInput): Promise<ChannelWebhookResult>;
  sendSessionReply(input: SessionReplyInput): Promise<void>;
};

export function createChannelRuntimeManager(input: ManagerDeps): ChannelRuntimeManager {
  const registry = input.adapterRegistry ?? createDefaultChannelIngressAdapterRegistry();
  const outboundMaxAttempts = Math.max(1, envNumber("CHANNEL_OUTBOUND_MAX_ATTEMPTS", 3));
  const outboundRetryBaseMs = Math.max(200, envNumber("CHANNEL_OUTBOUND_RETRY_BASE_MS", 500));

  function emitMetric(name: string, labels: Record<string, unknown>): void {
    input.logger.info({ metric: name, value: 1, ...labels }, "channel metric");
  }

  async function handleWebhook(payload: ChannelWebhookInput): Promise<ChannelWebhookResult> {
    emitMetric("channel_inbound_total", {
      channelId: payload.channelId,
      accountKey: payload.accountKey,
      stage: "received",
    });

    if (!isChannelRuntimeEnabled(payload.channelId)) {
      emitMetric("channel_drop_total", {
        channelId: payload.channelId,
        accountKey: payload.accountKey,
        reason: "channel_disabled",
      });
      return { accepted: false, reason: "channel_disabled", sessionRouted: false, workflowsTriggered: 0 };
    }

    const adapter = registry.get(payload.channelId);
    if (!adapter) {
      return { accepted: false, reason: "adapter_not_found", sessionRouted: false, workflowsTriggered: 0 };
    }

    const account = await getChannelAccountByChannelAndKeyGlobal(createDb(input.pool), {
      channelId: payload.channelId,
      accountKey: payload.accountKey,
    });
    if (!account) {
      emitMetric("channel_auth_fail_total", {
        channelId: payload.channelId,
        accountKey: payload.accountKey,
        reason: "account_not_found",
      });
      return { accepted: false, reason: "account_not_found", sessionRouted: false, workflowsTriggered: 0 };
    }
    if (!account.enabled) {
      emitMetric("channel_drop_total", {
        organizationId: account.organizationId,
        channelId: payload.channelId,
        accountId: account.id,
        reason: "account_disabled",
      });
      return {
        accepted: false,
        reason: "account_disabled",
        organizationId: account.organizationId,
        accountId: account.id,
        sessionRouted: false,
        workflowsTriggered: 0,
      };
    }

    const accountMetadata = safeObject(account.metadata);
    if (adapter.authenticateWebhook) {
      const authDecision = adapter.authenticateWebhook({
        channelId: payload.channelId,
        accountId: account.id,
        accountKey: account.accountKey,
        organizationId: account.organizationId,
        body: payload.body,
        headers: payload.headers,
        query: payload.query,
        receivedAt: new Date(),
        accountMetadata,
      });
      if (!authDecision.ok) {
        const reason = parseString(authDecision.reason) ?? "adapter_auth_failed";
        emitMetric("channel_auth_fail_total", {
          organizationId: account.organizationId,
          channelId: payload.channelId,
          accountId: account.id,
          reason,
        });
        await withTenantContext(
          input.pool,
          { organizationId: account.organizationId, userId: account.updatedByUserId },
          async (db) => {
            await appendChannelEvent(db, {
              organizationId: account.organizationId,
              accountId: account.id,
              eventType: "channel.signature.invalid",
              level: "warn",
              message: "Webhook authentication validation failed",
              payload: {
                channelId: payload.channelId,
                requestId: payload.requestId,
                reason,
              },
            });
          }
        );
        return {
          accepted: false,
          reason,
          organizationId: account.organizationId,
          accountId: account.id,
          sessionRouted: false,
          workflowsTriggered: 0,
        };
      }
    }

    const webhookSecret = parseString(accountMetadata.webhookSecret);
    if (webhookSecret) {
      const signatureValid = verifySignature({
        payload: payload.body,
        secret: webhookSecret,
        signatureHeader: payload.headers["x-channel-signature"] ?? payload.headers["x-signature"],
      });
      if (!signatureValid) {
        emitMetric("channel_auth_fail_total", {
          organizationId: account.organizationId,
          channelId: payload.channelId,
          accountId: account.id,
          reason: "signature_invalid",
        });
        await withTenantContext(
          input.pool,
          { organizationId: account.organizationId, userId: account.updatedByUserId },
          async (db) => {
            await appendChannelEvent(db, {
              organizationId: account.organizationId,
              accountId: account.id,
              eventType: "channel.signature.invalid",
              level: "warn",
              message: "Webhook signature validation failed",
              payload: {
                channelId: payload.channelId,
                requestId: payload.requestId,
              },
            });
          }
        );
        return {
          accepted: false,
          reason: "signature_invalid",
          organizationId: account.organizationId,
          accountId: account.id,
          sessionRouted: false,
          workflowsTriggered: 0,
        };
      }
    }

    const envelope = adapter.normalizeWebhook({
      channelId: payload.channelId,
      accountId: account.id,
      accountKey: account.accountKey,
      organizationId: account.organizationId,
      body: payload.body,
      headers: payload.headers,
      query: payload.query,
      receivedAt: new Date(),
    });

    if (!envelope) {
      emitMetric("channel_drop_total", {
        organizationId: account.organizationId,
        channelId: payload.channelId,
        accountId: account.id,
        reason: "normalize_failed",
      });
      return {
        accepted: false,
        reason: "normalize_failed",
        organizationId: account.organizationId,
        accountId: account.id,
        sessionRouted: false,
        workflowsTriggered: 0,
      };
    }

    const idempotencyKey = `channel:inbound:${account.id}:${envelope.providerMessageId}`;
    const acquired = await input.redis.set(idempotencyKey, payload.requestId, "EX", 24 * 60 * 60, "NX");
    if (!acquired) {
      return {
        accepted: true,
        reason: "duplicate_message",
        organizationId: account.organizationId,
        accountId: account.id,
        sessionRouted: false,
        workflowsTriggered: 0,
      };
    }

    const routingState = await withTenantContext(
      input.pool,
      { organizationId: account.organizationId, userId: account.updatedByUserId },
      async (db) => {
        const allowlist = await listChannelAllowlistEntries(db, {
          organizationId: account.organizationId,
          accountId: account.id,
        });

        const decision = evaluateChannelSecurity({
          envelope,
          dmPolicy: account.dmPolicy as any,
          groupPolicy: account.groupPolicy as any,
          requireMentionInGroup: account.requireMentionInGroup,
          allowlistEntries: allowlist.map((entry) => ({ scope: entry.scope, subject: entry.subject })),
        });

        if (!decision.accepted) {
          if (decision.requiresPairing) {
            await createChannelPairingRequest(db, {
              organizationId: account.organizationId,
              accountId: account.id,
              scope: "dm",
              requesterId: envelope.senderId,
              requesterDisplayName: envelope.senderDisplayName ?? null,
              code: randomPairingCode(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
            emitMetric("channel_pairing_pending", {
              organizationId: account.organizationId,
              channelId: payload.channelId,
              accountId: account.id,
            });
          }

          await createChannelMessage(db, {
            organizationId: account.organizationId,
            accountId: account.id,
            conversationId: envelope.conversationId,
            direction: "inbound",
            providerMessageId: envelope.providerMessageId,
            status: "dropped",
            payload: envelope.raw,
            ...(decision.requiresPairing ? { error: "PAIRING_REQUIRED" } : { error: decision.reason }),
          });

          await appendChannelEvent(db, {
            organizationId: account.organizationId,
            accountId: account.id,
            conversationId: envelope.conversationId,
            eventType: "channel.message.dropped",
            level: "warn",
            message: decision.reason,
            payload: {
              senderId: envelope.senderId,
              event: envelope.event,
              requestId: payload.requestId,
            },
          });

          return {
            accepted: false,
            reason: decision.reason,
            sessionRoute: null as SessionRoute | null,
            workflowMatches: [] as Array<{ workflowId: string; requestedByUserId: string }>,
          };
        }

        await createChannelMessage(db, {
          organizationId: account.organizationId,
          accountId: account.id,
          conversationId: envelope.conversationId,
          direction: "inbound",
          providerMessageId: envelope.providerMessageId,
          status: "accepted",
          payload: envelope.raw,
        });

        const defaultSessionId = parseString(accountMetadata.defaultSessionId);
        const sessionBridgeEnabled = accountMetadata.sessionBridgeEnabled !== false;

        const conversation = await upsertChannelConversation(db, {
          organizationId: account.organizationId,
          accountId: account.id,
          conversationId: envelope.conversationId,
          lastInboundAt: new Date(),
        });

        let sessionRoute: SessionRoute | null = null;
        if (sessionBridgeEnabled) {
          const targetSessionId = conversation.sessionId ?? defaultSessionId;
          if (targetSessionId) {
            const session = await getAgentSessionById(db, {
              organizationId: account.organizationId,
              sessionId: targetSessionId,
            });
            if (session) {
              const source: ChannelSessionSource = {
                channelId: envelope.channelId,
                accountId: envelope.accountId,
                accountKey: envelope.accountKey,
                conversationId: envelope.conversationId,
                providerMessageId: envelope.providerMessageId,
                mentionMatched: envelope.mentionMatched,
                event: envelope.event,
              };

              const userEvent = await appendAgentSessionEvent(db, {
                organizationId: account.organizationId,
                sessionId: targetSessionId,
                eventType: "user_message",
                level: "info",
                payload: {
                  message: envelope.text,
                  source,
                },
              });

              await upsertChannelConversation(db, {
                organizationId: account.organizationId,
                accountId: account.id,
                conversationId: envelope.conversationId,
                sessionId: targetSessionId,
                lastInboundAt: new Date(),
              });

              const sessionEvent: GatewayBrainSessionEventV2 = {
                type: "session_event_v2",
                sessionId: targetSessionId,
                seq: userEvent.seq,
                eventType: userEvent.eventType,
                level: userEvent.level === "warn" || userEvent.level === "error" ? userEvent.level : "info",
                payload: userEvent.payload ?? null,
                createdAt: userEvent.createdAt.toISOString(),
              };

              sessionRoute = {
                sessionId: targetSessionId,
                userId: account.updatedByUserId,
                userEventSeq: userEvent.seq,
                source,
                sessionEvent,
              };
            }
          }
        }

        const workflows = await listWorkflows(db, {
          organizationId: account.organizationId,
          limit: 200,
        });

        const workflowMatches = collectChannelTriggeredWorkflows({
          workflows: workflows.rows.map((row) => ({
            id: row.id,
            status: row.status,
            createdByUserId: row.createdByUserId,
            dsl: row.dsl,
          })),
          envelope,
          accountKey: account.accountKey,
        });

        await appendChannelEvent(db, {
          organizationId: account.organizationId,
          accountId: account.id,
          conversationId: envelope.conversationId,
          eventType: "channel.message.accepted",
          level: "info",
          message: "Inbound message accepted",
          payload: {
            event: envelope.event,
            mentionMatched: envelope.mentionMatched,
            sessionRouted: Boolean(sessionRoute),
            workflowCandidateCount: workflowMatches.length,
          },
        });

        return {
          accepted: true,
          reason: "accepted",
          sessionRoute,
          workflowMatches,
        };
      }
    );

    if (!routingState.accepted) {
      emitMetric("channel_drop_total", {
        organizationId: account.organizationId,
        channelId: payload.channelId,
        accountId: account.id,
        reason: routingState.reason,
      });
      return {
        accepted: false,
        reason: routingState.reason,
        organizationId: account.organizationId,
        accountId: account.id,
        sessionRouted: false,
        workflowsTriggered: 0,
      };
    }

    if (routingState.sessionRoute) {
      input.onSessionBroadcast?.({
        sessionId: routingState.sessionRoute.sessionId,
        event: routingState.sessionRoute.sessionEvent,
      });

      const requestId = `${routingState.sessionRoute.sessionId}:turn:${routingState.sessionRoute.userEventSeq}`;
      const message: EdgeToBrainRequest = {
        type: "session_send",
        requestId,
        organizationId: account.organizationId,
        userId: routingState.sessionRoute.userId,
        sessionId: routingState.sessionRoute.sessionId,
        userEventSeq: routingState.sessionRoute.userEventSeq,
        originEdgeId: input.edgeId,
        source: routingState.sessionRoute.source,
      };
      await xaddJson(input.redis, streamToBrain(), message);
    }

    let workflowSuccesses = 0;
    for (const workflow of routingState.workflowMatches) {
      const triggerPayload = {
        organizationId: account.organizationId,
        workflowId: workflow.workflowId,
        requestedByUserId: workflow.requestedByUserId,
        payload: {
          organizationId: account.organizationId,
          workflowId: workflow.workflowId,
          requestedByUserId: workflow.requestedByUserId,
          channelId: envelope.channelId,
          accountId: envelope.accountId,
          accountKey: envelope.accountKey,
          conversationId: envelope.conversationId,
          providerMessageId: envelope.providerMessageId,
          senderId: envelope.senderId,
          senderDisplayName: envelope.senderDisplayName ?? null,
          text: envelope.text,
          event: envelope.event,
          mentionMatched: envelope.mentionMatched,
          receivedAt: envelope.receivedAt,
          raw: envelope.raw,
        },
      };
      try {
        await postInternalTrigger({
          apiBaseUrl: input.apiBaseUrl,
          serviceToken: input.serviceToken,
          payload: triggerPayload,
        });
        workflowSuccesses += 1;
        emitMetric("channel_trigger_run_total", {
          organizationId: account.organizationId,
          channelId: payload.channelId,
          accountId: account.id,
          workflowId: workflow.workflowId,
          status: "succeeded",
        });
      } catch (error) {
        emitMetric("channel_trigger_run_total", {
          organizationId: account.organizationId,
          channelId: payload.channelId,
          accountId: account.id,
          workflowId: workflow.workflowId,
          status: "failed",
        });
        input.logger.error(
          {
            event: "channel_trigger_failed",
            channelId: payload.channelId,
            accountId: account.id,
            workflowId: workflow.workflowId,
            requestId: payload.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to trigger workflow from channel ingress"
        );
      }
    }

    await withTenantContext(
      input.pool,
      { organizationId: account.organizationId, userId: account.updatedByUserId },
      async (db) => {
        await appendChannelEvent(db, {
          organizationId: account.organizationId,
          accountId: account.id,
          eventType: "channel.workflow.triggered",
          level: workflowSuccesses === routingState.workflowMatches.length ? "info" : "warn",
          message:
            routingState.workflowMatches.length === 0
              ? "No workflow triggers matched"
              : `Triggered ${workflowSuccesses}/${routingState.workflowMatches.length} workflow runs`,
          payload: {
            matched: routingState.workflowMatches.length,
            triggered: workflowSuccesses,
          },
        });
      }
    );

    return {
      accepted: true,
      reason: "accepted",
      organizationId: account.organizationId,
      accountId: account.id,
      sessionRouted: Boolean(routingState.sessionRoute),
      workflowsTriggered: workflowSuccesses,
    };
  }

  async function sendSessionReply(payload: SessionReplyInput): Promise<void> {
    if (!isChannelRuntimeEnabled(payload.source.channelId)) {
      return;
    }

    const account = await withTenantContext(
      input.pool,
      { organizationId: payload.organizationId },
      async (db) =>
        getChannelAccountById(db, {
          organizationId: payload.organizationId,
          accountId: payload.source.accountId,
        })
    );

    if (!account || !account.enabled) {
      return;
    }

    const providerMessageId = `session:${payload.sessionId}:${payload.sessionEventSeq}`;
    const webhookUrl = parseString(account.webhookUrl);

    const outboundPayload = {
      type: "channel.session.reply",
      organizationId: payload.organizationId,
      channelId: payload.source.channelId,
      accountId: payload.source.accountId,
      accountKey: payload.source.accountKey,
      conversationId: payload.source.conversationId,
      replyToProviderMessageId: payload.source.providerMessageId,
      text: payload.text,
      sessionId: payload.sessionId,
      sessionEventSeq: payload.sessionEventSeq,
      generatedAt: new Date().toISOString(),
    };

    let status = "queued";
    let errorMessage: string | null = null;
    let attemptCount = 0;
    let delivered = false;

    if (webhookUrl) {
      for (let attempt = 1; attempt <= outboundMaxAttempts; attempt += 1) {
        attemptCount = attempt;
        try {
          await postOutboundWebhook({
            webhookUrl,
            serviceToken: input.serviceToken,
            payload: outboundPayload,
          });
          delivered = true;
          status = "accepted";
          errorMessage = null;
          emitMetric("channel_outbound_total", {
            organizationId: payload.organizationId,
            channelId: payload.source.channelId,
            accountId: payload.source.accountId,
            status: "accepted",
            attempt,
          });
          break;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          if (attempt >= outboundMaxAttempts) {
            status = "dead_letter";
            emitMetric("channel_outbound_total", {
              organizationId: payload.organizationId,
              channelId: payload.source.channelId,
              accountId: payload.source.accountId,
              status: "dead_letter",
              attempt,
            });
            break;
          }
          const backoffMs = outboundRetryBaseMs * Math.pow(2, attempt - 1);
          await sleep(backoffMs);
        }
      }
    } else {
      status = "failed";
      errorMessage = "CHANNEL_OUTBOUND_WEBHOOK_URL_MISSING";
      emitMetric("channel_outbound_total", {
        organizationId: payload.organizationId,
        channelId: payload.source.channelId,
        accountId: payload.source.accountId,
        status: "failed",
        attempt: 0,
      });
    }

    await withTenantContext(
      input.pool,
      { organizationId: payload.organizationId, userId: account.updatedByUserId },
      async (db) => {
        await createChannelMessage(db, {
          organizationId: payload.organizationId,
          accountId: account.id,
          conversationId: payload.source.conversationId,
          direction: "outbound",
          providerMessageId,
          sessionEventSeq: payload.sessionEventSeq,
          status,
          attemptCount,
          payload: outboundPayload,
          ...(errorMessage ? { error: errorMessage } : {}),
        });

        await upsertChannelConversation(db, {
          organizationId: payload.organizationId,
          accountId: account.id,
          conversationId: payload.source.conversationId,
          lastOutboundAt: new Date(),
        });

        await appendChannelEvent(db, {
          organizationId: payload.organizationId,
          accountId: account.id,
          conversationId: payload.source.conversationId,
          eventType: "channel.message.outbound",
          level: status === "accepted" ? "info" : "error",
          message: delivered
            ? "Outbound delivery accepted"
            : status === "dead_letter"
              ? "Outbound delivery moved to dead letter"
              : errorMessage ?? "Outbound delivery failed",
          payload: {
            status,
            attemptCount,
            providerMessageId,
            sessionId: payload.sessionId,
            sessionEventSeq: payload.sessionEventSeq,
          },
        });
      }
    );
  }

  return {
    handleWebhook,
    sendSessionReply,
  };
}
