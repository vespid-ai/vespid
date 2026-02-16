import crypto from "node:crypto";
import type { ChannelInboundEnvelope, ChannelMessageEventType } from "@vespid/shared";
import type {
  ChannelIngressAdapter,
  ChannelIngressAdapterInput,
  ChannelIngressAuthDecision,
  ChannelIngressAuthInput,
} from "../registry.js";

type RecordObject = Record<string, unknown>;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function asObject(value: unknown): RecordObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RecordObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickString(source: RecordObject | null, keys: string[]): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseJsonObject(value: unknown): RecordObject | null {
  if (typeof value !== "string") {
    return asObject(value);
  }
  if (value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function lowercase(value: string): string {
  return value.toLowerCase();
}

function unique(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    out.add(trimmed);
  }
  return [...out];
}

function includesMention(text: string, tokens: string[]): boolean {
  const lowerText = lowercase(text);
  return tokens.some((token) => lowerText.includes(lowercase(token)));
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

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseHexSignature(value: string): string {
  return value.startsWith("sha256=") ? value.slice("sha256=".length) : value;
}

function verifyHexHmac(input: {
  payload: unknown;
  secret: string;
  signature: string;
  algorithm?: "sha1" | "sha256" | "sha512";
}): boolean {
  const algorithm = input.algorithm ?? "sha256";
  const body = JSON.stringify(input.payload ?? {});
  const expected = crypto.createHmac(algorithm, input.secret).update(body, "utf8").digest("hex");
  const provided = parseHexSignature(input.signature);
  return safeEqual(provided, expected);
}

function verifyBase64Hmac(input: {
  payload: unknown;
  secret: string;
  signature: string;
  algorithm?: "sha1" | "sha256" | "sha512";
}): boolean {
  const algorithm = input.algorithm ?? "sha256";
  const body = JSON.stringify(input.payload ?? {});
  const expected = crypto.createHmac(algorithm, input.secret).update(body, "utf8").digest("base64");
  return safeEqual(input.signature, expected);
}

function parseTimestampMs(value: unknown, fallback: Date): string {
  const numeric = readNumber(value);
  if (numeric === null) {
    const raw = readString(value);
    if (raw) {
      const parsedDate = Date.parse(raw);
      if (!Number.isNaN(parsedDate)) {
        return new Date(parsedDate).toISOString();
      }
    }
    return fallback.toISOString();
  }

  if (numeric > 1e12) {
    return new Date(numeric).toISOString();
  }
  if (numeric > 1e9) {
    return new Date(numeric * 1000).toISOString();
  }
  return fallback.toISOString();
}

function parseUnixSeconds(value: unknown, fallback: Date): string {
  const numeric = readNumber(value);
  if (numeric === null) {
    return parseTimestampMs(value, fallback);
  }
  return new Date(numeric * 1000).toISOString();
}

function parseSlackTimestamp(value: unknown, fallback: Date): string {
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed * 1000).toISOString();
    }
  }
  return fallback.toISOString();
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || !token) {
    return null;
  }
  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function normalizeGenericEnvelope(input: ChannelIngressAdapterInput, mentionTokens: string[] = []): ChannelInboundEnvelope | null {
  const body = asObject(input.body);
  if (!body) {
    return null;
  }

  const text = pickString(body, ["text", "message", "content", "body"]);
  if (!text) {
    return null;
  }

  const senderId = pickString(body, ["senderId", "from", "userId", "authorId"]) ?? "unknown";
  const conversationId = pickString(body, ["conversationId", "chatId", "threadId", "channelId"]) ?? senderId;
  const providerMessageId =
    pickString(body, ["providerMessageId", "messageId", "id"]) ?? input.headers["x-message-id"] ?? crypto.randomUUID();

  const isGroup =
    readBoolean(body.isGroup) ??
    readBoolean(body.group) ??
    (conversationId !== senderId && !conversationId.startsWith("dm:"));
  const isDirectMessage = readBoolean(body.isDirectMessage) ?? !isGroup;

  const explicitMention = readBoolean(body.mentionMatched);
  const mentionMatched =
    explicitMention ??
    includesMention(text, [...mentionTokens, "@vespid", "@bot", "vespid bot"]);

  return {
    channelId: input.channelId,
    accountId: input.accountId,
    accountKey: input.accountKey,
    organizationId: input.organizationId,
    providerMessageId,
    conversationId,
    senderId,
    senderDisplayName: pickString(body, ["senderDisplayName", "senderName"]),
    text,
    receivedAt: pickString(body, ["receivedAt", "timestamp"]) ?? input.receivedAt.toISOString(),
    mentionMatched,
    event: normalizeMessageEvent({ isDirectMessage, mentionMatched }),
    raw: {
      headers: input.headers,
      query: input.query,
      body,
    },
  };
}

function createEnvelope(
  input: ChannelIngressAdapterInput,
  value: {
    text: string | null;
    senderId: string | null;
    conversationId: string | null;
    providerMessageId?: string | null;
    senderDisplayName?: string | null;
    receivedAt?: string;
    isDirectMessage: boolean;
    mentionMatched: boolean;
    rawBody: RecordObject;
  }
): ChannelInboundEnvelope | null {
  if (!value.text) {
    return null;
  }
  const senderId = value.senderId ?? "unknown";
  const conversationId = value.conversationId ?? senderId;
  const providerMessageId = value.providerMessageId ?? crypto.randomUUID();
  const mentionMatched = value.mentionMatched;

  return {
    channelId: input.channelId,
    accountId: input.accountId,
    accountKey: input.accountKey,
    organizationId: input.organizationId,
    providerMessageId,
    conversationId,
    senderId,
    senderDisplayName: value.senderDisplayName ?? null,
    text: value.text,
    receivedAt: value.receivedAt ?? input.receivedAt.toISOString(),
    mentionMatched,
    event: normalizeMessageEvent({ isDirectMessage: value.isDirectMessage, mentionMatched }),
    raw: {
      headers: input.headers,
      query: input.query,
      body: value.rawBody,
    },
  };
}

