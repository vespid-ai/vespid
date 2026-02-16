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

export type ChannelOnboardingMode = "oauth" | "webhook" | "token" | "qr" | "daemon" | "socket";

export type ChannelMetadataSpec = {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  description?: string;
};

export type ChannelDefinition = {
  id: ChannelId;
  label: string;
  category: ChannelCategory;
  docsPath: string;
  onboardingMode: ChannelOnboardingMode;
  requiresExternalRuntime: boolean;
  defaultDmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  defaultRequireMentionInGroup: boolean;
  supportsWebhook: boolean;
  supportsLongPolling: boolean;
  supportsSocketMode: boolean;
  metadataSpecs?: ChannelMetadataSpec[];
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
    onboardingMode: "token",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "appSecret",
        label: "App Secret",
        required: false,
        placeholder: "whatsapp-app-secret",
        description: "Used to verify x-hub-signature-256 when webhook signature validation is enabled.",
      },
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    category: "core",
    docsPath: "/channels/telegram",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "webhookSecretToken",
        label: "Webhook Secret Token",
        required: false,
        placeholder: "telegram-secret-token",
        description: "Validated against x-telegram-bot-api-secret-token.",
      },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    category: "core",
    docsPath: "/channels/discord",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "discordPublicKey",
        label: "Discord Public Key (hex)",
        required: true,
        placeholder: "32-byte-ed25519-public-key-hex",
        description: "Used to validate x-signature-ed25519 for interaction/message callbacks.",
      },
    ],
  },
  {
    id: "irc",
    label: "IRC",
    category: "core",
    docsPath: "/channels/irc",
    onboardingMode: "socket",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "irc-ingress-token",
        description: "Validated from x-irc-token or Authorization Bearer token.",
      },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    category: "core",
    docsPath: "/channels/slack",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "signingSecret",
        label: "Signing Secret",
        required: true,
        placeholder: "slack-signing-secret",
        description: "Required to validate x-slack-signature and timestamp window.",
      },
    ],
  },
  {
    id: "googlechat",
    label: "Google Chat",
    category: "core",
    docsPath: "/channels/googlechat",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "verificationToken",
        label: "Verification Token",
        required: false,
        placeholder: "google-chat-token",
        description: "Validated from x-goog-chat-token, payload token, or query token.",
      },
    ],
  },
  {
    id: "signal",
    label: "Signal",
    category: "core",
    docsPath: "/channels/signal",
    onboardingMode: "daemon",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        required: false,
        placeholder: "signal-webhook-secret",
        description: "Validated against x-signal-signature.",
      },
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "signal-ingress-token",
        description: "Validated from x-signal-token or Authorization header.",
      },
    ],
    runtimeDependencies: ["signal-cli bridge"],
    onboardingHints: ["Run signal-cli sidecar and expose a callback URL to gateway ingress."],
  },
  {
    id: "imessage",
    label: "iMessage",
    category: "core",
    docsPath: "/channels/imessage",
    onboardingMode: "daemon",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "imessage-ingress-token",
        description: "Validated from x-imessage-token or Authorization header.",
      },
    ],
    runtimeDependencies: ["iMessage bridge daemon"],
    onboardingHints: ["Use a dedicated macOS bridge host or sidecar runtime for iMessage integration."],
  },
  {
    id: "feishu",
    label: "Feishu",
    category: "extended",
    docsPath: "/channels/feishu",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "verificationToken",
        label: "Verification Token",
        required: false,
        placeholder: "feishu-verification-token",
        description: "Validated from payload/header token.",
      },
    ],
  },
  {
    id: "mattermost",
    label: "Mattermost",
    category: "extended",
    docsPath: "/channels/mattermost",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "mattermost-token",
        description: "Validated from x-mattermost-token, payload token, or Authorization header.",
      },
    ],
  },
  {
    id: "bluebubbles",
    label: "BlueBubbles",
    category: "extended",
    docsPath: "/channels/bluebubbles",
    onboardingMode: "daemon",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        required: false,
        placeholder: "bluebubbles-webhook-secret",
        description: "Validated against x-bluebubbles-signature.",
      },
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "bluebubbles-ingress-token",
        description: "Validated from x-bluebubbles-token or Authorization header.",
      },
    ],
    runtimeDependencies: ["BlueBubbles server"],
    onboardingHints: ["Ensure BlueBubbles server can call gateway ingress endpoint."],
  },
  {
    id: "msteams",
    label: "Microsoft Teams",
    category: "extended",
    docsPath: "/channels/msteams",
    onboardingMode: "oauth",
    requiresExternalRuntime: true,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "msteams-ingress-token",
        description: "Validated from x-msteams-token or Authorization header.",
      },
    ],
    runtimeDependencies: ["Microsoft Bot Framework adapter"],
    onboardingHints: ["Configure Bot Framework endpoint to point at gateway ingress URL."],
  },
  {
    id: "line",
    label: "LINE",
    category: "extended",
    docsPath: "/channels/line",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "channelSecret",
        label: "Channel Secret",
        required: false,
        placeholder: "line-channel-secret",
        description: "Validated against x-line-signature (base64 HMAC).",
      },
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "line-ingress-token",
        description: "Fallback token when channelSecret is not configured.",
      },
    ],
  },
  {
    id: "nextcloud-talk",
    label: "Nextcloud Talk",
    category: "extended",
    docsPath: "/channels/nextcloud-talk",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "nextcloud-talk-token",
        description: "Validated from x-nextcloud-talk-token or Authorization header.",
      },
    ],
  },
  {
    id: "matrix",
    label: "Matrix",
    category: "extended",
    docsPath: "/channels/matrix",
    onboardingMode: "token",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "matrix-ingress-token",
        description: "Validated from x-matrix-token or Authorization header.",
      },
    ],
  },
  {
    id: "nostr",
    label: "Nostr",
    category: "extended",
    docsPath: "/channels/nostr",
    onboardingMode: "socket",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "nostr-ingress-token",
        description: "Validated from x-nostr-token or Authorization header.",
      },
    ],
  },
  {
    id: "tlon",
    label: "Tlon",
    category: "extended",
    docsPath: "/channels/tlon",
    onboardingMode: "token",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "tlon-ingress-token",
        description: "Validated from x-tlon-token or Authorization header.",
      },
    ],
  },
  {
    id: "twitch",
    label: "Twitch",
    category: "extended",
    docsPath: "/channels/twitch",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        required: false,
        placeholder: "twitch-webhook-secret",
        description: "Validated against EventSub signature headers.",
      },
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "twitch-ingress-token",
        description: "Validated from x-twitch-token or Authorization header.",
      },
    ],
  },
  {
    id: "zalo",
    label: "Zalo",
    category: "extended",
    docsPath: "/channels/zalo",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        required: false,
        placeholder: "zalo-webhook-secret",
        description: "Validated against x-zalo-signature.",
      },
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "zalo-ingress-token",
        description: "Validated from x-zalo-token or Authorization header.",
      },
    ],
  },
  {
    id: "zalouser",
    label: "Zalo Personal",
    category: "extended",
    docsPath: "/channels/zalouser",
    onboardingMode: "webhook",
    requiresExternalRuntime: false,
    defaultDmPolicy: "pairing",
    defaultRequireMentionInGroup: true,
    supportsWebhook: true,
    supportsLongPolling: true,
    supportsSocketMode: false,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "zalouser-ingress-token",
        description: "Validated from x-zalouser-token / x-zalo-user-token or Authorization header.",
      },
    ],
  },
  {
    id: "webchat",
    label: "WebChat",
    category: "extended",
    docsPath: "/web/webchat",
    onboardingMode: "socket",
    requiresExternalRuntime: false,
    defaultDmPolicy: "allowlist",
    defaultRequireMentionInGroup: false,
    supportsWebhook: false,
    supportsLongPolling: false,
    supportsSocketMode: true,
    metadataSpecs: [
      {
        key: "ingressToken",
        label: "Ingress Token",
        required: false,
        placeholder: "webchat-ingress-token",
        description: "Validated from x-webchat-token or Authorization header.",
      },
    ],
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
