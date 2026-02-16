import { z } from "zod";

export const channelIdSchema = z.enum([
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
]);

export type ChannelId = z.infer<typeof channelIdSchema>;

export type ChannelCategory = "core" | "extended";

export type ChannelDefinition = {
  id: ChannelId;
  label: string;
  category: ChannelCategory;
  docsPath: string;
  requiresExternalRuntime: boolean;
  defaultDmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  defaultRequireMentionInGroup: boolean;
  supportsWebhook: boolean;
  supportsLongPolling: boolean;
  supportsSocketMode: boolean;
  runtimeDependencies?: string[];
  onboardingHints?: string[];
};

export type ChannelDmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type ChannelGroupPolicy = "allowlist" | "open" | "disabled";

export type ChannelSecurityDefaults = {
  dmPolicy: ChannelDmPolicy;
  groupPolicy: ChannelGroupPolicy;
  requireMentionInGroup: boolean;
};

export type ChannelPluginContext = {
  organizationId: string;
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
};

export type ChannelPlugin = {
  id: ChannelId;
  start?(ctx: ChannelPluginContext): Promise<void>;
  stop?(ctx: ChannelPluginContext): Promise<void>;
  reconnect?(ctx: ChannelPluginContext): Promise<void>;
  login?(ctx: ChannelPluginContext): Promise<void>;
  logout?(ctx: ChannelPluginContext): Promise<void>;
};

const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    category: "core",
    docsPath: "/channels/whatsapp",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
  },
  {
    id: "telegram",
    label: "Telegram",
    category: "core",
    docsPath: "/channels/telegram",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
  },
  {
    id: "discord",
    label: "Discord",
    category: "core",
    docsPath: "/channels/discord",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "irc",
    label: "IRC",
    category: "core",
    docsPath: "/channels/irc",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "slack",
    label: "Slack",
    category: "core",
    docsPath: "/channels/slack",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "googlechat",
    label: "Google Chat",
    category: "core",
    docsPath: "/channels/googlechat",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
  },
  {
    id: "signal",
    label: "Signal",
    category: "core",
    docsPath: "/channels/signal",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    runtimeDependencies: ["signal-cli bridge"],
    onboardingHints: ["Run signal-cli sidecar and expose a callback URL to gateway ingress."],
  },
  {
    id: "imessage",
    label: "iMessage",
    category: "core",
    docsPath: "/channels/imessage",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    runtimeDependencies: ["iMessage bridge daemon"],
    onboardingHints: ["Use a dedicated macOS bridge host or sidecar runtime for iMessage integration."],
  },
  {
    id: "feishu",
    label: "Feishu",
    category: "extended",
    docsPath: "/channels/feishu",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "mattermost",
    label: "Mattermost",
    category: "extended",
    docsPath: "/channels/mattermost",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "bluebubbles",
    label: "BlueBubbles",
    category: "extended",
    docsPath: "/channels/bluebubbles",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    runtimeDependencies: ["BlueBubbles server"],
    onboardingHints: ["Ensure BlueBubbles server can call gateway ingress endpoint."],
  },
  {
    id: "msteams",
    label: "Microsoft Teams",
    category: "extended",
    docsPath: "/channels/msteams",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    runtimeDependencies: ["Microsoft Bot Framework adapter"],
    onboardingHints: ["Configure Bot Framework endpoint to point at gateway ingress URL."],
  },
  {
    id: "line",
    label: "LINE",
    category: "extended",
    docsPath: "/channels/line",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
  },
  {
    id: "nextcloud-talk",
    label: "Nextcloud Talk",
    category: "extended",
    docsPath: "/channels/nextcloud-talk",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "matrix",
    label: "Matrix",
    category: "extended",
    docsPath: "/channels/matrix",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: true,
  },
  {
    id: "nostr",
    label: "Nostr",
    category: "extended",
    docsPath: "/channels/nostr",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: true,
  },
  {
    id: "tlon",
    label: "Tlon",
    category: "extended",
    docsPath: "/channels/tlon",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
  },
  {
    id: "twitch",
    label: "Twitch",
    category: "extended",
    docsPath: "/channels/twitch",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
  {
    id: "zalo",
    label: "Zalo",
    category: "extended",
    docsPath: "/channels/zalo",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
  },
  {
    id: "zalouser",
    label: "Zalo Personal",
    category: "extended",
    docsPath: "/channels/zalouser",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
  },
  {
    id: "webchat",
    label: "WebChat",
    category: "extended",
    docsPath: "/web/webchat",
    requiresExternalRuntime: false,
    defaultDmPolicy: "allowlist",
    defaultRequireMentionInGroup: false,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
  },
];

export function listChannelDefinitions(): ChannelDefinition[] {
  return [...CHANNEL_DEFINITIONS];
}

export function getChannelDefinition(channelId: ChannelId): ChannelDefinition {
  const found = CHANNEL_DEFINITIONS.find((c) => c.id === channelId);
  if (!found) {
    throw new Error(`CHANNEL_NOT_SUPPORTED:${channelId}`);
  }
  return found;
}

export function channelDefaults(channelId: ChannelId): ChannelSecurityDefaults {
  const found = getChannelDefinition(channelId);
  return {
    dmPolicy: found.defaultDmPolicy,
    groupPolicy: "allowlist",
    requireMentionInGroup: found.defaultRequireMentionInGroup,
  };
}

export type ChannelPluginRegistry = {
  register(plugin: ChannelPlugin): void;
  get(channelId: ChannelId): ChannelPlugin | null;
  list(): ChannelPlugin[];
};

export function createChannelPluginRegistry(): ChannelPluginRegistry {
  const plugins = new Map<ChannelId, ChannelPlugin>();
  return {
    register(plugin) {
      plugins.set(plugin.id, plugin);
    },
    get(channelId) {
      return plugins.get(channelId) ?? null;
    },
    list() {
      return [...plugins.values()];
    },
  };
}

export const channelAccountConfigSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  groupPolicy: z.enum(["allowlist", "open", "disabled"]).optional(),
  requireMentionInGroup: z.boolean().optional(),
  webhookUrl: z.string().url().max(2000).optional(),
  webhookSecret: z.string().min(8).max(256).optional(),
  metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
});

export type ChannelAccountConfig = z.infer<typeof channelAccountConfigSchema>;
