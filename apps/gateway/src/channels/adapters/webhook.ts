import crypto from "node:crypto";
import type { ChannelId, ChannelInboundEnvelope, ChannelMessageEventType } from "@vespid/shared";
import type { ChannelIngressAdapter, ChannelIngressAdapterInput } from "../registry.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeMessageEvent(input: { isDirectMessage: boolean; mentionMatched: boolean }): ChannelMessageEventType {
  if (input.isDirectMessage) {
    return "message.dm";
  }
  if (input.mentionMatched) {
    return "message.mentioned";
  }
  return "message.received";
}

function detectMention(text: string, body: Record<string, unknown>): boolean {
  const explicit = readBoolean(body.mentionMatched);
  if (explicit !== null) {
    return explicit;
  }
  const mentions = Array.isArray(body.mentions)
    ? body.mentions.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
    : [];
  if (mentions.includes("vespid") || mentions.includes("bot") || mentions.includes("@vespid")) {
    return true;
  }
  const lower = text.toLowerCase();
  return lower.includes("@vespid") || lower.includes("@bot");
}

function normalizeEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const body = getObject(input.body);
  if (!body) {
    return null;
  }

  const text =
    readString(body.text) ??
    readString(body.message) ??
    readString(body.content) ??
    readString(body.body) ??
    "";
  if (text.length === 0) {
    return null;
  }

  const senderId =
    readString(body.senderId) ??
    readString(body.from) ??
    readString(body.userId) ??
    readString(body.authorId) ??
    "unknown";

  const conversationId =
    readString(body.conversationId) ??
    readString(body.chatId) ??
    readString(body.threadId) ??
    readString(body.channelId) ??
    senderId;

  const providerMessageId =
    readString(body.providerMessageId) ??
    readString(body.messageId) ??
    readString(body.id) ??
    readString(input.headers["x-message-id"]) ??
    crypto.randomUUID();

  const isGroup =
    readBoolean(body.isGroup) ??
    readBoolean(body.group) ??
    (conversationId !== senderId && !conversationId.startsWith("dm:"));
  const isDirectMessage = readBoolean(body.isDirectMessage) ?? !isGroup;
  const mentionMatched = detectMention(text, body);

  const receivedAt =
    readString(body.receivedAt) ??
    readString(body.timestamp) ??
    input.receivedAt.toISOString();

  const event = normalizeMessageEvent({ isDirectMessage, mentionMatched });

  return {
    channelId: input.channelId,
    accountId: input.accountId,
    accountKey: input.accountKey,
    organizationId: input.organizationId,
    providerMessageId,
    conversationId,
    senderId,
    senderDisplayName: readString(body.senderDisplayName) ?? readString(body.senderName),
    text,
    receivedAt,
    event,
    mentionMatched,
    raw: {
      headers: input.headers,
      query: input.query,
      body,
    },
  };
}

export function createGenericWebhookAdapter(channelId: ChannelId): ChannelIngressAdapter {
  return {
    channelId,
    normalizeWebhook(input) {
      return normalizeEnvelope(input);
    },
  };
}