function failed(reason: string): ChannelIngressAuthDecision {
  return { ok: false, reason };
}

function ok(): ChannelIngressAuthDecision {
  return { ok: true };
}

function verifyIngressToken(input: {
  metadata: RecordObject;
  headerToken: string | null;
  metadataKey: string;
  reason: string;
}): ChannelIngressAuthDecision {
  const expectedToken = readString(input.metadata[input.metadataKey]);
  if (!expectedToken) {
    return ok();
  }
  if (!input.headerToken || !safeEqual(input.headerToken, expectedToken)) {
    return failed(input.reason);
  }
  return ok();
}

function createWhatsappEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const entry = asObject(asArray(root.entry)[0]);
  const change = asObject(asArray(entry?.changes)[0]);
  const value = asObject(change?.value);
  const message = asObject(asArray(value?.messages)[0]);

  if (!message) {
    return normalizeGenericEnvelope(input, ["@vespid"]);
  }

  const textPayload = asObject(message.text);
  const interactivePayload = asObject(message.interactive);
  const buttonReply = asObject(interactivePayload?.button_reply);
  const listReply = asObject(interactivePayload?.list_reply);
  const text =
    pickString(textPayload, ["body"]) ??
    pickString(asObject(message.button), ["text"]) ??
    pickString(buttonReply, ["title"]) ??
    pickString(listReply, ["title"]) ??
    pickString(message, ["body"]);

  const senderId = pickString(message, ["from"]);
  const conversationId =
    pickString(asObject(message.context), ["from"]) ??
    pickString(asObject(value?.metadata), ["display_phone_number"]) ??
    senderId;
  const firstContact = asObject(asArray(value?.contacts)[0]);
  const senderProfile = asObject(firstContact?.profile);

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id"]),
    senderDisplayName: pickString(senderProfile, ["name"]),
    receivedAt: parseUnixSeconds(message.timestamp, input.receivedAt),
    isDirectMessage: true,
    mentionMatched: includesMention(text ?? "", ["@vespid", "@bot"]),
    rawBody: root,
  });
}

function createTelegramEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const callbackQuery = asObject(root.callback_query);
  const callbackMessage = asObject(callbackQuery?.message);
  const message =
    asObject(root.message) ?? asObject(root.edited_message) ?? asObject(root.channel_post) ?? callbackMessage;

  if (!message) {
    return normalizeGenericEnvelope(input, ["@vespid"]);
  }

  const chat = asObject(message.chat);
  const from = asObject(message.from) ?? asObject(callbackQuery?.from);
  const text = pickString(message, ["text", "caption"]) ?? pickString(callbackQuery, ["data"]);
  const conversationId = readNumber(chat?.id)?.toString() ?? pickString(message, ["chat_id"]);
  const senderId = readNumber(from?.id)?.toString() ?? pickString(from, ["id", "username"]);
  const botUsername = readString(input.query.botUsername);
  const mentionMatched =
    asArray(message.entities).some((entity) => {
      const entityObject = asObject(entity);
      if (!entityObject) {
        return false;
      }
      return readString(entityObject.type) === "mention";
    }) ||
    includesMention(text ?? "", unique([botUsername, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId:
      readNumber(message.message_id)?.toString() ?? readNumber(root.update_id)?.toString() ?? pickString(message, ["message_id"]),
    senderDisplayName: pickString(from, ["username", "first_name"]),
    receivedAt: parseUnixSeconds(message.date, input.receivedAt),
    isDirectMessage: pickString(chat, ["type"]) === "private",
    mentionMatched,
    rawBody: root,
  });
}

function createDiscordEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const data = asObject(root.d) ?? root;
  const member = asObject(data.member);
  const author = asObject(data.author) ?? asObject(member?.user);
  const text = pickString(data, ["content", "message"]);
  if (!text) {
    return null;
  }

  const botUserId = readString(input.query.botUserId);
  const mentions = asArray(data.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null)
    .map((item) => pickString(item, ["id"]))
    .filter((value): value is string => Boolean(value));

  const mentionMatched =
    mentions.some((mention) => Boolean(botUserId) && mention === botUserId) ||
    includesMention(text, unique([botUserId ? `<@${botUserId}>` : null, "@vespid", "@bot"]));

  const guildId = pickString(data, ["guild_id"]);
  return createEnvelope(input, {
    text,
    senderId: pickString(author, ["id", "username"]),
    conversationId: pickString(data, ["channel_id", "thread_id"]),
    providerMessageId: pickString(data, ["id"]),
    senderDisplayName: pickString(author, ["global_name", "username"]),
    receivedAt: pickString(data, ["timestamp"]) ?? input.receivedAt.toISOString(),
    isDirectMessage: !guildId,
    mentionMatched,
    rawBody: root,
  });
}

function createIrcEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const text = pickString(root, ["message", "trailing", "text"]);
  const senderId = pickString(root, ["nick", "sender", "user"]);
  const target = pickString(root, ["target", "channel", "conversationId"]);
  const botNick = readString(input.query.botNick) ?? "vespid";
  const isDirectMessage = Boolean(target) && !String(target).startsWith("#");

  return createEnvelope(input, {
    text,
    senderId,
    conversationId: target ?? senderId,
    providerMessageId: pickString(root, ["messageId", "id", "timestamp"]),
    senderDisplayName: senderId,
    receivedAt: pickString(root, ["receivedAt"]) ?? parseTimestampMs(root.timestamp, input.receivedAt),
    isDirectMessage,
    mentionMatched: includesMention(text ?? "", [`${botNick}:`, `@${botNick}`, "@vespid"]),
    rawBody: root,
  });
}

function createSlackEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  if (pickString(root, ["type"]) === "url_verification") {
    return null;
  }

  const event = asObject(root.event) ?? root;
  if (pickString(event, ["subtype"]) === "message_deleted") {
    return null;
  }

  const text = pickString(event, ["text", "message"]);
  if (!text) {
    return null;
  }

  const botUserId = readString(input.query.botUserId);
  const mentionMatched =
    pickString(event, ["type"]) === "app_mention" ||
    includesMention(text, unique([botUserId ? `<@${botUserId}>` : null, "@vespid", "@bot"]));

  const conversationId = pickString(event, ["channel"]);

  return createEnvelope(input, {
    text,
    senderId: pickString(event, ["user", "bot_id"]),
    conversationId,
    providerMessageId: pickString(event, ["client_msg_id", "event_ts", "ts"]),
    senderDisplayName: pickString(asObject(event.user_profile), ["display_name", "real_name"]),
    receivedAt: parseSlackTimestamp(event.event_ts ?? event.ts, input.receivedAt),
    isDirectMessage: Boolean(conversationId?.startsWith("D") || pickString(event, ["channel_type"]) === "im"),
    mentionMatched,
    rawBody: root,
  });
}

function createGoogleChatEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const space = asObject(message.space) ?? asObject(root.space);
  const sender = asObject(message.sender) ?? asObject(root.user);

  const text = pickString(message, ["argumentText", "text", "formattedText"]);
  if (!text) {
    return null;
  }

  const mentionMatched =
    asArray(message.annotations).some((annotation) => {
      const annotationObject = asObject(annotation);
      if (!annotationObject) {
        return false;
      }
      const type = pickString(annotationObject, ["type"]);
      return type === "USER_MENTION";
    }) || includesMention(text, ["@vespid", "@bot"]);

  const conversationId = pickString(space, ["name", "thread.name"]);

  return createEnvelope(input, {
    text,
    senderId: pickString(sender, ["name", "displayName", "email"]),
    conversationId,
    providerMessageId: pickString(message, ["name", "thread.name"]) ?? pickString(root, ["eventTime"]),
    senderDisplayName: pickString(sender, ["displayName"]),
    receivedAt: pickString(root, ["eventTime"]) ?? input.receivedAt.toISOString(),
    isDirectMessage: pickString(space, ["type", "spaceType"]) === "DIRECT_MESSAGE",
    mentionMatched,
    rawBody: root,
  });
}

function createSignalEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const envelope = asObject(root.envelope) ?? root;
  const dataMessage = asObject(envelope.dataMessage) ?? asObject(root.dataMessage);
  const groupInfo = asObject(dataMessage?.groupInfo);
  const text = pickString(dataMessage, ["message"]) ?? pickString(root, ["message", "text"]);
  const senderId = pickString(envelope, ["sourceUuid", "sourceNumber", "source"]) ?? pickString(root, ["senderId", "from"]);
  const groupId = pickString(groupInfo, ["groupId"]) ?? pickString(root, ["groupId"]);
  const botHandle = readString(input.query.botHandle);

  return createEnvelope(input, {
    text,
    senderId,
    conversationId: groupId ?? senderId,
    providerMessageId: pickString(envelope, ["guid", "sourceDevice", "timestamp"]) ?? pickString(root, ["id"]),
    senderDisplayName: pickString(root, ["senderName"]),
    receivedAt: parseTimestampMs(envelope.timestamp ?? root.timestamp, input.receivedAt),
    isDirectMessage: !groupId,
    mentionMatched: includesMention(text ?? "", unique([botHandle, "@vespid", "@bot"])),
    rawBody: root,
  });
}

function createImessageEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const text = pickString(root, ["text", "message", "body"]);
  const senderId = pickString(root, ["handle", "sender", "address", "from"]);
  const conversationId = pickString(root, ["chatGuid", "conversationId", "threadId"]) ?? senderId;
  const isGroup = readBoolean(root.isGroup) ?? Boolean(conversationId && conversationId.startsWith("chat"));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(root, ["guid", "messageId", "id"]),
    senderDisplayName: pickString(root, ["senderName", "displayName"]),
    receivedAt: pickString(root, ["date", "timestamp"]) ?? input.receivedAt.toISOString(),
    isDirectMessage: !isGroup,
    mentionMatched: includesMention(text ?? "", ["@vespid", "@bot"]),
    rawBody: root,
  });
}

function createMsteamsEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const event = asObject(root.value) ?? root;
  const from = asObject(event.from);
  const conversation = asObject(event.conversation);
  const recipient = asObject(event.recipient);
  const entities = asArray(event.entities);

  const text = pickString(event, ["text", "summary"]);
  const conversationType = pickString(conversation, ["conversationType"]);
  const isDirectMessage = conversationType === "personal" || readBoolean(event.isGroup) === false;

  const botId = readString(input.query.botId) ?? pickString(recipient, ["id"]);
  const mentionMatched =
    entities.some((entity) => {
      const entityObject = asObject(entity);
      if (!entityObject) {
        return false;
      }
      if (pickString(entityObject, ["type"]) !== "mention") {
        return false;
      }
      const mentioned = asObject(entityObject.mentioned);
      const mentionedId = pickString(mentioned, ["id"]);
      return Boolean(botId) && mentionedId === botId;
    }) || includesMention(text ?? "", unique([botId ? `<at>${botId}</at>` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId: pickString(from, ["id", "aadObjectId", "name"]),
    conversationId: pickString(conversation, ["id"]),
    providerMessageId: pickString(event, ["id", "activityId"]),
    senderDisplayName: pickString(from, ["name"]),
    receivedAt: pickString(event, ["timestamp"]) ?? input.receivedAt.toISOString(),
    isDirectMessage,
    mentionMatched,
    rawBody: root,
  });
}

function createLineEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const firstEvent = asObject(asArray(root.events)[0]);
  if (!firstEvent) {
    return null;
  }

  const message = asObject(firstEvent.message);
  const source = asObject(firstEvent.source);

  const text = pickString(message, ["text"]);
  const sourceType = pickString(source, ["type"]);
  const senderId = pickString(source, ["userId", "groupId", "roomId"]);
  const conversationId = pickString(source, ["groupId", "roomId", "userId"]) ?? senderId;
  const mentionCandidates = asArray(asObject(message?.mention)?.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null)
    .map((item) => asObject(item.mentioned))
    .filter((item): item is RecordObject => item !== null)
    .map((item) => pickString(item, ["userId"]))
    .filter((value): value is string => Boolean(value));
  const botUserId = readString(input.query.botUserId);
  const mentionMatched =
    mentionCandidates.some((id) => Boolean(botUserId) && id === botUserId) ||
    includesMention(text ?? "", unique([botUserId ? `@${botUserId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id"]) ?? pickString(firstEvent, ["webhookEventId"]),
    senderDisplayName: pickString(firstEvent, ["displayName"]),
    receivedAt: parseTimestampMs(firstEvent.timestamp, input.receivedAt),
    isDirectMessage: sourceType === "user",
    mentionMatched,
    rawBody: root,
  });
}

function createMatrixEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const event = asObject(root.event) ?? root;
  const content = asObject(event.content);
  const text = pickString(content, ["body", "formatted_body", "text"]) ?? pickString(event, ["body", "text"]);
  const senderId = pickString(event, ["sender", "user_id", "from"]);
  const conversationId = pickString(event, ["room_id", "conversationId"]) ?? senderId;
  const botUserId = readString(input.query.botUserId);
  const mentionUserIds = asArray(asObject(content?.["m.mentions"])?.user_ids)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const mentionMatched =
    mentionUserIds.some((id) => Boolean(botUserId) && id === botUserId) ||
    includesMention(text ?? "", unique([botUserId, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(event, ["event_id", "id"]),
    senderDisplayName: pickString(root, ["senderDisplayName"]),
    receivedAt: parseTimestampMs(event.origin_server_ts ?? root.timestamp, input.receivedAt),
    isDirectMessage: Boolean(conversationId?.startsWith("!dm:") || pickString(event, ["type"]) === "m.direct"),
    mentionMatched,
    rawBody: root,
  });
}

function createFeishuEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  if (pickString(root, ["type"]) === "url_verification") {
    return null;
  }

  const header = asObject(root.header);
  const event = asObject(root.event) ?? root;
  const message = asObject(event.message);
  const sender = asObject(event.sender);
  const senderIdObject = asObject(sender?.sender_id);
  const content = parseJsonObject(message?.content);

  const text =
    pickString(content, ["text"]) ??
    pickString(message, ["text", "body"]) ??
    pickString(event, ["text", "message"]);
  const senderId = pickString(senderIdObject, ["open_id", "user_id", "union_id"]);
  const conversationId = pickString(message, ["chat_id"]) ?? senderId;
  const botOpenId = readString(input.query.botOpenId);
  const mentions = asArray(message?.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null);
  const mentionMatched =
    mentions.some((mention) => {
      const id = pickString(mention, ["id", "open_id", "user_id"]);
      const key = pickString(mention, ["key", "name"]);
      return (typeof botOpenId === "string" && id === botOpenId) || (typeof botOpenId === "string" && key?.includes(botOpenId) === true);
    }) || includesMention(text ?? "", unique([botOpenId ? `@${botOpenId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["message_id"]) ?? pickString(header, ["event_id"]),
    senderDisplayName: pickString(sender, ["sender_type"]),
    receivedAt: parseTimestampMs(message?.create_time ?? header?.create_time, input.receivedAt),
    isDirectMessage: pickString(message, ["chat_type"]) === "p2p",
    mentionMatched,
    rawBody: root,
  });
}

function createMattermostEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const data = asObject(root.data);
  const broadcast = asObject(root.broadcast);
  const post = parseJsonObject(data?.post);
  const text = pickString(post, ["message"]) ?? pickString(root, ["text", "command", "message"]);
  const senderId = pickString(post, ["user_id"]) ?? pickString(root, ["user_id", "userId"]);
  const conversationId =
    pickString(post, ["channel_id"]) ??
    pickString(broadcast, ["channel_id"]) ??
    pickString(root, ["channel_id", "channelId"]) ??
    senderId;
  const channelType = pickString(data, ["channel_type"]) ?? pickString(root, ["channel_type"]);
  const botUsername = readString(input.query.botUsername);
  const mentionMatched = includesMention(text ?? "", unique([botUsername ? `@${botUsername}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(post, ["id"]) ?? pickString(root, ["trigger_id", "messageId", "id"]),
    senderDisplayName: pickString(root, ["sender_name", "user_name", "username"]),
    receivedAt: parseTimestampMs(post?.create_at ?? root.timestamp, input.receivedAt),
    isDirectMessage: channelType === "D" || Boolean(conversationId?.startsWith("D")),
    mentionMatched,
    rawBody: root,
  });
}

function createBluebubblesEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const sender = asObject(root.sender);
  const text = pickString(message, ["text", "message", "body"]);
  const senderId = pickString(message, ["handle", "sender", "address", "from"]) ?? pickString(sender, ["address", "id"]);
  const conversationId = pickString(message, ["chatGuid", "conversationId", "threadId"]) ?? senderId;
  const isGroup = readBoolean(message.isGroup) ?? Boolean(conversationId?.startsWith("chat"));
  const botHandle = readString(input.query.botHandle);

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["guid", "messageId", "id"]),
    senderDisplayName: pickString(sender, ["displayName", "name"]) ?? pickString(root, ["senderName"]),
    receivedAt: pickString(message, ["date", "timestamp"]) ?? parseTimestampMs(root.timestamp, input.receivedAt),
    isDirectMessage: !isGroup,
    mentionMatched: includesMention(text ?? "", unique([botHandle, "@vespid", "@bot"])),
    rawBody: root,
  });
}

function createNextcloudTalkEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const conversation = asObject(root.conversation);
  const text = pickString(message, ["message", "text", "content", "body"]);
  const senderId = pickString(message, ["actorId", "senderId", "userId", "from"]);
  const conversationId = pickString(conversation, ["token", "id"]) ?? pickString(message, ["token", "conversationId"]) ?? senderId;
  const conversationType = pickString(conversation, ["type"]) ?? pickString(message, ["conversationType"]);
  const botUserId = readString(input.query.botUserId);
  const mentions = asArray(message.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null);
  const mentionMatched =
    mentions.some((mention) => {
      const id = pickString(mention, ["id", "userId"]);
      return typeof botUserId === "string" && id === botUserId;
    }) || includesMention(text ?? "", unique([botUserId ? `@${botUserId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id", "messageId"]),
    senderDisplayName: pickString(message, ["actorDisplayName", "senderDisplayName"]),
    receivedAt: parseTimestampMs(message.timestamp ?? root.timestamp, input.receivedAt),
    isDirectMessage: conversationType === "oneToOne" || conversationType === "direct",
    mentionMatched,
    rawBody: root,
  });
}

function createTwitchEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  if (pickString(root, ["challenge"])) {
    return null;
  }

  const event = asObject(root.event) ?? root;
  const message = asObject(event.message);
  const fragments = asArray(message?.fragments)
    .map((fragment) => asObject(fragment))
    .filter((fragment): fragment is RecordObject => fragment !== null);
  const botUserId = readString(input.query.botUserId);
  const text = pickString(message, ["text"]) ?? pickString(event, ["text", "message"]);
  const mentionMatched =
    fragments.some((fragment) => {
      const mention = asObject(fragment.mention);
      const mentionId = pickString(mention, ["user_id", "id"]);
      return typeof botUserId === "string" && mentionId === botUserId;
    }) || includesMention(text ?? "", unique([botUserId ? `@${botUserId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId: pickString(event, ["chatter_user_id", "senderId", "userId"]),
    conversationId: pickString(event, ["broadcaster_user_id", "conversationId"]),
    providerMessageId: pickString(event, ["message_id", "id"]),
    senderDisplayName: pickString(event, ["chatter_user_name", "senderDisplayName"]),
    receivedAt: parseTimestampMs(root.timestamp, input.receivedAt),
    isDirectMessage: false,
    mentionMatched,
    rawBody: root,
  });
}

function createWebchatEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const author = asObject(message.author);
  const room = asObject(message.room);
  const text = pickString(message, ["text", "content", "body", "message"]);
  const senderId = pickString(author, ["id", "userId"]) ?? pickString(message, ["senderId", "from"]);
  const conversationId = pickString(room, ["id", "roomId"]) ?? pickString(message, ["conversationId", "threadId"]) ?? senderId;
  const botUserId = readString(input.query.botUserId);
  const mentions = asArray(message.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null);
  const mentionMatched =
    mentions.some((mention) => {
      const id = pickString(mention, ["id", "userId"]);
      return typeof botUserId === "string" && id === botUserId;
    }) || includesMention(text ?? "", unique([botUserId ? `@${botUserId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id", "messageId"]),
    senderDisplayName: pickString(author, ["name", "displayName"]),
    receivedAt: pickString(message, ["createdAt", "timestamp"]) ?? input.receivedAt.toISOString(),
    isDirectMessage: pickString(room, ["type"]) === "direct" || Boolean(conversationId?.startsWith("dm:")),
    mentionMatched,
    rawBody: root,
  });
}

function createNostrEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const event = asObject(root.event) ?? root;
  const tags = asArray(event.tags)
    .map((item) => asArray(item))
    .filter((item) => item.length >= 2);
  const kind = readNumber(event.kind);
  const text = pickString(event, ["content", "text", "message"]);
  const senderId = pickString(event, ["pubkey", "senderId"]);
  const threadId = tags.find((tag) => tag[0] === "e")?.[1];
  const peerId = tags.find((tag) => tag[0] === "p")?.[1];
  const conversationId =
    (typeof threadId === "string" ? threadId : null) ??
    (typeof peerId === "string" ? peerId : null) ??
    senderId;
  const botPubKey = readString(input.query.botPubKey);
  const mentionMatched =
    tags.some((tag) => tag[0] === "p" && typeof botPubKey === "string" && tag[1] === botPubKey) ||
    includesMention(text ?? "", unique([botPubKey, "@vespid", "@bot"]));
  const isDirectMessage = kind === 4;

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(event, ["id", "event_id"]),
    senderDisplayName: pickString(root, ["senderDisplayName"]),
    receivedAt: parseUnixSeconds(event.created_at, input.receivedAt),
    isDirectMessage,
    mentionMatched,
    rawBody: root,
  });
}

function createTlonEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const text = pickString(message, ["text", "message", "content", "body"]);
  const senderId = pickString(message, ["ship", "author", "senderId", "from"]);
  const conversationId = pickString(message, ["channel", "channelId", "conversationId", "threadId"]) ?? senderId;
  const botShip = readString(input.query.botShip);
  const mentions = asArray(message.mentions)
    .filter((value): value is string => typeof value === "string");
  const mentionMatched =
    mentions.some((value) => typeof botShip === "string" && value === botShip) ||
    includesMention(text ?? "", unique([botShip, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id", "messageId"]),
    senderDisplayName: pickString(message, ["senderDisplayName", "authorName"]),
    receivedAt: pickString(message, ["time", "createdAt", "timestamp"]) ?? input.receivedAt.toISOString(),
    isDirectMessage: Boolean(conversationId?.startsWith("dm:") || conversationId === senderId),
    mentionMatched,
    rawBody: root,
  });
}

function createZaloEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? root;
  const sender = asObject(root.sender) ?? asObject(root.from) ?? asObject(message.sender);
  const conversation = asObject(root.conversation) ?? asObject(root.chat) ?? asObject(message.conversation);
  const text = pickString(message, ["text", "message", "content", "body"]) ?? pickString(root, ["text", "message"]);
  const senderId = pickString(sender, ["id", "user_id", "userId"]) ?? pickString(message, ["senderId", "from"]);
  const conversationId = pickString(conversation, ["id", "threadId", "conversationId"]) ?? senderId;
  const botId = readString(input.query.botUserId);
  const mentions = asArray(message.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null);
  const mentionMatched =
    mentions.some((mention) => {
      const id = pickString(mention, ["id", "user_id", "userId"]);
      return typeof botId === "string" && id === botId;
    }) || includesMention(text ?? "", unique([botId ? `@${botId}` : null, "@vespid", "@bot"]));
  const eventName = pickString(root, ["event_name", "eventName"]);

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["msg_id", "message_id", "id"]) ?? pickString(root, ["id"]),
    senderDisplayName: pickString(sender, ["display_name", "name"]),
    receivedAt: parseTimestampMs(root.timestamp ?? message.timestamp, input.receivedAt),
    isDirectMessage:
      pickString(conversation, ["type"]) === "private" ||
      eventName === "user_send_text" ||
      eventName === "user_send_image",
    mentionMatched,
    rawBody: root,
  });
}

