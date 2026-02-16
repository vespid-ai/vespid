import { listChannelDefinitions } from "@vespid/channels";
import type { ChannelId, ChannelInboundEnvelope } from "@vespid/shared";
import {
  createDiscordWebhookAdapter,
  createGoogleChatWebhookAdapter,
  createImessageWebhookAdapter,
  createIrcWebhookAdapter,
  createSignalWebhookAdapter,
  createSlackWebhookAdapter,
  createTelegramWebhookAdapter,
  createWhatsappWebhookAdapter,
} from "./adapters/core.js";
import { createGenericWebhookAdapter } from "./adapters/webhook.js";

export type ChannelIngressAdapterInput = {
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
  organizationId: string;
  body: unknown;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  receivedAt: Date;
};

export type ChannelIngressAuthInput = ChannelIngressAdapterInput & {
  accountMetadata: Record<string, unknown>;
};

export type ChannelIngressAuthDecision = {
  ok: boolean;
  reason?: string;
};

export type ChannelIngressAdapter = {
  readonly channelId: ChannelId;
  authenticateWebhook?(input: ChannelIngressAuthInput): ChannelIngressAuthDecision;
  normalizeWebhook(input: ChannelIngressAdapterInput): ChannelInboundEnvelope | null;
};

export type ChannelIngressAdapterRegistry = {
  register(adapter: ChannelIngressAdapter): void;
  get(channelId: ChannelId): ChannelIngressAdapter | null;
};

export function createChannelIngressAdapterRegistry(): ChannelIngressAdapterRegistry {
  const adapters = new Map<ChannelId, ChannelIngressAdapter>();
  return {
    register(adapter) {
      adapters.set(adapter.channelId, adapter);
    },
    get(channelId) {
      return adapters.get(channelId) ?? null;
    },
  };
}

export function createDefaultChannelIngressAdapterRegistry(): ChannelIngressAdapterRegistry {
  const registry = createChannelIngressAdapterRegistry();
  for (const channel of listChannelDefinitions()) {
    switch (channel.id) {
      case "whatsapp":
        registry.register(createWhatsappWebhookAdapter());
        break;
      case "telegram":
        registry.register(createTelegramWebhookAdapter());
        break;
      case "discord":
        registry.register(createDiscordWebhookAdapter());
        break;
      case "irc":
        registry.register(createIrcWebhookAdapter());
        break;
      case "slack":
        registry.register(createSlackWebhookAdapter());
        break;
      case "googlechat":
        registry.register(createGoogleChatWebhookAdapter());
        break;
      case "signal":
        registry.register(createSignalWebhookAdapter());
        break;
      case "imessage":
        registry.register(createImessageWebhookAdapter());
        break;
      default:
        registry.register(createGenericWebhookAdapter(channel.id));
        break;
    }
  }
  return registry;
}