function createZalouserEnvelope(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null {
  const root = asObject(input.body);
  if (!root) {
    return null;
  }

  const message = asObject(root.message) ?? asObject(root.data) ?? root;
  const sender = asObject(message.sender) ?? asObject(root.sender);
  const conversation = asObject(message.conversation) ?? asObject(root.conversation);
  const text = pickString(message, ["text", "content", "body", "message"]);
  const senderId = pickString(sender, ["id", "userId", "user_id"]) ?? pickString(message, ["senderId", "from"]);
  const conversationId = pickString(conversation, ["id", "conversationId", "threadId"]) ?? senderId;
  const botUserId = readString(input.query.botUserId);
  const mentions = asArray(message.mentions)
    .map((item) => asObject(item))
    .filter((item): item is RecordObject => item !== null);
  const mentionMatched =
    mentions.some((mention) => {
      const id = pickString(mention, ["id", "userId", "user_id"]);
      return typeof botUserId === "string" && id === botUserId;
    }) || includesMention(text ?? "", unique([botUserId ? `@${botUserId}` : null, "@vespid", "@bot"]));

  return createEnvelope(input, {
    text,
    senderId,
    conversationId,
    providerMessageId: pickString(message, ["id", "messageId", "msg_id"]),
    senderDisplayName: pickString(sender, ["name", "displayName"]),
    receivedAt: parseTimestampMs(root.timestamp ?? message.timestamp, input.receivedAt),
    isDirectMessage: pickString(conversation, ["type"]) === "direct" || conversationId === senderId,
    mentionMatched,
    rawBody: root,
  });
}

function validateSlackSignature(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const signingSecret = readString(input.accountMetadata.signingSecret);
  if (!signingSecret) {
    return ok();
  }

  const signature = readString(input.headers["x-slack-signature"]);
  const timestampRaw = readString(input.headers["x-slack-request-timestamp"]);
  if (!signature || !timestampRaw) {
    return failed("slack_signature_missing");
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return failed("slack_timestamp_invalid");
  }

  const nowSec = Math.floor(input.receivedAt.getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > 10 * 60) {
    return failed("slack_timestamp_out_of_window");
  }

  const rawBody = JSON.stringify(input.body ?? {});
  const base = `v0:${timestampRaw}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(base, "utf8").digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    return failed("slack_signature_invalid");
  }

  return ok();
}

function createDiscordPublicKey(publicKeyHex: string): crypto.KeyObject | null {
  try {
    const key = Buffer.from(publicKeyHex, "hex");
    if (key.length !== 32) {
      return null;
    }
    const der = Buffer.concat([ED25519_SPKI_PREFIX, key]);
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

function validateDiscordSignature(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const publicKeyHex = readString(input.accountMetadata.discordPublicKey);
  if (!publicKeyHex) {
    return ok();
  }

  const signatureHex = readString(input.headers["x-signature-ed25519"]);
  const timestamp = readString(input.headers["x-signature-timestamp"]);
  if (!signatureHex || !timestamp) {
    return failed("discord_signature_missing");
  }

  const publicKey = createDiscordPublicKey(publicKeyHex);
  if (!publicKey) {
    return failed("discord_public_key_invalid");
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, "hex");
  } catch {
    return failed("discord_signature_invalid");
  }

  const payload = Buffer.from(`${timestamp}${JSON.stringify(input.body ?? {})}`, "utf8");
  const valid = crypto.verify(null, payload, publicKey, signature);
  if (!valid) {
    return failed("discord_signature_invalid");
  }

  return ok();
}

function validateWebhookHmac(input: ChannelIngressAuthInput, options: {
  secretKey: string;
  signatureHeader: string;
  reasonMissing: string;
  reasonInvalid: string;
  algorithm?: "sha1" | "sha256" | "sha512";
}): ChannelIngressAuthDecision {
  const secret = readString(input.accountMetadata[options.secretKey]);
  if (!secret) {
    return ok();
  }
  const signature = readString(input.headers[options.signatureHeader]);
  if (!signature) {
    return failed(options.reasonMissing);
  }
  const hmacInput = options.algorithm
    ? { payload: input.body, secret, signature, algorithm: options.algorithm }
    : { payload: input.body, secret, signature };
  if (!verifyHexHmac(hmacInput)) {
    return failed(options.reasonInvalid);
  }
  return ok();
}

function validateBearerOrHeaderToken(input: ChannelIngressAuthInput, options: {
  metadataKey: string;
  headerName: string;
  reason: string;
}): ChannelIngressAuthDecision {
  const headerToken = readString(input.headers[options.headerName]) ?? extractBearerToken(input.headers.authorization);
  return verifyIngressToken({
    metadata: input.accountMetadata,
    headerToken,
    metadataKey: options.metadataKey,
    reason: options.reason,
  });
}

function validateFeishuToken(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const expected =
    readString(input.accountMetadata.verificationToken) ?? readString(input.accountMetadata.verification_token);
  if (!expected) {
    return ok();
  }
  const bodyObject = asObject(input.body);
  const header = asObject(bodyObject?.header);
  const provided =
    readString(bodyObject?.token) ??
    readString(header?.token) ??
    readString(input.headers["x-lark-token"]);
  if (!provided || !safeEqual(provided, expected)) {
    return failed("feishu_token_invalid");
  }
  return ok();
}

function validateMattermostToken(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const expected = readString(input.accountMetadata.ingressToken) ?? readString(input.accountMetadata.token);
  if (!expected) {
    return ok();
  }
  const provided =
    readString(input.headers["x-mattermost-token"]) ??
    readString(asObject(input.body)?.token) ??
    extractBearerToken(input.headers.authorization);
  if (!provided || !safeEqual(provided, expected)) {
    return failed("mattermost_token_invalid");
  }
  return ok();
}

function validateTwitchSignature(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const secret = readString(input.accountMetadata.webhookSecret);
  if (!secret) {
    return ok();
  }

  const messageId = readString(input.headers["twitch-eventsub-message-id"]);
  const timestamp = readString(input.headers["twitch-eventsub-message-timestamp"]);
  const signature = readString(input.headers["twitch-eventsub-message-signature"]);
  if (!messageId || !timestamp || !signature) {
    return failed("twitch_signature_missing");
  }

  const body = JSON.stringify(input.body ?? {});
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(`${messageId}${timestamp}${body}`, "utf8").digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    return failed("twitch_signature_invalid");
  }
  return ok();
}

function validateZaloSignature(input: ChannelIngressAuthInput): ChannelIngressAuthDecision {
  const secret = readString(input.accountMetadata.webhookSecret);
  if (!secret) {
    return ok();
  }
  const signature = readString(input.headers["x-zalo-signature"]);
  if (!signature) {
    return failed("zalo_signature_missing");
  }
  if (!verifyHexHmac({ payload: input.body, secret, signature })) {
    return failed("zalo_signature_invalid");
  }
  return ok();
}

export function createWhatsappWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "whatsapp",
    authenticateWebhook(input) {
      return validateWebhookHmac(input, {
        secretKey: "appSecret",
        signatureHeader: "x-hub-signature-256",
        reasonMissing: "whatsapp_signature_missing",
        reasonInvalid: "whatsapp_signature_invalid",
      });
    },
    normalizeWebhook(input) {
      return createWhatsappEnvelope(input);
    },
  };
}

export function createTelegramWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "telegram",
    authenticateWebhook(input) {
      const expected = readString(input.accountMetadata.webhookSecretToken);
      if (!expected) {
        return ok();
      }
      const provided = readString(input.headers["x-telegram-bot-api-secret-token"]);
      if (!provided || !safeEqual(provided, expected)) {
        return failed("telegram_secret_token_invalid");
      }
      return ok();
    },
    normalizeWebhook(input) {
      return createTelegramEnvelope(input);
    },
  };
}

export function createDiscordWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "discord",
    authenticateWebhook(input) {
      return validateDiscordSignature(input);
    },
    normalizeWebhook(input) {
      return createDiscordEnvelope(input);
    },
  };
}

export function createIrcWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "irc",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-irc-token",
        reason: "irc_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createIrcEnvelope(input);
    },
  };
}

export function createSlackWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "slack",
    authenticateWebhook(input) {
      return validateSlackSignature(input);
    },
    normalizeWebhook(input) {
      return createSlackEnvelope(input);
    },
  };
}

export function createGoogleChatWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "googlechat",
    authenticateWebhook(input) {
      const expected = readString(input.accountMetadata.verificationToken);
      if (!expected) {
        return ok();
      }
      const provided =
        readString(input.headers["x-goog-chat-token"]) ??
        readString(asObject(input.body)?.token) ??
        readString(input.query.token);
      if (!provided || !safeEqual(provided, expected)) {
        return failed("googlechat_token_invalid");
      }
      return ok();
    },
    normalizeWebhook(input) {
      return createGoogleChatEnvelope(input);
    },
  };
}

export function createSignalWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "signal",
    authenticateWebhook(input) {
      const hmacDecision = validateWebhookHmac(input, {
        secretKey: "webhookSecret",
        signatureHeader: "x-signal-signature",
        reasonMissing: "signal_signature_missing",
        reasonInvalid: "signal_signature_invalid",
      });
      if (!hmacDecision.ok) {
        return hmacDecision;
      }

      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-signal-token",
        reason: "signal_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createSignalEnvelope(input);
    },
  };
}

export function createImessageWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "imessage",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-imessage-token",
        reason: "imessage_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createImessageEnvelope(input);
    },
  };
}

export function createFeishuWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "feishu",
    authenticateWebhook(input) {
      return validateFeishuToken(input);
    },
    normalizeWebhook(input) {
      return createFeishuEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createMattermostWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "mattermost",
    authenticateWebhook(input) {
      return validateMattermostToken(input);
    },
    normalizeWebhook(input) {
      return createMattermostEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createBluebubblesWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "bluebubbles",
    authenticateWebhook(input) {
      const hmacDecision = validateWebhookHmac(input, {
        secretKey: "webhookSecret",
        signatureHeader: "x-bluebubbles-signature",
        reasonMissing: "bluebubbles_signature_missing",
        reasonInvalid: "bluebubbles_signature_invalid",
      });
      if (!hmacDecision.ok) {
        return hmacDecision;
      }
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-bluebubbles-token",
        reason: "bluebubbles_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createBluebubblesEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createNextcloudTalkWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "nextcloud-talk",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-nextcloud-talk-token",
        reason: "nextcloud_talk_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createNextcloudTalkEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createTwitchWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "twitch",
    authenticateWebhook(input) {
      const signatureDecision = validateTwitchSignature(input);
      if (!signatureDecision.ok) {
        return signatureDecision;
      }
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-twitch-token",
        reason: "twitch_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createTwitchEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createWebchatWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "webchat",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-webchat-token",
        reason: "webchat_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createWebchatEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createNostrWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "nostr",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-nostr-token",
        reason: "nostr_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createNostrEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createTlonWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "tlon",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-tlon-token",
        reason: "tlon_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createTlonEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createZaloWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "zalo",
    authenticateWebhook(input) {
      const signatureDecision = validateZaloSignature(input);
      if (!signatureDecision.ok) {
        return signatureDecision;
      }
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-zalo-token",
        reason: "zalo_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createZaloEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createZalouserWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "zalouser",
    authenticateWebhook(input) {
      const tokenDecision = validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-zalouser-token",
        reason: "zalouser_token_invalid",
      });
      if (tokenDecision.ok) {
        return tokenDecision;
      }
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-zalo-user-token",
        reason: "zalouser_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createZalouserEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createMsteamsWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "msteams",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-msteams-token",
        reason: "msteams_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createMsteamsEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createLineWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "line",
    authenticateWebhook(input) {
      const secret = readString(input.accountMetadata.channelSecret);
      if (!secret) {
        return validateBearerOrHeaderToken(input, {
          metadataKey: "ingressToken",
          headerName: "x-line-token",
          reason: "line_token_invalid",
        });
      }
      const signature = readString(input.headers["x-line-signature"]);
      if (!signature) {
        return failed("line_signature_missing");
      }
      if (!verifyBase64Hmac({ payload: input.body, secret, signature })) {
        return failed("line_signature_invalid");
      }
      return ok();
    },
    normalizeWebhook(input) {
      return createLineEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}

export function createMatrixWebhookAdapter(): ChannelIngressAdapter {
  return {
    channelId: "matrix",
    authenticateWebhook(input) {
      return validateBearerOrHeaderToken(input, {
        metadataKey: "ingressToken",
        headerName: "x-matrix-token",
        reason: "matrix_token_invalid",
      });
    },
    normalizeWebhook(input) {
      return createMatrixEnvelope(input) ?? normalizeGenericEnvelope(input, ["@vespid"]);
    },
  };
}
