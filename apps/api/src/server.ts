import crypto from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
  type AppError as AppErrorType,
  validateAgentSkillBundles,
  validateMcpPlaceholderPolicy,
  type ToolsetCatalogItem,
  type ToolsetDraft,
  type ToolsetBuilderLlmConfig,
  getAllAgentSecretConnectorIds,
  getAllLlmConnectorIds,
  getAgentEngineMeta,
  getCatalogSnapshotInfo,
  getDefaultConnectorIdForProvider,
  getDefaultModelForProvider,
  getLlmProviderMeta,
  isAgentEngineId,
  isOAuthRequiredProvider,
  listPlatformCapabilities,
  listAgentEngines,
  listAllCatalogModels,
  listLlmProviders,
  normalizeLlmProviderId,
  normalizeConnectorId,
  providerSupportsContext,
  type LlmProviderApiKind,
  type LlmProviderId,
  type LlmUsageContext,
} from "@vespid/shared";
import { signAuthToken, verifyAuthToken } from "@vespid/shared/auth";
import { createConnectorCatalog } from "@vespid/connectors";
import { listChannelDefinitions } from "@vespid/channels";
import { generateCodeVerifier, generateState } from "arctic";
import { z } from "zod";
import { createOAuthServiceFromEnv, type OAuthProvider, type OAuthService } from "./oauth.js";
import { createVertexOAuthServiceFromEnv, type VertexOAuthService } from "./vertex-oauth.js";
import { createStore } from "./store/index.js";
import type { AppStore, MembershipRecord, SessionRecord, UserRecord } from "./types.js";
import { hashPassword, verifyPassword } from "./security.js";
import { workflowDslAnySchema, validateV3GraphConstraints } from "@vespid/workflow";
import { getToolsetCatalog } from "./toolsets/catalog.js";
import { openAiChatCompletion, type OpenAiChatMessage } from "./llm/openai.js";
import { anthropicChatCompletion } from "./llm/anthropic.js";
import { geminiGenerateContent } from "./llm/gemini.js";
import { vertexGenerateContent } from "./llm/vertex.js";
import {
  createBullMqWorkflowRunQueueProducer,
  createInMemoryWorkflowRunQueueProducer,
  type WorkflowRunQueueProducer,
} from "./queue/producer.js";

type AuthContext = {
  userId: string;
  email: string;
  sessionId: string;
};

type OrgContext = {
  organizationId: string;
  membership: MembershipRecord;
};

type OrgContextEnforcement = "strict" | "warn";

type OAuthStateRecord = {
  provider: OAuthProvider;
  codeVerifier: string;
  nonce: string;
  expiresAtSec: number;
};

type VertexOAuthStateRecord = {
  organizationId: string;
  userId: string;
  projectId: string;
  location: string;
  codeVerifier: string;
  nonce: string;
  expiresAtSec: number;
};

type LlmOAuthDeviceStateRecord = {
  organizationId: string;
  userId: string;
  provider: LlmProviderId;
  name: string;
  expiresAtSec: number;
};

type RefreshTokenPayload = {
  sessionId: string;
  userId: string;
  tokenNonce: string;
  expiresAt: number;
};

type AgentInstallerConfig = {
  enabled: boolean;
  commandMode: "auto" | "npm" | "local-dev";
  npmPackage: string;
  npmDistTag: string;
  npmRegistryUrl: string;
  docsUrl: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    orgContext?: OrgContext;
    orgContextWarnings?: string[];
  }
}

const ACCESS_TOKEN_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 15 * 60);
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC ?? 7 * 24 * 60 * 60);
const OAUTH_CONTEXT_TTL_SEC = Number(process.env.OAUTH_CONTEXT_TTL_SEC ?? 10 * 60);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "vespid_session";
const OAUTH_STATE_COOKIE_NAME = "vespid_oauth_state";
const OAUTH_NONCE_COOKIE_NAME = "vespid_oauth_nonce";
const VERTEX_OAUTH_STATE_COOKIE_NAME = "vespid_vertex_oauth_state";
const VERTEX_OAUTH_NONCE_COOKIE_NAME = "vespid_vertex_oauth_nonce";
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const API_LOG_LEVEL = process.env.API_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
const ORG_CONTEXT_ENFORCEMENT = z
  .enum(["strict", "warn"])
  .default("strict")
  .parse(process.env.ORG_CONTEXT_ENFORCEMENT ?? "strict");
const INTERNAL_API_SERVICE_TOKEN =
  process.env.INTERNAL_API_SERVICE_TOKEN ?? process.env.API_SERVICE_TOKEN ?? process.env.GATEWAY_SERVICE_TOKEN ?? "dev-gateway-token";
const GATEWAY_HTTP_URL = process.env.GATEWAY_HTTP_URL ?? "http://localhost:3002";
const GATEWAY_INTERNAL_SERVICE_TOKEN =
  process.env.GATEWAY_SERVICE_TOKEN ?? process.env.INTERNAL_API_SERVICE_TOKEN ?? process.env.API_SERVICE_TOKEN ?? "dev-gateway-token";
const DEFAULT_AGENT_INSTALLER_NPM_PACKAGE = "@vespid/node-agent";
const DEFAULT_AGENT_INSTALLER_NPM_DIST_TAG = "latest";
const DEFAULT_AGENT_INSTALLER_NPM_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_AGENT_INSTALLER_COMMAND_MODE = "auto";

const DEFAULT_LLM_OAUTH_VERIFY_URLS: Partial<Record<LlmProviderId, string>> = {
  "openai-codex": "https://chatgpt.com",
  "google-antigravity": "https://aistudio.google.com",
  "google-gemini-cli": "https://aistudio.google.com",
  "github-copilot": "https://github.com/login/device",
  "qwen-portal": "https://chat.qwen.ai",
  "minimax-portal": "https://www.minimax.io",
  chutes: "https://chutes.ai",
};

function readSystemAdminEmailAllowlist(): Set<string> {
  return new Set(
    (process.env.SYSTEM_ADMIN_EMAIL_ALLOWLIST ?? process.env.SYSTEM_ADMIN_BOOTSTRAP_EMAILS ?? process.env.SYSTEM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  );
}

type TierOrgPolicy = {
  canManageOrg: boolean;
  maxOrgs: number | null;
};

type OrgPolicy = {
  free: TierOrgPolicy;
  paid: TierOrgPolicy;
  enterprise: TierOrgPolicy;
};

type MeOrgPolicy = {
  canManageOrganizations: boolean;
  maxOrganizations: number | null;
  currentOrganizations: number;
};

const DEFAULT_ORG_POLICY: OrgPolicy = {
  free: { canManageOrg: false, maxOrgs: 1 },
  paid: { canManageOrg: true, maxOrgs: 5 },
  enterprise: { canManageOrg: true, maxOrgs: null },
};

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,50}$/),
});

const adminSystemAdminMutationSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: "Either userId or email is required",
    path: ["userId"],
  });

const adminPlatformSettingUpdateSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
});

const adminSupportTicketsQuerySchema = z.object({
  status: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const adminSupportTicketCreateSchema = z.object({
  requesterUserId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  category: z.string().min(1).max(120).optional(),
  priority: z.string().min(1).max(40).optional(),
  status: z.string().min(1).max(40).optional(),
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  assigneeUserId: z.string().uuid().nullable().optional(),
});

const adminSupportTicketPatchSchema = z
  .object({
    status: z.string().min(1).max(40).optional(),
    priority: z.string().min(1).max(40).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

const adminSupportTicketEventCreateSchema = z.object({
  eventType: z.string().min(1).max(80),
  payload: z.unknown().optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  roleKey: z.enum(["admin", "member"]),
});

const roleMutationSchema = z.object({
  roleKey: z.enum(["owner", "admin", "member"]),
});

const createWorkflowSchema = z.object({
  name: z.string().min(2).max(120),
  dsl: workflowDslAnySchema,
});

const updateWorkflowDraftSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    dsl: workflowDslAnySchema.optional(),
    editorState: z.unknown().optional(),
  })
  .strict();

const createWorkflowRunSchema = z.object({
  input: z.unknown().optional(),
});

const internalChannelTriggerRunSchema = z
  .object({
    organizationId: z.string().uuid(),
    workflowId: z.string().uuid(),
    requestedByUserId: z.string().uuid(),
    payload: z.unknown(),
  })
  .strict();

const listSecretsQuerySchema = z.object({
  connectorId: z.string().min(1).optional(),
});

const createSecretSchema = z.object({
  connectorId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  value: z.string().min(1),
});

const rotateSecretSchema = z.object({
  value: z.string().min(1),
});

const llmProviderTestKeySchema = z
  .object({
    value: z.string().min(1),
    model: z.string().min(1).max(200).optional(),
  })
  .strict();

const llmApiKindValues = [
  "openai-compatible",
  "anthropic-compatible",
  "google",
  "vertex",
  "bedrock",
  "copilot",
  "custom",
] as const;

const llmProviderInputSchema = z.string().min(1).transform((value, ctx) => {
  const normalized = normalizeLlmProviderId(value);
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unsupported provider: ${value}` });
    return z.NEVER;
  }
  return normalized;
});

const llmNullableProviderInputSchema = z.union([llmProviderInputSchema, z.null()]);

const llmDefaultPrimarySchema = z
  .object({
    provider: llmNullableProviderInputSchema.optional(),
    model: z.string().min(1).max(200).nullable().optional(),
    secretId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider && !providerSupportsContext(value.provider, "session")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.provider} cannot be used in primary default context`,
        path: ["provider"],
      });
    }
  });

const agentEngineAuthDefaultSchema = z
  .object({
    mode: z.enum(["oauth_executor", "api_key"]).optional(),
    secretId: z.string().uuid().nullable().optional(),
  })
  .strict();

const agentEngineAuthDefaultsSchema = z
  .object({
    "gateway.codex.v2": agentEngineAuthDefaultSchema.optional(),
    "gateway.claude.v2": agentEngineAuthDefaultSchema.optional(),
    "gateway.opencode.v2": agentEngineAuthDefaultSchema.optional(),
  })
  .strict();

const agentEngineRuntimeDefaultSchema = z
  .object({
    baseUrl: z.string().url().max(2000).nullable().optional(),
  })
  .strict();

const agentEngineRuntimeDefaultsSchema = z
  .object({
    "gateway.codex.v2": agentEngineRuntimeDefaultSchema.optional(),
    "gateway.claude.v2": agentEngineRuntimeDefaultSchema.optional(),
    "gateway.opencode.v2": agentEngineRuntimeDefaultSchema.optional(),
  })
  .strict();

const channelIdSchema = z.enum([
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

const channelAccountCreateSchema = z
  .object({
    channelId: channelIdSchema,
    accountKey: z.string().min(1).max(120),
    displayName: z.string().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    groupPolicy: z.enum(["allowlist", "open", "disabled"]).optional(),
    requireMentionInGroup: z.boolean().optional(),
    webhookUrl: z.string().url().max(2000).optional(),
    metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
  })
  .strict();

const channelAccountUpdateSchema = z
  .object({
    displayName: z.string().min(1).max(120).nullable().optional(),
    enabled: z.boolean().optional(),
    dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    groupPolicy: z.enum(["allowlist", "open", "disabled"]).optional(),
    requireMentionInGroup: z.boolean().optional(),
    webhookUrl: z.string().url().max(2000).nullable().optional(),
    metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
    status: z.string().min(1).max(40).optional(),
    lastError: z.string().min(1).max(10_000).nullable().optional(),
  })
  .strict();

const channelSecretCreateSchema = z.object({
  name: z.string().min(1).max(80),
  value: z.string().min(1),
});

const channelAllowlistEntrySchema = z
  .object({
    scope: z.string().min(1).max(64),
    subject: z.string().min(1).max(240),
  })
  .strict();

const channelTestSendSchema = z
  .object({
    conversationId: z.string().min(1).max(240),
    text: z.string().min(1).max(10_000),
    replyToProviderMessageId: z.string().min(1).max(240).optional(),
  })
  .strict();

const orgSettingsSchema = z
  .object({
    tools: z
      .object({
        shellRunEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    toolsets: z
      .object({
        defaultToolsetId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .optional(),
    llm: z
      .object({
        defaults: z
          .object({
            primary: llmDefaultPrimarySchema.optional(),
          })
          .strict()
          .optional(),
        providers: z
          .record(
            z.string().min(1),
            z
              .object({
                baseUrl: z.string().url().max(2000).nullable().optional(),
                apiKind: z.enum(llmApiKindValues).nullable().optional(),
              })
              .strict()
          )
          .optional(),
      })
      .strict()
      .optional(),
    agents: z
      .object({
        engineAuthDefaults: agentEngineAuthDefaultsSchema.optional(),
        engineRuntimeDefaults: agentEngineRuntimeDefaultsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function normalizeProviderDefault(input: {
  provider: LlmProviderId | null;
  model: string | null;
  secretId: string | null;
  context: LlmUsageContext;
}): { provider: LlmProviderId | null; model: string | null; secretId: string | null } {
  if (!input.provider) {
    return { provider: null, model: input.model, secretId: input.secretId };
  }
  if (!providerSupportsContext(input.provider, input.context)) {
    return { provider: null, model: input.model, secretId: input.secretId };
  }
  return {
    provider: input.provider,
    model: input.model ?? getDefaultModelForProvider(input.provider),
    secretId: input.secretId,
  };
}

type AgentEngineAuthDefault = {
  mode: "oauth_executor" | "api_key";
  secretId: string | null;
};

type AgentEngineAuthDefaults = {
  "gateway.codex.v2": AgentEngineAuthDefault;
  "gateway.claude.v2": AgentEngineAuthDefault;
  "gateway.opencode.v2": AgentEngineAuthDefault;
};

type AgentEngineRuntimeDefault = {
  baseUrl: string | null;
};

type AgentEngineRuntimeDefaults = {
  "gateway.codex.v2": AgentEngineRuntimeDefault;
  "gateway.claude.v2": AgentEngineRuntimeDefault;
  "gateway.opencode.v2": AgentEngineRuntimeDefault;
};

function defaultEngineAuthMode(engineId: keyof AgentEngineAuthDefaults): "oauth_executor" | "api_key" {
  return engineId === "gateway.opencode.v2" ? "api_key" : "oauth_executor";
}

function normalizeAgentEngineAuthDefault(engineId: keyof AgentEngineAuthDefaults, value: unknown): AgentEngineAuthDefault {
  const parsed = agentEngineAuthDefaultSchema.safeParse(value ?? {});
  const mode = parsed.success && parsed.data.mode ? parsed.data.mode : defaultEngineAuthMode(engineId);
  const secretId = parsed.success && "secretId" in parsed.data ? (parsed.data.secretId ?? null) : null;
  if (mode === "oauth_executor") {
    return { mode, secretId: null };
  }
  return { mode, secretId };
}

function normalizeAgentEngineAuthDefaults(value: unknown): AgentEngineAuthDefaults {
  const parsed = agentEngineAuthDefaultsSchema.safeParse(value ?? {});
  const raw = parsed.success ? parsed.data : {};
  return {
    "gateway.codex.v2": normalizeAgentEngineAuthDefault("gateway.codex.v2", raw["gateway.codex.v2"]),
    "gateway.claude.v2": normalizeAgentEngineAuthDefault("gateway.claude.v2", raw["gateway.claude.v2"]),
    "gateway.opencode.v2": normalizeAgentEngineAuthDefault("gateway.opencode.v2", raw["gateway.opencode.v2"]),
  };
}

function normalizeAgentEngineRuntimeDefault(value: unknown): AgentEngineRuntimeDefault {
  const parsed = agentEngineRuntimeDefaultSchema.safeParse(value ?? {});
  if (!parsed.success) {
    return { baseUrl: null };
  }
  return {
    baseUrl: typeof parsed.data.baseUrl === "string" ? parsed.data.baseUrl : null,
  };
}

function normalizeAgentEngineRuntimeDefaults(value: unknown): AgentEngineRuntimeDefaults {
  const parsed = agentEngineRuntimeDefaultsSchema.safeParse(value ?? {});
  const raw = parsed.success ? parsed.data : {};
  return {
    "gateway.codex.v2": normalizeAgentEngineRuntimeDefault(raw["gateway.codex.v2"]),
    "gateway.claude.v2": normalizeAgentEngineRuntimeDefault(raw["gateway.claude.v2"]),
    "gateway.opencode.v2": normalizeAgentEngineRuntimeDefault(raw["gateway.opencode.v2"]),
  };
}

function normalizeOrgSettings(input: unknown): {
  tools: { shellRunEnabled: boolean };
  toolsets: { defaultToolsetId: string | null };
  llm: {
    defaults: {
      primary: { provider: LlmProviderId | null; model: string | null; secretId: string | null };
    };
    providers: Partial<Record<LlmProviderId, { baseUrl: string | null; apiKind: LlmProviderApiKind | null }>>;
  };
  agents: {
    engineAuthDefaults: AgentEngineAuthDefaults;
    engineRuntimeDefaults: AgentEngineRuntimeDefaults;
  };
} {
  const root = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const toolsRaw = root["tools"];
  const toolsetsRaw = root["toolsets"];
  const llmRaw = root["llm"];
  const agentsRaw = root["agents"];

  const toolsObj = toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw) ? (toolsRaw as Record<string, unknown>) : {};
  const toolsetsObj =
    toolsetsRaw && typeof toolsetsRaw === "object" && !Array.isArray(toolsetsRaw) ? (toolsetsRaw as Record<string, unknown>) : {};
  const llmObj = llmRaw && typeof llmRaw === "object" && !Array.isArray(llmRaw) ? (llmRaw as Record<string, unknown>) : {};
  const agentsObj =
    agentsRaw && typeof agentsRaw === "object" && !Array.isArray(agentsRaw) ? (agentsRaw as Record<string, unknown>) : {};

  const llmProviders: Partial<Record<LlmProviderId, { baseUrl: string | null; apiKind: LlmProviderApiKind | null }>> = {};

  const providersRaw = llmObj["providers"];
  const providersObj =
    providersRaw && typeof providersRaw === "object" && !Array.isArray(providersRaw)
      ? (providersRaw as Record<string, unknown>)
      : {};
  for (const [providerIdRaw, confRaw] of Object.entries(providersObj)) {
    const providerId = normalizeLlmProviderId(providerIdRaw);
    if (!providerId) continue;
    const conf = confRaw && typeof confRaw === "object" && !Array.isArray(confRaw) ? (confRaw as Record<string, unknown>) : {};
    const baseUrl =
      typeof conf.baseUrl === "string" && z.string().url().max(2000).safeParse(conf.baseUrl).success ? conf.baseUrl : null;
    const apiKind =
      typeof conf.apiKind === "string" && llmApiKindValues.includes(conf.apiKind as (typeof llmApiKindValues)[number])
        ? (conf.apiKind as LlmProviderApiKind)
        : null;
    llmProviders[providerId] = { baseUrl, apiKind };
  }

  const defaultsRaw = llmObj["defaults"];
  const defaultsObj =
    defaultsRaw && typeof defaultsRaw === "object" && !Array.isArray(defaultsRaw) ? (defaultsRaw as Record<string, unknown>) : {};
  const primaryParsed = llmDefaultPrimarySchema.safeParse(defaultsObj["primary"] ?? {});
  const primaryDefaults = normalizeProviderDefault({
    provider: primaryParsed.success ? (primaryParsed.data.provider ?? null) : null,
    model: primaryParsed.success ? (primaryParsed.data.model ?? null) : null,
    secretId: primaryParsed.success ? (primaryParsed.data.secretId ?? null) : null,
    context: "session",
  });

  const shellRunEnabled = typeof toolsObj.shellRunEnabled === "boolean" ? toolsObj.shellRunEnabled : false;
  const defaultToolsetId =
    typeof toolsetsObj.defaultToolsetId === "string" && z.string().uuid().safeParse(toolsetsObj.defaultToolsetId).success
      ? toolsetsObj.defaultToolsetId
      : null;

  return {
    tools: { shellRunEnabled },
    toolsets: { defaultToolsetId },
    llm: {
      defaults: {
        primary: primaryDefaults,
      },
      providers: llmProviders,
    },
    agents: {
      engineAuthDefaults: normalizeAgentEngineAuthDefaults(agentsObj.engineAuthDefaults),
      engineRuntimeDefaults: normalizeAgentEngineRuntimeDefaults(agentsObj.engineRuntimeDefaults),
    },
  };
}

const agentPairSchema = z.object({
  pairingToken: z.string().min(1),
  name: z.string().min(1).max(120),
  agentVersion: z.string().min(1).max(60),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

const mcpNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/);
const toolsetVisibilitySchema = z.enum(["private", "org"]);
const toolsetPublicSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/);

const mcpServerSchema = z
  .object({
    name: mcpNameSchema,
    transport: z.enum(["stdio", "http"]),
    command: z.string().min(1).max(200).optional(),
    args: z.array(z.string().min(1).max(200)).max(50).optional(),
    env: z.record(z.string().min(1).max(200), z.string().min(1).max(400)).optional(),
    url: z.string().url().max(2000).optional(),
    headers: z.record(z.string().min(1).max(120), z.string().min(1).max(400)).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.transport === "stdio" && (!value.command || value.command.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "command is required for stdio transport", path: ["command"] });
    }
    if (value.transport === "http" && (!value.url || value.url.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "url is required for http transport", path: ["url"] });
    }
  });

const agentSkillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/);
const agentSkillFileSchema = z.object({
  path: z.string().min(1).max(200),
  content: z.string().min(1).max(2_000_000),
  encoding: z.enum(["utf8", "base64"]).optional(),
});
const agentSkillBundleSchema = z.object({
  format: z.literal("agentskills-v1"),
  id: agentSkillIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  entry: z.literal("SKILL.md"),
  files: z.array(agentSkillFileSchema).min(1).max(200),
  enabled: z.boolean().optional(),
  optionalDirs: z
    .object({
      scripts: z.boolean().optional(),
      references: z.boolean().optional(),
      assets: z.boolean().optional(),
    })
    .optional(),
});

const toolsetUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  visibility: toolsetVisibilitySchema.default("private"),
  mcpServers: z.array(mcpServerSchema).default([]),
  agentSkills: z.array(agentSkillBundleSchema).default([]),
});

const toolsetPublishSchema = z.object({
  publicSlug: toolsetPublicSlugSchema,
});

const toolsetUnpublishSchema = z.object({
  visibility: toolsetVisibilitySchema.optional(),
});

const toolsetAdoptSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const toolsetBuilderLlmSchema = z
  .object({
    provider: llmProviderInputSchema.superRefine((provider, ctx) => {
      if (!providerSupportsContext(provider, "toolsetBuilder")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${provider} cannot be used in toolsetBuilder context`,
        });
      }
    }),
    model: z.string().min(1).max(200),
    auth: z
      .object({
        secretId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const toolsetBuilderCreateSessionSchema = z
  .object({
    intent: z.string().max(20_000).optional(),
    llm: toolsetBuilderLlmSchema,
  })
  .strict();

const toolsetBuilderChatSchema = z
  .object({
    message: z.string().min(1).max(20_000),
    selectedComponentKeys: z.array(z.string().min(1).max(80)).max(50).default([]),
  })
  .strict();

const toolsetBuilderFinalizeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    visibility: toolsetVisibilitySchema.optional(),
    selectedComponentKeys: z.array(z.string().min(1).max(80)).max(50).default([]),
  })
  .strict();

const listWorkflowRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

const listWorkflowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

const listWorkflowRunEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).optional(),
});

const listCreditLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

const oauthQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  mode: z.enum(["json"]).optional(),
});

const llmProvidersQuerySchema = z.object({
  context: z.enum(["session", "workflowAgentRun", "toolsetBuilder"]).optional(),
});

const vertexStartQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  location: z.string().min(1).max(64),
});

const llmOAuthStartSchema = z
  .object({
    projectId: z.string().min(1).max(120).optional(),
    location: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(80).optional(),
    mode: z.enum(["json"]).optional(),
  })
  .strict();

const llmOAuthDeviceStartSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
  })
  .strict();

const llmOAuthDevicePollSchema = z
  .object({
    deviceCode: z.string().min(1).max(200),
    token: z.string().min(1).max(20_000).optional(),
    name: z.string().min(1).max(80).optional(),
  })
  .strict();

function toPublicUser(input: { id: string; email: string; displayName: string | null; createdAt: string }) {
  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    createdAt: input.createdAt,
  };
}

function parseAuthHeader(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function localeFromAcceptLanguage(value: string | undefined): "en" | "zh-CN" {
  const raw = (value ?? "").toLowerCase();
  if (raw.includes("zh")) {
    return "zh-CN";
  }
  return "en";
}

function orgContextRequired(message = "X-Org-Id header is required"): AppError {
  return new AppError(400, { code: "ORG_CONTEXT_REQUIRED", message });
}

function orgContextInvalid(message = "Invalid organization context"): AppError {
  return new AppError(400, { code: "INVALID_ORG_CONTEXT", message });
}

function orgAccessDenied(message = "You are not a member of this organization"): AppError {
  return new AppError(403, { code: "ORG_ACCESS_DENIED", message });
}

function orgPlanUpgradeRequired(message = "Your current plan does not allow this organization action"): AppError {
  return new AppError(403, { code: "ORG_PLAN_UPGRADE_REQUIRED", message });
}

function orgLimitReached(message = "You have reached your organization limit"): AppError {
  return new AppError(409, { code: "ORG_LIMIT_REACHED", message });
}

function orgSlugConflict(message = "Organization slug already exists"): AppError {
  return new AppError(409, { code: "ORG_SLUG_CONFLICT", message });
}

function queueUnavailable(message = "Workflow queue is unavailable"): AppError {
  return new AppError(503, { code: "QUEUE_UNAVAILABLE", message });
}

function channelDeliveryUnavailable(message = "Channel delivery gateway is unavailable"): AppError {
  return new AppError(503, { code: "CHANNEL_DELIVERY_UNAVAILABLE", message });
}

function channelDeliveryFailed(message = "Channel delivery request failed", details?: unknown): AppError {
  return new AppError(502, { code: "CHANNEL_DELIVERY_FAILED", message, details });
}

function secretsNotConfigured(): AppError {
  return new AppError(503, { code: "SECRETS_NOT_CONFIGURED", message: "Secrets KEK is not configured" });
}

function secretNotFound(): AppError {
  return new AppError(404, { code: "SECRET_NOT_FOUND", message: "Secret not found" });
}

function secretAlreadyExists(): AppError {
  return new AppError(409, { code: "SECRET_ALREADY_EXISTS", message: "Secret already exists" });
}

function secretValueRequired(): AppError {
  return new AppError(400, { code: "SECRET_VALUE_REQUIRED", message: "Secret value is required" });
}

function pairingTokenInvalid(message = "Pairing token is invalid"): AppError {
  return new AppError(401, { code: "PAIRING_TOKEN_INVALID", message });
}

function pairingTokenExpired(message = "Pairing token is expired"): AppError {
  return new AppError(400, { code: "PAIRING_TOKEN_EXPIRED", message });
}

function agentNotFound(message = "Agent not found"): AppError {
  return new AppError(404, { code: "AGENT_NOT_FOUND", message });
}

function toolsetNotFound(message = "Toolset not found"): AppError {
  return new AppError(404, { code: "TOOLSET_NOT_FOUND", message });
}

function toolsetBuilderSessionNotFound(message = "Toolset builder session not found"): AppError {
  return new AppError(404, { code: "TOOLSET_BUILDER_SESSION_NOT_FOUND", message });
}

function toolsetBuilderSessionFinalized(message = "Toolset builder session is finalized"): AppError {
  return new AppError(409, { code: "TOOLSET_BUILDER_SESSION_FINALIZED", message });
}

function llmSecretRequired(message = "LLM secret is required for this provider"): AppError {
  return new AppError(422, { code: "LLM_SECRET_REQUIRED", message });
}

function toolsetBuilderInvalidModelOutput(details?: unknown): AppError {
  return new AppError(400, { code: "TOOLSET_BUILDER_INVALID_MODEL_OUTPUT", message: "Invalid toolset builder model output", details });
}

function publicSlugConflict(message = "Public slug already exists"): AppError {
  return new AppError(409, { code: "PUBLIC_SLUG_CONFLICT", message });
}

function invalidMcpPlaceholder(details?: unknown): AppError {
  return new AppError(400, { code: "INVALID_MCP_PLACEHOLDER", message: "Invalid MCP placeholder policy", details });
}

function invalidSkillBundle(details?: unknown): AppError {
  return new AppError(400, { code: "INVALID_SKILL_BUNDLE", message: "Invalid skill bundle", details });
}

function llmOauthVerifyUrlNotConfigured(provider: LlmProviderId, envVarName: string): AppError {
  return new AppError(503, {
    code: "LLM_OAUTH_VERIFY_URL_NOT_CONFIGURED",
    message: `OAuth verification URL for ${provider} is not configured. Set ${envVarName}.`,
  });
}

function llmKeyInvalid(message = "Provider rejected the API key"): AppError {
  return new AppError(400, { code: "LLM_KEY_INVALID", message });
}

function llmKeyTestUnavailable(message = "Provider key validation is currently unavailable"): AppError {
  return new AppError(503, { code: "LLM_KEY_TEST_UNAVAILABLE", message });
}

function readPgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") {
      return value;
    }
  }
  return String(error);
}

function isPgUndefinedTableError(error: unknown, relation: string): boolean {
  if (readPgErrorCode(error) !== "42P01") {
    return false;
  }
  return readErrorMessage(error).toLowerCase().includes(relation.toLowerCase());
}

function isPgUniqueViolation(error: unknown): boolean {
  return readPgErrorCode(error) === "23505";
}

function isOrgSlugConflictError(error: unknown): boolean {
  if (error instanceof Error && error.message === "ORG_SLUG_EXISTS") {
    return true;
  }
  if (!isPgUniqueViolation(error)) {
    return false;
  }
  const message = readErrorMessage(error).toLowerCase();
  const constraint =
    typeof error === "object" && error !== null && "constraint" in error
      ? String((error as { constraint?: unknown }).constraint ?? "").toLowerCase()
      : "";
  return (
    constraint.includes("organizations_slug") ||
    message.includes("organizations_slug") ||
    message.includes("organizations.slug") ||
    message.includes("slug")
  );
}

function normalizeAgentInstallerNpmPackage(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_AGENT_INSTALLER_NPM_PACKAGE;
}

function normalizeAgentInstallerNpmDistTag(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_AGENT_INSTALLER_NPM_DIST_TAG;
}

function normalizeAgentInstallerNpmRegistryUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) {
    return DEFAULT_AGENT_INSTALLER_NPM_REGISTRY_URL;
  }
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_AGENT_INSTALLER_NPM_REGISTRY_URL;
  }
}

function normalizeAgentInstallerDocsUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw.length === 0) {
    return null;
  }
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function parseAgentInstallerEnabled(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "off", "no"].includes(raw);
}

function normalizeAgentInstallerCommandMode(value: string | null | undefined): "auto" | "npm" | "local-dev" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "npm" || raw === "local-dev" || raw === "auto") {
    return raw;
  }
  return DEFAULT_AGENT_INSTALLER_COMMAND_MODE;
}

function buildNodeAgentConnectCommand(input: { npmPackage: string; npmDistTag: string; apiBase: string }): string {
  const packageRef = `${input.npmPackage}@${input.npmDistTag}`;
  return `npx -y ${packageRef} connect --pairing-token "<pairing-token>" --api-base "${input.apiBase}"`;
}

function buildNodeAgentStartCommand(input: { npmPackage: string; npmDistTag: string }): string {
  const packageRef = `${input.npmPackage}@${input.npmDistTag}`;
  return `npx -y ${packageRef} start`;
}

function buildLocalNodeAgentConnectCommand(input: { apiBase: string }): string {
  return `pnpm --filter @vespid/node-agent dev -- connect --pairing-token "<pairing-token>" --api-base "${input.apiBase}"`;
}

function buildLocalNodeAgentStartCommand(): string {
  return "pnpm --filter @vespid/node-agent dev -- start";
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function encodeCursor(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

function decodeCursor<T>(value: string): T | null {
  try {
    return JSON.parse(base64UrlDecode(value)) as T;
  } catch {
    return null;
  }
}

function extractJsonObjectCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence && typeof fence[1] === "string") {
    return fence[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return null;
}

function parseJsonObject(raw: string): unknown | null {
  const direct = raw.trim();
  const candidates = [direct, extractJsonObjectCandidate(direct)].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function redactLikelySecrets(text: string): string {
  // Best-effort only; do not assume perfect redaction.
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/g, "Bearer [REDACTED]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "sk-ant-[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9]{10,}\b/g, "sk-[REDACTED]")
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_[REDACTED]")
    .replace(/\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{10,}\b/g, "xox?- [REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]");
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 20);
}

function scoreText(queryTokens: string[], target: string): number {
  if (queryTokens.length === 0) return 0;
  const hay = target.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function rankCatalogItems(input: { query: string; items: ToolsetCatalogItem[]; limit: number }): ToolsetCatalogItem[] {
  const tokens = tokenizeQuery(input.query);
  if (tokens.length === 0) {
    return input.items.slice(0, input.limit);
  }
  return [...input.items]
    .map((item) => ({
      item,
      score: scoreText(tokens, `${item.name} ${item.description ?? ""}`),
    }))
    .sort((a, b) => b.score - a.score || a.item.key.localeCompare(b.item.key))
    .slice(0, input.limit)
    .map((x) => x.item);
}

function hmac(content: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(content).digest("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function signRefreshToken(payload: RefreshTokenPayload, secret: string): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifyRefreshToken(token: string, secret: string): RefreshTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = hmac(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<RefreshTokenPayload>;
    if (!payload.sessionId || !payload.userId || !payload.tokenNonce || typeof payload.expiresAt !== "number") {
      return null;
    }
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      tokenNonce: payload.tokenNonce,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

function isSessionActive(session: SessionRecord): boolean {
  if (session.revokedAt) {
    return false;
  }
  return new Date(session.expiresAt).getTime() > Date.now();
}

function extractProvider(value: unknown): OAuthProvider {
  const parsed = z.enum(["google", "github"]).safeParse(value);
  if (!parsed.success) {
    throw badRequest("Unsupported OAuth provider");
  }
  return parsed.data;
}

function parseInvitationTokenOrganizationId(token: string): string | null {
  const [organizationId] = token.split(".");
  const parsed = z.string().uuid().safeParse(organizationId);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parsePairingTokenOrganizationId(token: string): string | null {
  const [organizationId] = token.split(".");
  const parsed = z.string().uuid().safeParse(organizationId);
  return parsed.success ? parsed.data : null;
}

function parseOrgHeaderValue(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0) {
    throw orgContextRequired();
  }
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    throw orgContextInvalid("Organization context is invalid");
  }
  return parsed.data;
}

function parseUserAgent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function toOAuthAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "OAUTH_EXCHANGE_FAILED";

  if (message.startsWith("OAUTH_PROVIDER_NOT_CONFIGURED:")) {
    const provider = message.split(":")[1] ?? "provider";
    return new AppError(503, {
      code: "OAUTH_PROVIDER_NOT_CONFIGURED",
      message: `OAuth provider is not configured: ${provider}`,
    });
  }

  if (message === "OAUTH_INVALID_NONCE") {
    return new AppError(401, {
      code: "OAUTH_INVALID_NONCE",
      message: "Invalid OAuth nonce",
    });
  }

  if (message === "OAUTH_EMAIL_REQUIRED") {
    return new AppError(400, {
      code: "OAUTH_EMAIL_REQUIRED",
      message: "OAuth provider did not return an email address",
    });
  }

  return new AppError(401, {
    code: message.startsWith("OAUTH_") ? message : "OAUTH_EXCHANGE_FAILED",
    message: "OAuth exchange failed",
  });
}

function invitationErrorToAppError(error: Error): AppError {
  if (error.message === "INVITATION_NOT_FOUND") {
    return notFound("Invitation not found");
  }
  if (error.message === "INVITATION_EXPIRED") {
    return badRequest("Invitation has expired");
  }
  if (error.message === "INVITATION_EMAIL_MISMATCH") {
    return forbidden("Invitation email does not match authenticated user");
  }
  if (error.message === "INVITATION_NOT_PENDING") {
    return badRequest("Invitation is not pending");
  }
  return new AppError(500, {
    code: "INVITATION_ACCEPT_FAILED",
    message: "Invitation accept failed",
  });
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return null;
  }
  return normalized;
}

function parseTierOrgPolicy(value: unknown, fallback: TierOrgPolicy): TierOrgPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const obj = value as Record<string, unknown>;
  const canManageRaw = obj.canManageOrg;
  const maxOrgsRaw = obj.maxOrgs;
  const canManageOrg = typeof canManageRaw === "boolean" ? canManageRaw : fallback.canManageOrg;
  const maxOrgs =
    maxOrgsRaw === null
      ? null
      : parsePositiveInt(maxOrgsRaw) ??
        (fallback.maxOrgs === null ? null : Math.max(1, Math.floor(fallback.maxOrgs)));
  return { canManageOrg, maxOrgs };
}

function normalizeOrgPolicy(value: unknown): OrgPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_ORG_POLICY;
  }
  const obj = value as Record<string, unknown>;
  return {
    free: parseTierOrgPolicy(obj.free, DEFAULT_ORG_POLICY.free),
    paid: parseTierOrgPolicy(obj.paid, DEFAULT_ORG_POLICY.paid),
    enterprise: parseTierOrgPolicy(obj.enterprise, DEFAULT_ORG_POLICY.enterprise),
  };
}

export async function buildServer(input?: {
  store?: AppStore;
  oauthService?: OAuthService;
  vertexOAuthService?: VertexOAuthService | null;
  orgContextEnforcement?: OrgContextEnforcement;
  queueProducer?: WorkflowRunQueueProducer;
  agentInstaller?: Partial<AgentInstallerConfig>;
}) {
  const server = Fastify({
    logger: {
      level: API_LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[REDACTED]",
      },
    },
  });

  await server.register(cookie);
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === WEB_BASE_URL) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });
  const store = input?.store ?? createStore();
  const oauthService = input?.oauthService ?? createOAuthServiceFromEnv();
  const vertexOAuthService = input?.vertexOAuthService ?? createVertexOAuthServiceFromEnv();
  const orgContextEnforcement: OrgContextEnforcement = input?.orgContextEnforcement ?? ORG_CONTEXT_ENFORCEMENT;
  const queueProducer =
    input?.queueProducer ??
    (process.env.NODE_ENV === "test" && !process.env.REDIS_URL
      ? createInMemoryWorkflowRunQueueProducer()
      : createBullMqWorkflowRunQueueProducer());
  const agentInstallerEnabled = input?.agentInstaller?.enabled ?? parseAgentInstallerEnabled(process.env.AGENT_INSTALLER_ENABLED);
  const agentInstallerConfig: AgentInstallerConfig = {
    enabled: agentInstallerEnabled,
    commandMode: normalizeAgentInstallerCommandMode(
      input?.agentInstaller?.commandMode ?? process.env.AGENT_INSTALLER_COMMAND_MODE
    ),
    npmPackage: normalizeAgentInstallerNpmPackage(input?.agentInstaller?.npmPackage ?? process.env.AGENT_INSTALLER_NPM_PACKAGE),
    npmDistTag: normalizeAgentInstallerNpmDistTag(input?.agentInstaller?.npmDistTag ?? process.env.AGENT_INSTALLER_NPM_DIST_TAG),
    npmRegistryUrl: normalizeAgentInstallerNpmRegistryUrl(
      input?.agentInstaller?.npmRegistryUrl ?? process.env.AGENT_INSTALLER_NPM_REGISTRY_URL
    ),
    docsUrl: normalizeAgentInstallerDocsUrl(input?.agentInstaller?.docsUrl ?? process.env.AGENT_INSTALLER_DOCS_URL),
  };
  const capabilitiesCatalog = listPlatformCapabilities();
  const connectorCatalog = createConnectorCatalog();
  const channelCatalog = listChannelDefinitions();
  const allowedSecretConnectorIds = new Set<string>([
    ...connectorCatalog.map((connector) => connector.id),
    ...getAllLlmConnectorIds(),
    ...getAllAgentSecretConnectorIds(),
  ]);
  await store.ensureDefaultRoles();

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? "dev-auth-secret";
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? authSecret;
  const oauthStateSecret = process.env.OAUTH_STATE_SECRET ?? "dev-oauth-state-secret";
  const secureCookies = process.env.NODE_ENV === "production";
  const oauthStates = new Map<string, OAuthStateRecord>();
  const vertexOAuthStates = new Map<string, VertexOAuthStateRecord>();
  const llmOAuthDeviceStates = new Map<string, LlmOAuthDeviceStateRecord>();
  let cachedInstallerNpmAvailability: { available: boolean; checkedAtMs: number } | null = null;

  async function checkInstallerNpmAvailability(input: { npmPackage: string; npmRegistryUrl: string }): Promise<boolean> {
    if (process.env.NODE_ENV === "test") {
      return true;
    }
    const now = Date.now();
    if (cachedInstallerNpmAvailability && now - cachedInstallerNpmAvailability.checkedAtMs < 30_000) {
      return cachedInstallerNpmAvailability.available;
    }
    try {
      const encodedPackage = encodeURIComponent(input.npmPackage);
      const url = `${input.npmRegistryUrl.replace(/\/+$/, "")}/${encodedPackage}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_500);
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      clearTimeout(timer);
      const available = response.ok;
      cachedInstallerNpmAvailability = { available, checkedAtMs: now };
      return available;
    } catch {
      cachedInstallerNpmAvailability = { available: false, checkedAtMs: now };
      return false;
    }
  }

  function setSessionCookie(reply: { setCookie: Function }, refreshToken: string): void {
    reply.setCookie(SESSION_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      path: "/",
      maxAge: SESSION_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function clearSessionCookie(reply: { clearCookie: Function }): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function setOAuthCookies(reply: { setCookie: Function }, input: { state: string; nonce: string }): void {
    reply.setCookie(OAUTH_STATE_COOKIE_NAME, signRefreshToken(
      {
        sessionId: input.state,
        userId: "oauth",
        tokenNonce: "state",
        expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
      },
      oauthStateSecret
    ), {
      httpOnly: true,
      path: "/",
      maxAge: OAUTH_CONTEXT_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });

    reply.setCookie(OAUTH_NONCE_COOKIE_NAME, signRefreshToken(
      {
        sessionId: input.nonce,
        userId: "oauth",
        tokenNonce: "nonce",
        expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
      },
      oauthStateSecret
    ), {
      httpOnly: true,
      path: "/",
      maxAge: OAUTH_CONTEXT_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function clearOAuthCookies(reply: { clearCookie: Function }): void {
    reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
    reply.clearCookie(OAUTH_NONCE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
  }

  function setVertexOAuthCookies(reply: { setCookie: Function }, input: { state: string; nonce: string }): void {
    reply.setCookie(
      VERTEX_OAUTH_STATE_COOKIE_NAME,
      signRefreshToken(
        {
          sessionId: input.state,
          userId: "vertex",
          tokenNonce: "state",
          expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
        },
        oauthStateSecret
      ),
      {
        httpOnly: true,
        path: "/",
        maxAge: OAUTH_CONTEXT_TTL_SEC,
        sameSite: "lax",
        secure: secureCookies,
      }
    );

    reply.setCookie(
      VERTEX_OAUTH_NONCE_COOKIE_NAME,
      signRefreshToken(
        {
          sessionId: input.nonce,
          userId: "vertex",
          tokenNonce: "nonce",
          expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
        },
        oauthStateSecret
      ),
      {
        httpOnly: true,
        path: "/",
        maxAge: OAUTH_CONTEXT_TTL_SEC,
        sameSite: "lax",
        secure: secureCookies,
      }
    );
  }

  function clearVertexOAuthCookies(reply: { clearCookie: Function }): void {
    reply.clearCookie(VERTEX_OAUTH_STATE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
    reply.clearCookie(VERTEX_OAUTH_NONCE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
  }

  async function createSessionForUser(input: {
    user: UserRecord;
    userAgent: string | undefined;
    ip: string | undefined;
    reply: { setCookie: Function };
  }) {
    const sessionId = crypto.randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sessionId,
      userId: input.user.id,
      tokenNonce: crypto.randomBytes(24).toString("base64url"),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
    };
    const refreshToken = signRefreshToken(refreshPayload, refreshSecret);

    await store.createSession({
      id: sessionId,
      userId: input.user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(refreshPayload.expiresAt * 1000),
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    });

    const session = signAuthToken({
      userId: input.user.id,
      email: input.user.email,
      sessionId,
      ttlSec: ACCESS_TOKEN_TTL_SEC,
      secret: authSecret,
    });

    setSessionCookie(input.reply, refreshToken);
    return session;
  }

  async function ensurePersonalWorkspace(user: UserRecord): Promise<void> {
    await store.ensurePersonalOrganizationForUser({ actorUserId: user.id });
  }

  function isBootstrapSystemAdminEmail(email: string | null | undefined): boolean {
    if (!email) {
      return false;
    }
    return readSystemAdminEmailAllowlist().has(email.trim().toLowerCase());
  }

  async function ensureSystemAdminBootstrap(input: { userId: string; email?: string | null }): Promise<void> {
    if (!isBootstrapSystemAdminEmail(input.email ?? null)) {
      return;
    }
    await store.createPlatformUserRole({
      userId: input.userId,
      roleKey: "system_admin",
      grantedByUserId: null,
    });
  }

  async function getOrgPolicy(): Promise<OrgPolicy> {
    const setting = await store.getPlatformSetting({ key: "org_policy" });
    return normalizeOrgPolicy(setting?.value);
  }

  async function resolveUserCapabilities(input: { userId: string; email?: string | null }): Promise<{
    isSystemAdmin: boolean;
    orgPolicy: MeOrgPolicy;
  }> {
    await ensureSystemAdminBootstrap({ userId: input.userId, email: input.email ?? null });
    const roleRowsPromise = store.listPlatformUserRoles({ userId: input.userId, roleKey: "system_admin" }).catch((error) => {
      if (isPgUndefinedTableError(error, "platform_user_roles")) {
        server.log.warn(
          {
            event: "platform_user_roles_missing",
            userId: input.userId,
          },
          "platform_user_roles table is missing; continuing without system-admin role lookup"
        );
        return [];
      }
      throw error;
    });
    const [roleRows, orgs] = await Promise.all([roleRowsPromise, store.listOrganizationsForUser({ actorUserId: input.userId })]);
    return {
      isSystemAdmin: roleRows.length > 0,
      orgPolicy: {
        canManageOrganizations: true,
        maxOrganizations: null,
        currentOrganizations: orgs.length,
      },
    };
  }

  async function requireSystemAdmin(request: { auth?: AuthContext }): Promise<AuthContext> {
    const auth = requireAuth(request);
    await ensureSystemAdminBootstrap({ userId: auth.userId, email: auth.email });
    const roles = await store.listPlatformUserRoles({ userId: auth.userId, roleKey: "system_admin" });
    if (roles.length === 0) {
      throw forbidden("System administrator role is required");
    }
    return auth;
  }

  async function authenticateFromBearerToken(token: string): Promise<AuthContext | null> {
    const payload = verifyAuthToken(token, authSecret);
    if (!payload) {
      return null;
    }

    const [session, user] = await Promise.all([
      store.getSessionById({ userId: payload.userId, sessionId: payload.sessionId }),
      store.getUserById(payload.userId),
    ]);

    if (!session || !user || !isSessionActive(session)) {
      return null;
    }

    await store.touchSession({ userId: payload.userId, sessionId: payload.sessionId });

    return {
      userId: payload.userId,
      email: payload.email,
      sessionId: payload.sessionId,
    };
  }

  async function authenticateFromRefreshCookie(input: {
    token: string;
    rotateRefreshToken: boolean;
    reply: { setCookie: Function };
  }): Promise<{ auth: AuthContext; session: ReturnType<typeof signAuthToken>; user: UserRecord } | null> {
    const payload = verifyRefreshToken(input.token, refreshSecret);
    if (!payload) {
      return null;
    }

    const [session, user] = await Promise.all([
      store.getSessionById({ userId: payload.userId, sessionId: payload.sessionId }),
      store.getUserById(payload.userId),
    ]);

    if (!session || !user || !isSessionActive(session)) {
      return null;
    }

    if (!timingSafeEqual(session.refreshTokenHash, hashRefreshToken(input.token))) {
      return null;
    }

    if (input.rotateRefreshToken) {
      const rotatedPayload: RefreshTokenPayload = {
        sessionId: payload.sessionId,
        userId: payload.userId,
        tokenNonce: crypto.randomBytes(24).toString("base64url"),
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
      };
      const rotatedToken = signRefreshToken(rotatedPayload, refreshSecret);
      await store.rotateSessionRefreshToken({
        userId: payload.userId,
        sessionId: payload.sessionId,
        refreshTokenHash: hashRefreshToken(rotatedToken),
        expiresAt: new Date(rotatedPayload.expiresAt * 1000),
      });
      setSessionCookie(input.reply, rotatedToken);
    } else {
      await store.touchSession({ userId: payload.userId, sessionId: payload.sessionId });
    }

    const accessSession = signAuthToken({
      userId: user.id,
      email: user.email,
      sessionId: payload.sessionId,
      ttlSec: ACCESS_TOKEN_TTL_SEC,
      secret: authSecret,
    });

    return {
      auth: {
        userId: user.id,
        email: user.email,
        sessionId: payload.sessionId,
      },
      session: accessSession,
      user,
    };
  }

  async function requireOrgContext(request: {
    headers: Record<string, unknown>;
    id: string;
    method: string;
    url: string;
    auth?: AuthContext;
    orgContext?: OrgContext;
    orgContextWarnings?: string[];
  }, input?: { expectedOrgId?: string }): Promise<OrgContext> {
    if (request.orgContext) {
      return request.orgContext;
    }

    const auth = request.auth;
    if (!auth) {
      throw unauthorized();
    }
    const authContext = auth;

    function warnOrgContext(code: "ORG_CONTEXT_REQUIRED" | "INVALID_ORG_CONTEXT", message: string) {
      request.orgContextWarnings ??= [];
      request.orgContextWarnings.push(code);
      server.log.warn(
        {
          event: "org_context_header_fallback",
          reason: code,
          userId: authContext.userId,
          routeOrgId: input?.expectedOrgId ?? null,
          headerOrgId: request.headers["x-org-id"],
          requestId: request.id,
          path: request.url,
          method: request.method,
          message,
        },
        "org context header fallback"
      );
    }

    let orgId: string;
    try {
      orgId = parseOrgHeaderValue(request.headers["x-org-id"]);
    } catch (error) {
      if (orgContextEnforcement === "strict") {
        throw error;
      }
      if (!input?.expectedOrgId) {
        throw error;
      }
      orgId = input.expectedOrgId;
      warnOrgContext("ORG_CONTEXT_REQUIRED", "Missing/invalid X-Org-Id header; fell back to route org id");
    }

    if (input?.expectedOrgId && input.expectedOrgId !== orgId) {
      if (orgContextEnforcement === "strict") {
        throw orgContextInvalid("X-Org-Id does not match route organization id");
      }
      warnOrgContext("INVALID_ORG_CONTEXT", "X-Org-Id mismatched route org id; fell back to route org id");
      orgId = input.expectedOrgId;
    }

    const membership = await store.getMembership({
      organizationId: orgId,
      userId: authContext.userId,
      actorUserId: authContext.userId,
    });

    if (!membership) {
      server.log.warn(
        {
          event: "org_context_access_denied",
          userId: authContext.userId,
          orgId,
          requestId: request.id,
          path: request.url,
          method: request.method,
        },
        "org context access denied"
      );
      throw orgAccessDenied();
    }

    const context: OrgContext = { organizationId: orgId, membership };
    request.orgContext = context;
    return context;
  }

  function requireAuth(request: { auth?: AuthContext }): AuthContext {
    if (!request.auth) {
      throw unauthorized();
    }
    return request.auth;
  }

  function requireInternalServiceToken(request: { headers: Record<string, unknown> }): void {
    const headerToken = request.headers["x-service-token"] ?? request.headers["x-gateway-token"];
    const token = typeof headerToken === "string" ? headerToken : null;
    if (!token || token.length === 0 || token !== INTERNAL_API_SERVICE_TOKEN) {
      throw unauthorized("Invalid internal service token");
    }
  }

  server.setErrorHandler((error, _request, reply) => {
    const appError = error as Partial<AppErrorType> & { payload?: unknown };
    const errorCode = (error as { code?: unknown }).code;
    if (typeof appError.statusCode === "number" && appError.payload) {
      return reply.status(appError.statusCode).send(appError.payload);
    }
    if (typeof appError.statusCode === "number" && appError.statusCode >= 400 && appError.statusCode < 500) {
      return reply.status(appError.statusCode).send({
        code: typeof errorCode === "string" ? errorCode : "REQUEST_ERROR",
        message: typeof appError.message === "string" ? appError.message : "Request error",
      });
    }
    server.log.error({ err: error }, "unhandled application error");
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });

  server.addHook("preHandler", async (request, reply) => {
    const bearer = parseAuthHeader(request.headers.authorization);
    if (bearer) {
      const auth = await authenticateFromBearerToken(bearer);
      if (auth) {
        request.auth = auth;
        return;
      }
    }

    const refreshCookie = request.cookies[SESSION_COOKIE_NAME];
    if (!refreshCookie) {
      return;
    }

    const authResult = await authenticateFromRefreshCookie({
      token: refreshCookie,
      rotateRefreshToken: false,
      reply,
    });
    if (!authResult) {
      return;
    }

    request.auth = authResult.auth;
    reply.header("x-access-token", authResult.session.token);
  });

  server.addHook("onSend", async (request, reply, payload) => {
    if (request.orgContextWarnings && request.orgContextWarnings.length > 0) {
      const uniqueWarnings = [...new Set(request.orgContextWarnings)];
      reply.header("x-org-context-warning", uniqueWarnings.join(","));
    }
    return payload;
  });

  server.addHook("onClose", async () => {
    await queueProducer.close();
  });

  server.post("/v1/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid signup payload", parsed.error.flatten());
    }

    const existing = await store.getUserByEmail(parsed.data.email);
    if (existing) {
      throw conflict("Email already registered");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await store.createUser({
      email: parsed.data.email,
      passwordHash,
      displayName: parsed.data.displayName ?? null,
    });

    const session = await createSessionForUser({
      user,
      userAgent: parseUserAgent(request.headers["user-agent"]),
      ip: request.ip,
      reply,
    });

    await ensurePersonalWorkspace(user);

    return reply.status(201).send({ session, user: toPublicUser(user) });
  });

  server.post("/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid login payload", parsed.error.flatten());
    }

    const user = await store.getUserByEmail(parsed.data.email);
    if (!user) {
      throw unauthorized("Invalid credentials");
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      throw unauthorized("Invalid credentials");
    }

    const session = await createSessionForUser({
      user,
      userAgent: parseUserAgent(request.headers["user-agent"]),
      ip: request.ip,
      reply,
    });

    await ensurePersonalWorkspace(user);

    return { session, user: toPublicUser(user) };
  });

  server.post("/v1/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies[SESSION_COOKIE_NAME];
    if (!refreshToken) {
      throw unauthorized("Session cookie is required");
    }

    const authResult = await authenticateFromRefreshCookie({
      token: refreshToken,
      rotateRefreshToken: true,
      reply,
    });

    if (!authResult) {
      throw unauthorized("Refresh token is invalid or expired");
    }

    return {
      session: authResult.session,
      user: toPublicUser(authResult.user),
    };
  });

  server.post("/v1/auth/logout", async (request, reply) => {
    const auth = requireAuth(request);
    await store.revokeSession({ userId: auth.userId, sessionId: auth.sessionId });
    clearSessionCookie(reply);
    return { ok: true };
  });

  server.post("/v1/auth/logout-all", async (request, reply) => {
    const auth = requireAuth(request);
    const revokedCount = await store.revokeAllSessionsForUser(auth.userId);
    clearSessionCookie(reply);
    return { ok: true, revokedCount };
  });

  server.get("/v1/me", async (request) => {
    const auth = requireAuth(request);
    const user = await store.getUserById(auth.userId);
    if (!user) {
      throw unauthorized("Session is invalid");
    }

    await ensurePersonalWorkspace(user);
    const [orgs, capabilities] = await Promise.all([
      store.listOrganizationsForUser({ actorUserId: auth.userId }),
      resolveUserCapabilities({ userId: auth.userId, email: user.email }),
    ]);
    const defaultOrgId = orgs.length > 0 ? orgs[0]!.organization.id : null;

    return {
      user: toPublicUser(user),
      account: {
        isSystemAdmin: capabilities.isSystemAdmin,
      },
      orgPolicy: capabilities.orgPolicy,
      orgs: orgs.map((row) => ({
        id: row.organization.id,
        slug: row.organization.slug,
        name: row.organization.name,
        roleKey: row.membership.roleKey,
      })),
      defaultOrgId,
    };
  });

  server.get("/v1/auth/oauth/:provider/start", async (request, reply) => {
    const provider = extractProvider((request.params as { provider?: string }).provider);
    const mode = (request.query as { mode?: string }).mode;

    const state = generateState();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const codeVerifier = generateCodeVerifier();

    oauthStates.set(state, {
      provider,
      codeVerifier,
      nonce,
      expiresAtSec: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
    });

    let authorizationUrl: URL;
    try {
      authorizationUrl = oauthService.createAuthorizationUrl(provider, {
        state,
        codeVerifier,
        nonce,
      });
    } catch (error) {
      throw toOAuthAppError(error);
    }

    setOAuthCookies(reply, { state, nonce });

    if (mode === "json") {
      return {
        provider,
        authorizationUrl: authorizationUrl.toString(),
      };
    }

    return reply.redirect(authorizationUrl.toString());
  });

  server.get("/v1/meta/capabilities", async () => {
    return {
      capabilities: capabilitiesCatalog,
    };
  });

  server.get("/v1/meta/connectors", async () => {
    return {
      connectors: connectorCatalog,
    };
  });

  server.get("/v1/agent/engines", async () => {
    return {
      engines: listAgentEngines(),
    };
  });

  server.get("/v1/meta/channels", async () => {
    return {
      channels: channelCatalog,
    };
  });

  server.get("/v1/meta/agent-installer", async () => {
    const npmPackage = agentInstallerEnabled ? agentInstallerConfig.npmPackage : DEFAULT_AGENT_INSTALLER_NPM_PACKAGE;
    const npmDistTag = agentInstallerEnabled ? agentInstallerConfig.npmDistTag : DEFAULT_AGENT_INSTALLER_NPM_DIST_TAG;
    const npmRegistryUrl = agentInstallerEnabled
      ? agentInstallerConfig.npmRegistryUrl
      : DEFAULT_AGENT_INSTALLER_NPM_REGISTRY_URL;
    const docsUrl = agentInstallerEnabled ? agentInstallerConfig.docsUrl : null;
    const commandMode = agentInstallerEnabled ? agentInstallerConfig.commandMode : "npm";
    const isLocalDevContext = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

    let delivery: "npm" | "local-dev" = "npm";
    let fallbackReason: string | null = null;
    if (commandMode === "local-dev") {
      delivery = "local-dev";
      fallbackReason = "forced_local_dev";
    } else if (commandMode === "auto" && isLocalDevContext) {
      const npmAvailable = await checkInstallerNpmAvailability({ npmPackage, npmRegistryUrl });
      if (!npmAvailable) {
        delivery = "local-dev";
        fallbackReason = "npm_package_unavailable";
      }
    }

    return {
      provider: "npm-registry" as const,
      delivery,
      fallbackReason,
      packageName: npmPackage,
      distTag: npmDistTag,
      registryUrl: npmRegistryUrl,
      docsUrl,
      commands: {
        connect:
          delivery === "local-dev"
            ? buildLocalNodeAgentConnectCommand({ apiBase: "http://127.0.0.1:3001" })
            : buildNodeAgentConnectCommand({
                npmPackage,
                npmDistTag,
                apiBase: "http://127.0.0.1:3001",
              }),
        start: delivery === "local-dev" ? buildLocalNodeAgentStartCommand() : buildNodeAgentStartCommand({ npmPackage, npmDistTag }),
      },
    };
  });

  server.post("/internal/v1/managed-executors/issue", async (request, reply) => {
    requireInternalServiceToken(request);

    const parsed = z
      .object({
        name: z.string().min(1).max(120).default("managed-executor"),
        maxInFlight: z.number().int().min(1).max(200).optional(),
        labels: z.array(z.string().min(1).max(64)).max(50).optional(),
        capabilities: z.record(z.string(), z.unknown()).optional(),
        runtimeClass: z.string().min(1).max(64).optional(),
        region: z.string().min(1).max(64).nullable().optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid managed executor issue payload", parsed.error.flatten());
    }

    const executorId = crypto.randomUUID();
    const executorToken = `${executorId}.${crypto.randomBytes(32).toString("base64url")}`;
    const created = await store.createManagedExecutor({
      name: parsed.data.name,
      tokenHash: sha256Hex(executorToken),
      ...(typeof parsed.data.maxInFlight === "number" ? { maxInFlight: parsed.data.maxInFlight } : {}),
      ...(Array.isArray(parsed.data.labels) ? { labels: parsed.data.labels } : {}),
      ...(parsed.data.capabilities ? { capabilities: parsed.data.capabilities } : {}),
      ...(typeof parsed.data.runtimeClass === "string" ? { runtimeClass: parsed.data.runtimeClass } : {}),
      ...(parsed.data.region !== undefined ? { region: parsed.data.region } : {}),
    });

    const gatewayWsUrl = process.env.GATEWAY_WS_URL ?? "ws://localhost:3002/ws/executor";
    return reply.status(201).send({
      executorId: created.id,
      executorToken,
      gatewayWsUrl,
    });
  });

  server.post("/internal/v1/managed-executors/:executorId/revoke", async (request) => {
    requireInternalServiceToken(request);
    const params = z
      .object({
        executorId: z.string().uuid(),
      })
      .safeParse(request.params ?? {});
    if (!params.success) {
      throw badRequest("Invalid managed executor revoke path", params.error.flatten());
    }

    const ok = await store.revokeManagedExecutor({
      executorId: params.data.executorId,
    });
    if (!ok) {
      throw notFound("Managed executor not found");
    }
    return { ok: true };
  });

  server.post("/internal/v1/channels/trigger-run", async (request, reply) => {
    requireInternalServiceToken(request);

    const parsed = internalChannelTriggerRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid channel trigger payload", parsed.error.flatten());
    }

    const workflow = await store.getWorkflowById({
      organizationId: parsed.data.organizationId,
      workflowId: parsed.data.workflowId,
      actorUserId: parsed.data.requestedByUserId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }
    if (workflow.status !== "published") {
      throw conflict("Workflow must be published before runs can be created");
    }

    const run = await store.createWorkflowRun({
      organizationId: parsed.data.organizationId,
      workflowId: parsed.data.workflowId,
      triggerType: "channel",
      requestedByUserId: parsed.data.requestedByUserId,
      input: parsed.data.payload,
    });

    try {
      await queueProducer.enqueueWorkflowRun({
        payload: {
          runId: run.id,
          organizationId: run.organizationId,
          workflowId: run.workflowId,
          requestedByUserId: run.requestedByUserId,
        },
        maxAttempts: run.maxAttempts,
      });
    } catch (error) {
      await store.deleteQueuedWorkflowRun({
        organizationId: parsed.data.organizationId,
        workflowId: parsed.data.workflowId,
        runId: run.id,
        actorUserId: parsed.data.requestedByUserId,
      });
      server.log.error(
        {
          event: "channel_trigger_queue_unavailable",
          orgId: parsed.data.organizationId,
          workflowId: parsed.data.workflowId,
          runId: run.id,
          requestId: request.id,
          path: request.url,
          method: request.method,
          error: error instanceof Error ? error.message : String(error),
        },
        "channel trigger queue unavailable"
      );
      throw queueUnavailable();
    }

    return reply.status(201).send({ run });
  });
  server.get("/v1/auth/oauth/:provider/callback", async (request, reply) => {
    const provider = extractProvider((request.params as { provider?: string }).provider);
    const parsed = oauthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw badRequest("Invalid OAuth callback query", parsed.error.flatten());
    }

    try {
      const signedStateCookie = request.cookies[OAUTH_STATE_COOKIE_NAME];
      const signedNonceCookie = request.cookies[OAUTH_NONCE_COOKIE_NAME];
      if (!signedStateCookie || !signedNonceCookie) {
        throw unauthorized("Missing OAuth state/nonce cookies");
      }

      const stateCookiePayload = verifyRefreshToken(signedStateCookie, oauthStateSecret);
      const nonceCookiePayload = verifyRefreshToken(signedNonceCookie, oauthStateSecret);
      if (!stateCookiePayload || !nonceCookiePayload) {
        throw unauthorized("Invalid OAuth state/nonce cookies");
      }

      if (stateCookiePayload.sessionId !== parsed.data.state) {
        throw unauthorized("Invalid OAuth state");
      }

      const stored = oauthStates.get(parsed.data.state);
      oauthStates.delete(parsed.data.state);
      clearOAuthCookies(reply);

      if (!stored || stored.provider !== provider || stored.expiresAtSec <= Math.floor(Date.now() / 1000)) {
        throw unauthorized("Invalid or expired OAuth state");
      }

      if (nonceCookiePayload.sessionId !== stored.nonce) {
        throw unauthorized("Invalid OAuth nonce");
      }

      const profile = await oauthService.exchangeCodeForProfile(provider, {
        code: parsed.data.code,
        codeVerifier: stored.codeVerifier,
        nonce: stored.nonce,
      });

      const existingUser = await store.getUserByEmail(profile.email);
      const user =
        existingUser ??
        (await store.createUser({
          email: profile.email,
          passwordHash: await hashPassword(`oauth:${provider}:${crypto.randomUUID()}`),
          displayName: profile.displayName,
        }));

      const session = await createSessionForUser({
        user,
        userAgent: parseUserAgent(request.headers["user-agent"]),
        ip: request.ip,
        reply,
      });

      await ensurePersonalWorkspace(user);

      if (parsed.data.mode === "json") {
        return {
          session,
          user: toPublicUser(user),
          provider,
        };
      }

      const redirectUrl = new URL("/auth", WEB_BASE_URL);
      redirectUrl.searchParams.set("oauth", "success");
      redirectUrl.searchParams.set("provider", provider);
      return reply.redirect(redirectUrl.toString());
    } catch (error) {
      const mapped = toOAuthAppError(error);
      server.log.warn(
        {
          event: "oauth_callback_failed",
          provider,
          reasonCode: mapped.payload.code,
          requestId: request.id,
          path: request.url,
        },
        "oauth callback failed"
      );

      if (parsed.data.mode === "json") {
        throw mapped;
      }
      const redirectUrl = new URL("/auth", WEB_BASE_URL);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set("provider", provider);
      redirectUrl.searchParams.set("code", mapped.payload.code);
      return reply.redirect(redirectUrl.toString());
    }
  });

  server.post("/v1/orgs", async (request, reply) => {
    const auth = requireAuth(request);
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid organization payload", parsed.error.flatten());
    }

    const capabilities = await resolveUserCapabilities({ userId: auth.userId, email: auth.email });
    if (!capabilities.orgPolicy.canManageOrganizations) {
      throw orgPlanUpgradeRequired("Upgrade required to create additional organizations.");
    }
    if (
      capabilities.orgPolicy.maxOrganizations !== null &&
      capabilities.orgPolicy.currentOrganizations >= capabilities.orgPolicy.maxOrganizations
    ) {
      throw orgLimitReached("Organization limit reached for your account.");
    }

    let created;
    try {
      created = await store.createOrganizationWithOwner({
        name: parsed.data.name,
        slug: parsed.data.slug,
        ownerUserId: auth.userId,
      });
    } catch (error) {
      if (isOrgSlugConflictError(error)) {
        throw orgSlugConflict();
      }
      throw error;
    }

    return reply.status(201).send(created);
  });

  server.post("/v1/orgs/:orgId/invitations", async (request, reply) => {
    const auth = requireAuth(request);
    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to invite members");
    }

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid invitation payload", parsed.error.flatten());
    }

    const invitation = await store.createInvitation({
      organizationId: orgContext.organizationId,
      email: parsed.data.email,
      roleKey: parsed.data.roleKey,
      invitedByUserId: auth.userId,
    });

    return reply.status(201).send({ invitation });
  });

  server.post("/v1/orgs/:orgId/members/:memberId/role", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; memberId?: string };
    if (!params.orgId || !params.memberId) {
      throw badRequest("Missing orgId or memberId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to change membership roles");
    }

    const parsed = roleMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid role update payload", parsed.error.flatten());
    }

    if (parsed.data.roleKey === "owner" && orgContext.membership.roleKey !== "owner") {
      throw forbidden("Only owner can assign owner role");
    }

    const updated = await store.updateMembershipRole({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      memberUserId: params.memberId,
      roleKey: parsed.data.roleKey,
    });

    if (!updated) {
      throw notFound("Membership not found");
    }

    return { membership: updated };
  });

  server.get("/v1/orgs/:orgId/settings", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });

    const settings = await store.getOrganizationSettings({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });

    return { settings: normalizeOrgSettings(settings) };
  });

  server.put("/v1/orgs/:orgId/settings", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage org settings");
    }

    const parsed = orgSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid org settings payload", parsed.error.flatten());
    }

    const existing = await store.getOrganizationSettings({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });
    const normalizedExisting = normalizeOrgSettings(existing);
    const llmDefaultsPatch = parsed.data.llm?.defaults;
    const llmProvidersPatch = parsed.data.llm?.providers;
    const engineAuthDefaultsPatch = parsed.data.agents?.engineAuthDefaults;
    const engineRuntimeDefaultsPatch = parsed.data.agents?.engineRuntimeDefaults;

    const nextProviderOverrides: Partial<Record<LlmProviderId, { baseUrl: string | null; apiKind: LlmProviderApiKind | null }>> =
      llmProvidersPatch
        ? (() => {
            const out = { ...normalizedExisting.llm.providers };
            for (const [rawProviderId, conf] of Object.entries(llmProvidersPatch)) {
              const providerId = normalizeLlmProviderId(rawProviderId);
              if (!providerId) continue;
              out[providerId] = {
                baseUrl: typeof conf.baseUrl === "string" ? conf.baseUrl : null,
                apiKind: conf.apiKind ?? null,
              };
            }
            return out;
          })()
        : normalizedExisting.llm.providers;

    const next = {
      tools: {
        shellRunEnabled:
          typeof parsed.data.tools?.shellRunEnabled === "boolean"
            ? parsed.data.tools.shellRunEnabled
            : normalizedExisting.tools.shellRunEnabled,
      },
      toolsets: {
        defaultToolsetId:
          parsed.data.toolsets && "defaultToolsetId" in parsed.data.toolsets
            ? (parsed.data.toolsets.defaultToolsetId ?? null)
            : normalizedExisting.toolsets.defaultToolsetId,
      },
      llm: {
        defaults: {
          primary:
            llmDefaultsPatch && "primary" in llmDefaultsPatch
              ? {
                  provider: llmDefaultsPatch.primary?.provider ?? null,
                  model: llmDefaultsPatch.primary?.model ?? null,
                  secretId:
                    llmDefaultsPatch.primary && "secretId" in llmDefaultsPatch.primary
                      ? (llmDefaultsPatch.primary.secretId ?? null)
                      : null,
                }
              : normalizedExisting.llm.defaults.primary,
        },
        providers: nextProviderOverrides,
      },
      agents: {
        engineAuthDefaults: {
          "gateway.codex.v2":
            engineAuthDefaultsPatch && "gateway.codex.v2" in engineAuthDefaultsPatch
              ? normalizeAgentEngineAuthDefault("gateway.codex.v2", engineAuthDefaultsPatch["gateway.codex.v2"])
              : normalizedExisting.agents.engineAuthDefaults["gateway.codex.v2"],
          "gateway.claude.v2":
            engineAuthDefaultsPatch && "gateway.claude.v2" in engineAuthDefaultsPatch
              ? normalizeAgentEngineAuthDefault("gateway.claude.v2", engineAuthDefaultsPatch["gateway.claude.v2"])
              : normalizedExisting.agents.engineAuthDefaults["gateway.claude.v2"],
          "gateway.opencode.v2":
            engineAuthDefaultsPatch && "gateway.opencode.v2" in engineAuthDefaultsPatch
              ? normalizeAgentEngineAuthDefault("gateway.opencode.v2", engineAuthDefaultsPatch["gateway.opencode.v2"])
              : normalizedExisting.agents.engineAuthDefaults["gateway.opencode.v2"],
        },
        engineRuntimeDefaults: {
          "gateway.codex.v2":
            engineRuntimeDefaultsPatch && "gateway.codex.v2" in engineRuntimeDefaultsPatch
              ? normalizeAgentEngineRuntimeDefault(engineRuntimeDefaultsPatch["gateway.codex.v2"])
              : normalizedExisting.agents.engineRuntimeDefaults["gateway.codex.v2"],
          "gateway.claude.v2":
            engineRuntimeDefaultsPatch && "gateway.claude.v2" in engineRuntimeDefaultsPatch
              ? normalizeAgentEngineRuntimeDefault(engineRuntimeDefaultsPatch["gateway.claude.v2"])
              : normalizedExisting.agents.engineRuntimeDefaults["gateway.claude.v2"],
          "gateway.opencode.v2":
            engineRuntimeDefaultsPatch && "gateway.opencode.v2" in engineRuntimeDefaultsPatch
              ? normalizeAgentEngineRuntimeDefault(engineRuntimeDefaultsPatch["gateway.opencode.v2"])
              : normalizedExisting.agents.engineRuntimeDefaults["gateway.opencode.v2"],
        },
      },
    };

    const updated = await store.updateOrganizationSettings({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      settings: next,
    });

    return { settings: normalizeOrgSettings(updated) };
  });

  server.get("/v1/orgs/:orgId/engines/auth-status", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });

    const gatewayRes = await fetch(
      `${GATEWAY_HTTP_URL}/internal/v1/executors/routes?organizationId=${encodeURIComponent(orgContext.organizationId)}`,
      {
        method: "GET",
        headers: {
          "x-gateway-token": GATEWAY_INTERNAL_SERVICE_TOKEN,
        },
      }
    );
    if (!gatewayRes.ok) {
      throw new AppError(503, { code: "GATEWAY_UNAVAILABLE", message: "Failed to load executor auth status" });
    }

    const gatewayPayload = await gatewayRes.json().catch(() => null);
    const parsedRoutes = z
      .object({
        routes: z.array(
          z.object({
            executorId: z.string().uuid(),
            name: z.string().nullable().optional(),
            kinds: z.array(z.enum(["connector.action", "agent.execute", "agent.run"])).optional(),
            lastSeenAtMs: z.number().optional(),
            engineAuth: z
              .object({
                "gateway.codex.v2": z
                  .object({
                    oauthVerified: z.boolean(),
                    checkedAt: z.string().min(1),
                    reason: z.string().min(1),
                  })
                  .optional(),
                "gateway.claude.v2": z
                  .object({
                    oauthVerified: z.boolean(),
                    checkedAt: z.string().min(1),
                    reason: z.string().min(1),
                  })
                  .optional(),
              })
              .optional(),
          })
        ),
      })
      .safeParse(gatewayPayload);
    if (!parsedRoutes.success) {
      throw new AppError(502, { code: "GATEWAY_RESPONSE_INVALID", message: "Invalid executor auth status payload from gateway" });
    }

    const onlineRoutes = parsedRoutes.data.routes.filter((route) => (route.kinds ?? []).includes("agent.run"));
    const engineIds = ["gateway.codex.v2", "gateway.claude.v2", "gateway.opencode.v2"] as const;
    const engines = Object.fromEntries(
      engineIds.map((engineId) => {
        const executorStatuses = onlineRoutes.map((route) => {
          if (engineId === "gateway.codex.v2" || engineId === "gateway.claude.v2") {
            const status = route.engineAuth?.[engineId];
            return {
              executorId: route.executorId,
              name: route.name ?? route.executorId,
              verified: status?.oauthVerified === true,
              checkedAt: status?.checkedAt ?? new Date(route.lastSeenAtMs ?? Date.now()).toISOString(),
              reason: status?.reason ?? "not_reported",
            };
          }
          return {
            executorId: route.executorId,
            name: route.name ?? route.executorId,
            verified: true,
            checkedAt: new Date(route.lastSeenAtMs ?? Date.now()).toISOString(),
            reason: "not_required",
          };
        });
        const verifiedCount = executorStatuses.filter((executor) => executor.verified).length;
        const unverifiedCount = executorStatuses.length - verifiedCount;
        return [
          engineId,
          {
            onlineExecutors: executorStatuses.length,
            verifiedCount,
            unverifiedCount,
            executors: executorStatuses,
          },
        ];
      })
    ) as Record<
      "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2",
      {
        onlineExecutors: number;
        verifiedCount: number;
        unverifiedCount: number;
        executors: Array<{
          executorId: string;
          name: string;
          verified: boolean;
          checkedAt: string;
          reason: string;
        }>;
      }
    >;

    return {
      organizationId: orgContext.organizationId,
      engines,
      requestedByUserId: auth.userId,
    };
  });

  server.get("/v1/orgs/:orgId/secrets", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const parsed = listSecretsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list secrets query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const normalizedConnectorId = parsed.data.connectorId ? normalizeConnectorId(parsed.data.connectorId) : null;
    const rawSecrets = await store.listConnectorSecrets({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      connectorId: null,
    });

    const secrets =
      normalizedConnectorId === null
        ? rawSecrets
        : rawSecrets.filter((secret) => normalizeConnectorId(secret.connectorId) === normalizedConnectorId);

    return { secrets };
  });

  server.post("/v1/orgs/:orgId/secrets", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const parsed = createSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid secret payload", parsed.error.flatten());
    }
    if (parsed.data.value.trim().length === 0) {
      throw secretValueRequired();
    }
    const connectorId = normalizeConnectorId(parsed.data.connectorId);
    if (!allowedSecretConnectorIds.has(connectorId)) {
      throw badRequest("Invalid connectorId for secret", {
        connectorId,
        allowed: [...allowedSecretConnectorIds.values()],
      });
    }

    try {
      const secret = await store.createConnectorSecret({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        connectorId,
        name: parsed.data.name,
        value: parsed.data.value,
      });
      return reply.status(201).send({ secret });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "SECRET_ALREADY_EXISTS") {
          throw secretAlreadyExists();
        }
        if (error.message === "SECRETS_KEK_BASE64_REQUIRED" || error.message === "SECRETS_KEK_BASE64_INVALID") {
          throw secretsNotConfigured();
        }
      }
      throw error;
    }
  });

  server.put("/v1/orgs/:orgId/secrets/:secretId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; secretId?: string };
    if (!params.orgId || !params.secretId) {
      throw badRequest("Missing orgId or secretId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const parsed = rotateSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid secret payload", parsed.error.flatten());
    }
    if (parsed.data.value.trim().length === 0) {
      throw secretValueRequired();
    }

    try {
      const secret = await store.rotateConnectorSecret({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        secretId: params.secretId,
        value: parsed.data.value,
      });
      if (!secret) {
        throw secretNotFound();
      }
      return { secret };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "SECRETS_KEK_BASE64_REQUIRED" || error.message === "SECRETS_KEK_BASE64_INVALID") {
          throw secretsNotConfigured();
        }
      }
      throw error;
    }
  });

  server.delete("/v1/orgs/:orgId/secrets/:secretId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; secretId?: string };
    if (!params.orgId || !params.secretId) {
      throw badRequest("Missing orgId or secretId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const ok = await store.deleteConnectorSecret({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      secretId: params.secretId,
    });

    if (!ok) {
      throw secretNotFound();
    }

    return { ok: true };
  });

  server.post("/v1/orgs/:orgId/llm/providers/:provider/test-key", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; provider?: string };
    if (!params.orgId || !params.provider) {
      throw badRequest("Missing orgId or provider");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const provider = normalizeLlmProviderId(params.provider);
    if (!provider) {
      throw badRequest("Unsupported LLM provider");
    }
    const providerMeta = getLlmProviderMeta(provider);
    if (!providerMeta) {
      throw badRequest("Unsupported LLM provider");
    }
    if (providerMeta.authMode !== "api-key") {
      throw badRequest(`${provider} does not support API key authentication.`);
    }

    const parsed = llmProviderTestKeySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid API key test payload", parsed.error.flatten());
    }

    const value = parsed.data.value.trim();
    if (!value) {
      throw secretValueRequired();
    }
    const model = parsed.data.model?.trim() || providerMeta.defaultModelId;
    if (!model) {
      throw badRequest(`Provider ${provider} does not define a default model for API key testing.`);
    }

    const orgSettings = normalizeOrgSettings(
      await store.getOrganizationSettings({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
      })
    );
    const runtime = resolveLlmProviderRuntime({ provider, orgSettings });
    if (runtime.apiKind === "vertex") {
      throw badRequest("vertex API kind requires OAuth credentials.");
    }

    const messages: OpenAiChatMessage[] = [
      { role: "system", content: "You are running an API key health check. Reply with exactly: ok" },
      { role: "user", content: "ok" },
    ];

    const result = await (async () => {
      if (runtime.apiKind === "anthropic-compatible") {
        return anthropicChatCompletion({
          apiKey: value,
          model,
          messages,
          timeoutMs: 1_000,
          maxTokens: 32,
          ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
        });
      }
      if (runtime.apiKind === "google") {
        return geminiGenerateContent({
          apiKey: value,
          model,
          messages,
          timeoutMs: 1_000,
          maxOutputChars: 128,
          ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
        });
      }
      return openAiChatCompletion({
        apiKey: value,
        model,
        messages,
        timeoutMs: 1_000,
        maxTokens: 32,
        ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
      });
    })();

    if (!result.ok) {
      const statusMatch = /_REQUEST_FAILED:(\d{3})$/.exec(result.error);
      const statusCode = statusMatch ? Number(statusMatch[1]) : null;
      const invalidStatusCodes =
        runtime.apiKind === "google"
          ? new Set<number>([400, 401, 403])
          : new Set<number>([401, 403]);
      if (statusCode !== null && invalidStatusCodes.has(statusCode)) {
        throw llmKeyInvalid();
      }
      throw llmKeyTestUnavailable(`Provider key validation failed: ${result.error}`);
    }

    return {
      valid: true as const,
      provider,
      apiKind: runtime.apiKind,
      checkedAt: new Date().toISOString(),
    };
  });

  function requireOrgAdminMembershipForSecretManagement(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRecord> {
    return (async () => {
      const membership = await store.getMembership({
        organizationId: input.organizationId,
        userId: input.userId,
        actorUserId: input.userId,
      });
      if (!membership) {
        throw forbidden("Organization access denied");
      }
      if (!["owner", "admin"].includes(membership.roleKey)) {
        throw forbidden("Role is not allowed to manage secrets");
      }
      return membership;
    })();
  }

  function resolveOauthProviderOrThrow(rawProvider: string | undefined): LlmProviderId {
    const provider = normalizeLlmProviderId(rawProvider);
    if (!provider) {
      throw badRequest("Unsupported LLM OAuth provider");
    }
    if (!isOAuthRequiredProvider(provider)) {
      throw badRequest(`${provider} does not support OAuth.`);
    }
    return provider;
  }

  server.post("/v1/orgs/:orgId/llm/oauth/:provider/start", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; provider?: string };
    if (!params.orgId || !params.provider) {
      throw badRequest("Missing orgId or provider");
    }
    const provider = resolveOauthProviderOrThrow(params.provider);
    await requireOrgAdminMembershipForSecretManagement({ organizationId: params.orgId, userId: auth.userId });

    const parsed = llmOAuthStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid OAuth start payload", parsed.error.flatten());
    }

    if (provider === "google-vertex") {
      const projectId = parsed.data.projectId?.trim();
      const location = parsed.data.location?.trim() ?? "us-central1";
      if (!projectId) {
        throw badRequest("projectId is required for google-vertex OAuth start");
      }
      if (!vertexOAuthService) {
        throw new AppError(500, { code: "VERTEX_OAUTH_NOT_CONFIGURED", message: "Vertex OAuth is not configured" });
      }
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const nonce = crypto.randomBytes(24).toString("base64url");
      const nowSec = Math.floor(Date.now() / 1000);

      vertexOAuthStates.set(state, {
        organizationId: params.orgId,
        userId: auth.userId,
        projectId,
        location,
        codeVerifier,
        nonce,
        expiresAtSec: nowSec + OAUTH_CONTEXT_TTL_SEC,
      });
      setVertexOAuthCookies(reply, { state, nonce });
      const url = vertexOAuthService.createAuthorizationUrl({ state, codeVerifier, nonce });
      if (parsed.data.mode === "json") {
        return { provider, authorizationUrl: url.toString() };
      }
      return reply.redirect(url.toString());
    }

    throw new AppError(400, {
      code: "LLM_OAUTH_USE_DEVICE_FLOW",
      message: `Provider ${provider} uses device flow. Use /v1/orgs/:orgId/llm/oauth/:provider/device/start.`,
    });
  });

  server.get("/v1/llm/oauth/:provider/callback", async (request, reply) => {
    const params = request.params as { provider?: string };
    const provider = resolveOauthProviderOrThrow(params.provider);
    if (provider !== "google-vertex") {
      throw new AppError(400, {
        code: "LLM_OAUTH_CALLBACK_NOT_SUPPORTED",
        message: `${provider} does not use callback flow in this deployment.`,
      });
    }

    const queryString = (() => {
      const q = request.query as Record<string, string | undefined>;
      const p = new URLSearchParams();
      for (const [key, value] of Object.entries(q ?? {})) {
        if (typeof value === "string" && value.length > 0) p.set(key, value);
      }
      const out = p.toString();
      return out ? `?${out}` : "";
    })();

    return reply.redirect(`/v1/llm/vertex/callback${queryString}`);
  });

  server.post("/v1/orgs/:orgId/llm/oauth/:provider/device/start", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; provider?: string };
    if (!params.orgId || !params.provider) {
      throw badRequest("Missing orgId or provider");
    }
    const provider = resolveOauthProviderOrThrow(params.provider);
    await requireOrgAdminMembershipForSecretManagement({ organizationId: params.orgId, userId: auth.userId });
    if (provider === "google-vertex") {
      throw badRequest("google-vertex uses callback flow. Use /llm/oauth/google-vertex/start.");
    }

    const parsed = llmOAuthDeviceStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid OAuth device start payload", parsed.error.flatten());
    }

    const deviceCode = crypto.randomUUID();
    const userCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    const nowSec = Math.floor(Date.now() / 1000);
    llmOAuthDeviceStates.set(deviceCode, {
      organizationId: params.orgId,
      userId: auth.userId,
      provider,
      name: parsed.data.name?.trim() || "default",
      expiresAtSec: nowSec + OAUTH_CONTEXT_TTL_SEC,
    });

    const verifyUrlEnv = `LLM_OAUTH_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_VERIFY_URL`;
    const verificationUri =
      process.env[verifyUrlEnv]?.trim() || DEFAULT_LLM_OAUTH_VERIFY_URLS[provider] || null;
    if (!verificationUri) {
      throw llmOauthVerifyUrlNotConfigured(provider, verifyUrlEnv);
    }

    return {
      provider,
      deviceCode,
      userCode,
      verificationUri,
      intervalSec: 3,
      expiresInSec: OAUTH_CONTEXT_TTL_SEC,
    };
  });

  server.post("/v1/orgs/:orgId/llm/oauth/:provider/device/poll", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; provider?: string };
    if (!params.orgId || !params.provider) {
      throw badRequest("Missing orgId or provider");
    }
    const provider = resolveOauthProviderOrThrow(params.provider);
    await requireOrgAdminMembershipForSecretManagement({ organizationId: params.orgId, userId: auth.userId });

    const parsed = llmOAuthDevicePollSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid OAuth device poll payload", parsed.error.flatten());
    }

    const state = llmOAuthDeviceStates.get(parsed.data.deviceCode);
    if (!state || state.organizationId !== params.orgId || state.provider !== provider) {
      throw unauthorized("Invalid OAuth device code");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (state.expiresAtSec <= nowSec) {
      llmOAuthDeviceStates.delete(parsed.data.deviceCode);
      throw unauthorized("OAuth device code expired");
    }

    if (!parsed.data.token) {
      return { status: "pending" as const };
    }

    const connectorId = normalizeConnectorId(`llm.${provider}.oauth`);
    const name = parsed.data.name?.trim() || state.name || "default";
    const value = parsed.data.token.trim();
    if (!value) {
      throw badRequest("Token is required.");
    }

    try {
      await store.createConnectorSecret({
        organizationId: params.orgId,
        actorUserId: auth.userId,
        connectorId,
        name,
        value,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SECRET_ALREADY_EXISTS") {
        const existingAll = await store.listConnectorSecrets({
          organizationId: params.orgId,
          actorUserId: auth.userId,
          connectorId: null,
        });
        const existing = existingAll.filter((secret) => normalizeConnectorId(secret.connectorId) === connectorId);
        const current = existing.find((s) => s.name === name) ?? null;
        if (!current) {
          throw new AppError(500, { code: "LLM_OAUTH_STORE_FAILED", message: "Failed to rotate existing OAuth secret." });
        }
        await store.rotateConnectorSecret({
          organizationId: params.orgId,
          actorUserId: auth.userId,
          secretId: current.id,
          value,
        });
      } else {
        throw error;
      }
    }

    llmOAuthDeviceStates.delete(parsed.data.deviceCode);

    const secretsAll = await store.listConnectorSecrets({
      organizationId: params.orgId,
      actorUserId: auth.userId,
      connectorId: null,
    });
    const secrets = secretsAll.filter((secret) => normalizeConnectorId(secret.connectorId) === connectorId);
    const current = secrets.find((s) => s.name === name) ?? null;
    return {
      status: "connected" as const,
      secretId: current?.id ?? null,
      connectorId,
      name,
    };
  });

  server.delete("/v1/orgs/:orgId/llm/oauth/:provider/:secretId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; provider?: string; secretId?: string };
    if (!params.orgId || !params.provider || !params.secretId) {
      throw badRequest("Missing orgId or provider or secretId");
    }
    const provider = resolveOauthProviderOrThrow(params.provider);
    await requireOrgAdminMembershipForSecretManagement({ organizationId: params.orgId, userId: auth.userId });
    const connectorId = normalizeConnectorId(`llm.${provider}.oauth`);

    const secretsAll = await store.listConnectorSecrets({
      organizationId: params.orgId,
      actorUserId: auth.userId,
      connectorId: null,
    });
    const secrets = secretsAll.filter((secret) => normalizeConnectorId(secret.connectorId) === connectorId);
    const hit = secrets.find((s) => s.id === params.secretId) ?? null;
    if (!hit) {
      throw secretNotFound();
    }
    const ok = await store.deleteConnectorSecret({
      organizationId: params.orgId,
      actorUserId: auth.userId,
      secretId: params.secretId,
    });
    if (!ok) {
      throw secretNotFound();
    }
    return { ok: true };
  });

  server.get("/v1/orgs/:orgId/llm/vertex/start", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const parsed = vertexStartQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid vertex connection query", parsed.error.flatten());
    }

    // Do not require X-Org-Id for start URLs (browser navigations cannot set headers).
    const membership = await store.getMembership({
      organizationId: params.orgId,
      userId: auth.userId,
      actorUserId: auth.userId,
    });
    if (!membership) {
      throw forbidden("Organization access denied");
    }
    if (!["owner", "admin"].includes(membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    if (!vertexOAuthService) {
      throw new AppError(500, { code: "VERTEX_OAUTH_NOT_CONFIGURED", message: "Vertex OAuth is not configured" });
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);

    vertexOAuthStates.set(state, {
      organizationId: params.orgId,
      userId: auth.userId,
      projectId: parsed.data.projectId.trim(),
      location: parsed.data.location.trim(),
      codeVerifier,
      nonce,
      expiresAtSec: nowSec + OAUTH_CONTEXT_TTL_SEC,
    });
    setVertexOAuthCookies(reply, { state, nonce });

    const url = vertexOAuthService.createAuthorizationUrl({ state, codeVerifier, nonce });
    return reply.redirect(url.toString());
  });

  server.get("/v1/llm/vertex/callback", async (request, reply) => {
    const auth = requireAuth(request);

    function redirectWithError(code: string) {
      const locale = localeFromAcceptLanguage(request.headers["accept-language"] as string | undefined);
      const redirectUrl = new URL(`/${locale}/models`, WEB_BASE_URL);
      redirectUrl.searchParams.set("vertex", "error");
      redirectUrl.searchParams.set("code", code);
      return reply.redirect(redirectUrl.toString());
    }

    try {
      const parsed = oauthQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        throw badRequest("Invalid callback query", parsed.error.flatten());
      }

      const signedStateCookie = request.cookies[VERTEX_OAUTH_STATE_COOKIE_NAME];
      const signedNonceCookie = request.cookies[VERTEX_OAUTH_NONCE_COOKIE_NAME];
      if (!signedStateCookie || !signedNonceCookie) {
        throw unauthorized("Missing vertex OAuth state/nonce cookies");
      }

      const stateCookiePayload = verifyRefreshToken(signedStateCookie, oauthStateSecret);
      const nonceCookiePayload = verifyRefreshToken(signedNonceCookie, oauthStateSecret);
      if (!stateCookiePayload || !nonceCookiePayload) {
        throw unauthorized("Invalid vertex OAuth state/nonce cookies");
      }
      if (stateCookiePayload.sessionId !== parsed.data.state) {
        throw unauthorized("Invalid vertex OAuth state");
      }

      const stored = vertexOAuthStates.get(parsed.data.state);
      if (!stored) {
        throw unauthorized("Invalid vertex OAuth state");
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (stored.expiresAtSec < nowSec) {
        vertexOAuthStates.delete(parsed.data.state);
        throw unauthorized("Vertex OAuth state expired");
      }
      if (stored.userId !== auth.userId) {
        throw unauthorized("Vertex OAuth state does not match authenticated user");
      }
      if (nonceCookiePayload.sessionId !== stored.nonce) {
        throw unauthorized("Invalid vertex OAuth nonce");
      }

      clearVertexOAuthCookies(reply);
      vertexOAuthStates.delete(parsed.data.state);

      if (!vertexOAuthService) {
        throw new AppError(500, { code: "VERTEX_OAUTH_NOT_CONFIGURED", message: "Vertex OAuth is not configured" });
      }

      const connection = await vertexOAuthService.exchangeCodeForConnection({
        code: parsed.data.code,
        codeVerifier: stored.codeVerifier,
        nonce: stored.nonce,
      });

      const connectorId = normalizeConnectorId("llm.vertex.oauth");
      const name = "default";
      const value = JSON.stringify({
        refreshToken: connection.refreshToken,
        projectId: stored.projectId,
        location: stored.location,
        accountEmail: connection.profile.email,
        scopes: connection.scopes,
        createdAt: new Date().toISOString(),
      });

      try {
        await store.createConnectorSecret({
          organizationId: stored.organizationId,
          actorUserId: auth.userId,
          connectorId,
          name,
          value,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "SECRET_ALREADY_EXISTS") {
          const existingAll = await store.listConnectorSecrets({
            organizationId: stored.organizationId,
            actorUserId: auth.userId,
            connectorId: null,
          });
          const existing = existingAll.filter((secret) => normalizeConnectorId(secret.connectorId) === connectorId);
          const current = existing.find((s) => s.name === name) ?? null;
          if (!current) {
            throw new AppError(500, { code: "VERTEX_OAUTH_STORE_FAILED", message: "Failed to rotate existing Vertex connection secret" });
          }
          await store.rotateConnectorSecret({
            organizationId: stored.organizationId,
            actorUserId: auth.userId,
            secretId: current.id,
            value,
          });
        } else {
          throw error;
        }
      }

      const locale = localeFromAcceptLanguage(request.headers["accept-language"] as string | undefined);
      const redirectUrl = new URL(`/${locale}/models`, WEB_BASE_URL);
      redirectUrl.searchParams.set("vertex", "success");
      redirectUrl.searchParams.set("orgId", stored.organizationId);
      return reply.redirect(redirectUrl.toString());
    } catch (error) {
      if (error instanceof AppError) {
        return redirectWithError(error.payload.code);
      }
      if (error instanceof Error) {
        if (error.message === "VERTEX_OAUTH_REFRESH_TOKEN_REQUIRED") {
          return redirectWithError("VERTEX_OAUTH_REFRESH_TOKEN_REQUIRED");
        }
        if (error.message === "OAUTH_INVALID_NONCE") {
          return redirectWithError("OAUTH_INVALID_NONCE");
        }
        if (error.message === "OAUTH_EMAIL_REQUIRED") {
          return redirectWithError("OAUTH_EMAIL_REQUIRED");
        }
      }
      return redirectWithError("VERTEX_OAUTH_FAILED");
    }
  });

  server.delete("/v1/orgs/:orgId/llm/vertex", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const membership = await store.getMembership({
      organizationId: params.orgId,
      userId: auth.userId,
      actorUserId: auth.userId,
    });
    if (!membership) {
      throw forbidden("Organization access denied");
    }
    if (!["owner", "admin"].includes(membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const existingAll = await store.listConnectorSecrets({
      organizationId: params.orgId,
      actorUserId: auth.userId,
      connectorId: null,
    });
    const existing = existingAll.filter((secret) => normalizeConnectorId(secret.connectorId) === normalizeConnectorId("llm.vertex.oauth"));

    const current = existing.find((s) => s.name === "default") ?? null;
    if (current) {
      await store.deleteConnectorSecret({
        organizationId: params.orgId,
        actorUserId: auth.userId,
        secretId: current.id,
      });
    }

    return { ok: true };
  });

  async function listExecutorsHandler(request: any) {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage executors");
    }

    const executors = await store.listOrganizationExecutors({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });
    const nowMs = Date.now();
    const staleMsRaw = Number(process.env.GATEWAY_EXECUTOR_STALE_MS ?? process.env.GATEWAY_AGENT_STALE_MS ?? 60_000);
    const staleMs = Number.isFinite(staleMsRaw) ? staleMsRaw : 60_000;
    const onlineWindowMs = Math.min(5 * 60_000, Math.max(30_000, staleMs));

    return {
      executors: executors.map((executor) => {
        const lastSeenMs = executor.lastSeenAt ? new Date(executor.lastSeenAt).getTime() : null;
        const online = Boolean(lastSeenMs && nowMs - lastSeenMs < onlineWindowMs);
        const status = executor.revokedAt ? "revoked" : online ? "online" : "offline";
        const reportedTagsRaw =
          executor.capabilities && typeof executor.capabilities === "object"
            ? (executor.capabilities as any).labels
            : null;
        const reportedLabels = Array.isArray(reportedTagsRaw)
          ? reportedTagsRaw.filter((item): item is string => typeof item === "string")
          : [];
        return {
          id: executor.id,
          name: executor.name,
          status,
          lastSeenAt: executor.lastSeenAt,
          createdAt: executor.createdAt,
          revokedAt: executor.revokedAt,
          labels: executor.labels ?? [],
          reportedLabels,
        };
      }),
    };
  }

  server.get("/v1/orgs/:orgId/agents", listExecutorsHandler);
  server.get("/v1/orgs/:orgId/executors", listExecutorsHandler);

  async function setExecutorLabelsHandler(request: any) {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; executorId?: string; agentId?: string };
    const targetId = params.executorId ?? params.agentId ?? null;
    if (!params.orgId || !targetId) {
      throw badRequest("Missing orgId or executorId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage executors");
    }

    const body = z
      .object({
        labels: z.array(z.string().min(1).max(64)).max(50),
      })
      .safeParse(request.body);
    if (!body.success) {
      throw badRequest("Invalid labels payload", body.error.flatten());
    }

    const normalized = [...new Set(body.data.labels.map((label) => label.trim()).filter((label) => label.length > 0))];

    const updated = await store.setOrganizationExecutorLabels({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      executorId: targetId,
      labels: normalized,
    });
    if (!updated) {
      throw agentNotFound();
    }

    return { ok: true, executor: { id: updated.id, labels: updated.labels ?? [] } };
  }

  server.put("/v1/orgs/:orgId/agents/:agentId/tags", async (request) => {
    // Backward-compatible alias.
    const body = request.body as any;
    request.body = { labels: Array.isArray(body?.tags) ? body.tags : [] };
    return await setExecutorLabelsHandler(request);
  });
  server.put("/v1/orgs/:orgId/executors/:executorId/labels", setExecutorLabelsHandler);

  async function createExecutorPairingTokenHandler(request: any, reply: any) {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage executors");
    }

    const token = `${orgContext.organizationId}.${crypto.randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await store.createExecutorPairingToken({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      tokenHash: sha256Hex(token),
      expiresAt,
    });

    return reply.status(201).send({ token, expiresAt: expiresAt.toISOString() });
  }

  server.post("/v1/orgs/:orgId/agents/pairing-tokens", createExecutorPairingTokenHandler);
  server.post("/v1/orgs/:orgId/executors/pairing-tokens", createExecutorPairingTokenHandler);

  async function revokeExecutorHandler(request: any) {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; executorId?: string; agentId?: string };
    const targetId = params.executorId ?? params.agentId ?? null;
    if (!params.orgId || !targetId) {
      throw badRequest("Missing orgId or executorId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage executors");
    }

    const ok = await store.revokeOrganizationExecutor({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      executorId: targetId,
    });

    if (!ok) {
      throw agentNotFound();
    }

    return { ok: true };
  }

  server.post("/v1/orgs/:orgId/agents/:agentId/revoke", revokeExecutorHandler);
  server.post("/v1/orgs/:orgId/executors/:executorId/revoke", revokeExecutorHandler);

  async function deleteExecutorHandler(request: any) {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; executorId?: string; agentId?: string };
    const targetId = params.executorId ?? params.agentId ?? null;
    if (!params.orgId || !targetId) {
      throw badRequest("Missing orgId or executorId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage executors");
    }

    const executors = await store.listOrganizationExecutors({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });
    const target = executors.find((executor) => executor.id === targetId) ?? null;
    if (!target) {
      throw agentNotFound();
    }
    if (!target.revokedAt) {
      throw conflict("Only revoked worker nodes can be deleted");
    }

    const ok = await store.deleteOrganizationExecutor({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      executorId: targetId,
    });
    if (!ok) {
      throw conflict("Failed to delete revoked worker node");
    }

    return { ok: true };
  }

  server.delete("/v1/orgs/:orgId/agents/:agentId", deleteExecutorHandler);
  server.delete("/v1/orgs/:orgId/executors/:executorId", deleteExecutorHandler);

  server.post("/v1/orgs/:orgId/sessions", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });

    const body = z
      .object({
        title: z.string().max(200).optional(),
        actor: z.string().uuid().optional(),
        channel: z.string().min(1).max(120).optional(),
        peer: z.string().min(1).max(240).optional(),
        scope: z.enum(["main", "per-peer", "per-channel-peer", "per-account-channel-peer"]).default("main"),
        context: z.record(z.string().min(1), z.unknown()).optional(),
        executionMode: z.enum(["pinned-node-host"]).default("pinned-node-host"),
        engine: z.object({
          id: z.enum(["gateway.codex.v2", "gateway.claude.v2", "gateway.opencode.v2"]),
          model: z.string().min(1).max(200).optional(),
          auth: z
            .object({
              secretId: z.string().uuid().optional(),
            })
            .strict()
            .optional(),
        }),
        toolsetId: z.string().uuid().optional(),
        prompt: z.object({
          system: z.string().max(200_000).optional(),
          instructions: z.string().min(1).max(200_000),
        }),
        tools: z.object({
          allow: z.array(z.string().min(1).max(120)).max(200).default([]),
        }),
        limits: z.unknown().optional(),
        resetPolicy: z.unknown().optional(),
        executorSelector: z
          .object({
            pool: z.literal("byon").default("byon"),
            labels: z.array(z.string().min(1).max(64)).max(50).optional(),
            group: z.string().min(1).max(64).optional(),
            tag: z.string().min(1).max(64).optional(),
            executorId: z.string().uuid().optional(),
          })
          .optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      throw badRequest("Invalid session payload", body.error.flatten());
    }

    if (!isAgentEngineId(body.data.engine.id)) {
      throw badRequest(`Unsupported engine: ${body.data.engine.id}`);
    }
    const engineMeta = getAgentEngineMeta(body.data.engine.id);
    if (!engineMeta) {
      throw badRequest(`Unsupported engine: ${body.data.engine.id}`);
    }
    const engineId = body.data.engine.id;
    const orgSettings = normalizeOrgSettings(
      await store.getOrganizationSettings({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
      })
    );
    const engineAuthDefault = orgSettings.agents.engineAuthDefaults[engineId];
    const engineRuntimeDefault = orgSettings.agents.engineRuntimeDefaults[engineId];
    const resolvedEngineSecretId =
      body.data.engine.auth?.secretId ??
      (engineAuthDefault.mode === "api_key" && typeof engineAuthDefault.secretId === "string" ? engineAuthDefault.secretId : null);
    const resolvedEngine = {
      id: engineId,
      model: body.data.engine.model?.trim() || engineMeta.defaultModel,
      auth: { secretId: resolvedEngineSecretId },
      runtime: { baseUrl: engineRuntimeDefault.baseUrl ?? null },
    };

    const bindings = await store.listAgentBindings({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });

    const dimensionOrder = [
      "peer",
      "parent_peer",
      "org_roles",
      "organization",
      "team",
      "account",
      "channel",
      "default",
    ] as const;
    const matchBinding = (binding: any) => {
      const match = (binding.match ?? {}) as Record<string, unknown>;
      if (binding.dimension === "peer") {
        return typeof match.peer === "string" && match.peer === body.data.peer;
      }
      if (binding.dimension === "parent_peer") {
        return false;
      }
      if (binding.dimension === "org_roles") {
        const roleSet = new Set([orgContext.membership.roleKey]);
        const needed = Array.isArray(match.orgRoles) ? match.orgRoles.filter((x): x is string => typeof x === "string") : [];
        return needed.some((role) => roleSet.has(role as any));
      }
      if (binding.dimension === "organization") {
        return !match.organizationId || match.organizationId === orgContext.organizationId;
      }
      if (binding.dimension === "team") {
        const team = typeof body.data.context?.team === "string" ? body.data.context.team : null;
        return typeof match.teamId === "string" && match.teamId === team;
      }
      if (binding.dimension === "account") {
        const account = typeof body.data.context?.account === "string" ? body.data.context.account : null;
        return typeof match.accountId === "string" && match.accountId === account;
      }
      if (binding.dimension === "channel") {
        return typeof match.channelId === "string" && match.channelId === body.data.channel;
      }
      return binding.dimension === "default";
    };
    const matched = bindings
      .filter((binding: any) => matchBinding(binding))
      .sort((left: any, right: any) => {
        const leftRank = dimensionOrder.indexOf(left.dimension as any);
        const rightRank = dimensionOrder.indexOf(right.dimension as any);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        if ((left.priority ?? 0) !== (right.priority ?? 0)) {
          return (right.priority ?? 0) - (left.priority ?? 0);
        }
        return String(left.id).localeCompare(String(right.id));
      })[0] ?? null;

    const routedAgentId = matched?.agentId ?? null;
    const normalizedPart = (value: string | null | undefined, fallback: string) => {
      if (!value || value.trim().length === 0) return fallback;
      return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    };
    const sessionKeyBase = `agent:${normalizedPart(routedAgentId ?? "main", "main")}:org:${normalizedPart(
      orgContext.organizationId,
      "unknown-org"
    )}:scope:${normalizedPart(body.data.scope, "main")}`;
    const sessionKey =
      body.data.scope === "per-peer"
        ? `${sessionKeyBase}:peer:${normalizedPart(body.data.peer ?? body.data.actor ?? auth.userId, "anonymous")}`
        : body.data.scope === "per-channel-peer"
          ? `${sessionKeyBase}:channel:${normalizedPart(body.data.channel, "unknown-channel")}:peer:${normalizedPart(body.data.peer ?? body.data.actor ?? auth.userId, "anonymous")}`
          : body.data.scope === "per-account-channel-peer"
            ? `${sessionKeyBase}:account:${normalizedPart(typeof body.data.context?.account === "string" ? body.data.context.account : null, "unknown-account")}:channel:${normalizedPart(body.data.channel, "unknown-channel")}:peer:${normalizedPart(body.data.peer ?? body.data.actor ?? auth.userId, "anonymous")}`
            : `${sessionKeyBase}:chat:${crypto.randomUUID()}`;

    const session = await store.createAgentSession({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionKey,
      scope: body.data.scope,
      routedAgentId,
      ...(matched ? { bindingId: matched.id } : {}),
      title: body.data.title ?? "",
      engineId,
      toolsetId: body.data.toolsetId ?? null,
      llm: {
        provider: engineId === "gateway.claude.v2" ? "claude" : engineId === "gateway.opencode.v2" ? "opencode" : "codex",
        model: resolvedEngine.model,
        auth: { ...(resolvedEngine.auth.secretId ? { secretId: resolvedEngine.auth.secretId } : {}) },
      },
      prompt: { system: body.data.prompt.system ?? null, instructions: body.data.prompt.instructions },
      tools: body.data.tools,
      limits: body.data.limits ?? {},
      runtime: {
        engine: {
          [engineId]: {
            baseUrl: resolvedEngine.runtime.baseUrl,
          },
        },
      },
      resetPolicySnapshot: body.data.resetPolicy ?? {},
      executorSelector: body.data.executorSelector ?? { pool: "byon" },
    });

    await store.appendAgentSessionEvent({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      eventType: "session_created",
      level: "info",
      payload: {
        engineId,
        engine: resolvedEngine,
        route: {
          sessionKey,
          scope: body.data.scope,
          routedAgentId,
          bindingId: matched?.id ?? null,
        },
        executionMode: body.data.executionMode,
      },
    });

    return reply.status(201).send({ session });
  });

  server.post("/v1/orgs/:orgId/sessions/:sessionId/messages", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const body = z
      .object({
        message: z.string().min(1).max(50_000),
        attachments: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              mimeType: z.string().min(1).max(120),
              contentUrl: z.string().url().optional().nullable(),
              contentText: z.string().max(100_000).optional().nullable(),
              metadata: z.record(z.string().min(1), z.unknown()).optional(),
            })
          )
          .max(32)
          .optional(),
        idempotencyKey: z.string().min(1).max(200).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      throw badRequest("Invalid session message payload", body.error.flatten());
    }

    const session = await store.getAgentSessionById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw notFound("Session not found");
    }
    if (session.status === "archived") {
      throw new AppError(409, {
        code: "SESSION_ARCHIVED",
        message: "Session is archived",
      });
    }

    const userEvent = await store.appendAgentSessionEvent({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
      eventType: "user_message",
      level: "info",
      ...(body.data.idempotencyKey ? { idempotencyKey: body.data.idempotencyKey } : {}),
      payload: {
        message: body.data.message,
        attachments: body.data.attachments ?? [],
      },
    });

    const gatewayRes = await fetch(`${GATEWAY_HTTP_URL}/internal/v1/sessions/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": GATEWAY_INTERNAL_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        organizationId: orgContext.organizationId,
        userId: auth.userId,
        sessionId: params.sessionId,
        userEventSeq: userEvent.seq,
        message: body.data.message,
        attachments: body.data.attachments ?? [],
        idempotencyKey: body.data.idempotencyKey ?? null,
      }),
    });
    if (!gatewayRes.ok) {
      throw new AppError(503, {
        code: "QUEUE_UNAVAILABLE",
        message: "Failed to enqueue session turn",
      });
    }

    return reply.status(202).send({ accepted: true, event: userEvent });
  });

  server.post("/v1/orgs/:orgId/sessions/:sessionId/reset", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const body = z
      .object({
        mode: z.enum(["keep_history", "clear_history"]).default("keep_history"),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      throw badRequest("Invalid reset payload", body.error.flatten());
    }

    const session = await store.setAgentSessionPinnedAgent({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
      pinnedAgentId: null,
      pinnedExecutorId: null,
      pinnedExecutorPool: null,
    });
    if (!session) {
      throw notFound("Session not found");
    }

    await store.appendAgentSessionEvent({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
      eventType: "system",
      level: "info",
      payload: { action: "session_reset_agent", mode: body.data.mode },
    });

    return { ok: true, session };
  });

  server.get("/v1/orgs/:orgId/sessions", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });

    const query = request.query as { limit?: string; cursor?: string; status?: string };
    const limitRaw = query.limit ? Number(query.limit) : 50;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const status = query.status === "archived" || query.status === "all" || query.status === "active" ? query.status : "active";
    const cursor = typeof query.cursor === "string" && query.cursor.length > 0
      ? decodeCursor<{ updatedAt: string; id: string }>(query.cursor)
      : null;

    const out = await store.listAgentSessions({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      limit,
      status,
      ...(cursor ? { cursor } : {}),
    });

    return {
      sessions: out.sessions,
      nextCursor: out.nextCursor ? encodeCursor(out.nextCursor) : null,
    };
  });

  server.delete("/v1/orgs/:orgId/sessions/:sessionId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const session = await store.archiveAgentSession({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw notFound("Session not found");
    }
    return { ok: true, session };
  });

  server.post("/v1/orgs/:orgId/sessions/:sessionId/restore", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const session = await store.restoreAgentSession({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw notFound("Session not found");
    }
    return { ok: true, session };
  });

  server.get("/v1/orgs/:orgId/sessions/:sessionId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const session = await store.getAgentSessionById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw notFound("Session not found");
    }
    return { session };
  });

  server.get("/v1/orgs/:orgId/sessions/:sessionId/events", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });

    const query = request.query as { limit?: string; cursor?: string };
    const limitRaw = query.limit ? Number(query.limit) : 200;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;
    const cursor = typeof query.cursor === "string" && query.cursor.length > 0
      ? decodeCursor<{ seq: number }>(query.cursor)
      : null;

    const out = await store.listAgentSessionEvents({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
      limit,
      ...(cursor ? { cursor } : {}),
    });

    return {
      events: out.events,
      nextCursor: out.nextCursor ? encodeCursor(out.nextCursor) : null,
    };
  });

  server.get("/v1/orgs/:orgId/agent-bindings", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const bindings = await store.listAgentBindings({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });
    return { bindings };
  });

  server.post("/v1/orgs/:orgId/agent-bindings", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage bindings");
    }
    const body = z
      .object({
        agentId: z.string().uuid(),
        priority: z.number().int().min(-1000).max(1000).default(0),
        dimension: z.enum(["peer", "parent_peer", "org_roles", "organization", "team", "account", "channel", "default"]),
        match: z.record(z.string().min(1), z.unknown()).default({}),
        metadata: z.record(z.string().min(1), z.unknown()).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      throw badRequest("Invalid binding payload", body.error.flatten());
    }
    const binding = await store.createAgentBinding({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      agentId: body.data.agentId,
      priority: body.data.priority,
      dimension: body.data.dimension,
      match: body.data.match,
      metadata: body.data.metadata ?? null,
    });
    return reply.status(201).send({ binding });
  });

  server.patch("/v1/orgs/:orgId/agent-bindings/:bindingId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; bindingId?: string };
    if (!params.orgId || !params.bindingId) {
      throw badRequest("Missing orgId or bindingId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage bindings");
    }
    const body = z
      .object({
        agentId: z.string().uuid().optional(),
        priority: z.number().int().min(-1000).max(1000).optional(),
        dimension: z.enum(["peer", "parent_peer", "org_roles", "organization", "team", "account", "channel", "default"]).optional(),
        match: z.record(z.string().min(1), z.unknown()).optional(),
        metadata: z.record(z.string().min(1), z.unknown()).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      throw badRequest("Invalid binding patch payload", body.error.flatten());
    }
    const patch: {
      agentId?: string;
      priority?: number;
      dimension?: "peer" | "parent_peer" | "org_roles" | "organization" | "team" | "account" | "channel" | "default";
      match?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {
      ...(body.data.agentId !== undefined ? { agentId: body.data.agentId } : {}),
      ...(body.data.priority !== undefined ? { priority: body.data.priority } : {}),
      ...(body.data.dimension !== undefined ? { dimension: body.data.dimension } : {}),
      ...(body.data.match !== undefined ? { match: body.data.match } : {}),
      ...(body.data.metadata !== undefined ? { metadata: body.data.metadata } : {}),
    };
    const binding = await store.patchAgentBinding({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      bindingId: params.bindingId,
      patch,
    });
    if (!binding) {
      throw notFound("Binding not found");
    }
    return { binding };
  });

  server.delete("/v1/orgs/:orgId/agent-bindings/:bindingId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; bindingId?: string };
    if (!params.orgId || !params.bindingId) {
      throw badRequest("Missing orgId or bindingId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage bindings");
    }
    const ok = await store.deleteAgentBinding({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      bindingId: params.bindingId,
    });
    if (!ok) {
      throw notFound("Binding not found");
    }
    return { ok: true };
  });

  server.post("/v1/orgs/:orgId/memory/sync", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const body = z
      .object({
        sessionId: z.string().uuid().optional(),
        sessionKey: z.string().min(1).max(400).optional(),
        provider: z.enum(["builtin", "qmd"]).default("builtin"),
        reason: z.string().min(1).max(300).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      throw badRequest("Invalid memory sync payload", body.error.flatten());
    }

    const sessionKey = body.data.sessionKey ?? (body.data.sessionId ? `session:${body.data.sessionId}` : "session:main");
    const job = await store.createAgentMemorySyncJob({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: body.data.sessionId ?? null,
      sessionKey,
      provider: body.data.provider,
      status: "queued",
      reason: body.data.reason ?? null,
      details: { source: "api" },
    });

    return reply.status(202).send({ accepted: true, job });
  });

  server.get("/v1/orgs/:orgId/memory/search", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const query = z
      .object({
        q: z.string().min(1).max(500),
        sessionKey: z.string().min(1).max(400).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .safeParse(request.query ?? {});
    if (!query.success) {
      throw badRequest("Invalid memory search query", query.error.flatten());
    }

    const docs = await store.listAgentMemoryDocuments({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      ...(query.data.sessionKey ? { sessionKey: query.data.sessionKey } : {}),
      limit: Math.max((query.data.limit ?? 30) * 2, 20),
    });
    const needle = query.data.q.trim().toLowerCase();
    const matches = docs
      .filter((doc) => doc.docPath.toLowerCase().includes(needle) || doc.contentHash.toLowerCase().includes(needle))
      .slice(0, query.data.limit ?? 30);

    return { results: matches };
  });

  server.get("/v1/orgs/:orgId/memory/docs/:docId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; docId?: string };
    if (!params.orgId || !params.docId) {
      throw badRequest("Missing orgId or docId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const doc = await store.getAgentMemoryDocumentById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      documentId: params.docId,
    });
    if (!doc) {
      throw notFound("Memory document not found");
    }
    const chunks = await store.listAgentMemoryChunksByDocument({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      documentId: doc.id,
      limit: 1000,
    });
    return { document: doc, chunks };
  });

  server.get("/v1/orgs/:orgId/channels/accounts", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const query = z
      .object({
        channelId: channelIdSchema.optional(),
      })
      .safeParse(request.query ?? {});
    if (!query.success) {
      throw badRequest("Invalid channels query", query.error.flatten());
    }

    const accounts = await store.listChannelAccounts({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      ...(query.data.channelId ? { channelId: query.data.channelId } : {}),
    });
    return { accounts };
  });

  server.post("/v1/orgs/:orgId/channels/accounts", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const parsed = channelAccountCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid channel account payload", parsed.error.flatten());
    }

    const account = await store.createChannelAccount({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      channelId: parsed.data.channelId,
      accountKey: parsed.data.accountKey.trim(),
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName.trim() } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.dmPolicy ? { dmPolicy: parsed.data.dmPolicy } : {}),
      ...(parsed.data.groupPolicy ? { groupPolicy: parsed.data.groupPolicy } : {}),
      ...(parsed.data.requireMentionInGroup !== undefined
        ? { requireMentionInGroup: parsed.data.requireMentionInGroup }
        : {}),
      ...(parsed.data.webhookUrl ? { webhookUrl: parsed.data.webhookUrl } : {}),
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
    });
    return reply.status(201).send({ account });
  });

  server.get("/v1/orgs/:orgId/channels/accounts/:accountId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const account = await store.getChannelAccountById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
    });
    if (!account) {
      throw notFound("Channel account not found");
    }
    return { account };
  });

  server.patch("/v1/orgs/:orgId/channels/accounts/:accountId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const parsed = channelAccountUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid channel account patch payload", parsed.error.flatten());
    }
    const account = await store.updateChannelAccount({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      patch: {
        ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.dmPolicy !== undefined ? { dmPolicy: parsed.data.dmPolicy } : {}),
        ...(parsed.data.groupPolicy !== undefined ? { groupPolicy: parsed.data.groupPolicy } : {}),
        ...(parsed.data.requireMentionInGroup !== undefined
          ? { requireMentionInGroup: parsed.data.requireMentionInGroup }
          : {}),
        ...(parsed.data.webhookUrl !== undefined ? { webhookUrl: parsed.data.webhookUrl } : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.lastError !== undefined ? { lastError: parsed.data.lastError } : {}),
      },
    });
    if (!account) {
      throw notFound("Channel account not found");
    }
    return { account };
  });

  server.delete("/v1/orgs/:orgId/channels/accounts/:accountId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const ok = await store.deleteChannelAccount({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
    });
    if (!ok) {
      throw notFound("Channel account not found");
    }
    return { ok: true };
  });

  server.post("/v1/orgs/:orgId/channels/accounts/:accountId/secrets", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const parsed = channelSecretCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid channel secret payload", parsed.error.flatten());
    }
    if (parsed.data.value.trim().length === 0) {
      throw secretValueRequired();
    }
    const secret = await store.createChannelAccountSecret({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      name: parsed.data.name,
      value: parsed.data.value,
    });
    return reply.status(201).send({ secret });
  });

  server.get("/v1/orgs/:orgId/channels/accounts/:accountId/allowlist", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const query = z
      .object({
        scope: z.string().min(1).max(64).optional(),
      })
      .safeParse(request.query ?? {});
    if (!query.success) {
      throw badRequest("Invalid allowlist query", query.error.flatten());
    }

    const entries = await store.listChannelAllowlistEntries({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      ...(query.data.scope ? { scope: query.data.scope } : {}),
    });
    return { entries };
  });

  server.put("/v1/orgs/:orgId/channels/accounts/:accountId/allowlist", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const parsed = channelAllowlistEntrySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid allowlist payload", parsed.error.flatten());
    }

    const entry = await store.putChannelAllowlistEntry({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      scope: parsed.data.scope,
      subject: parsed.data.subject,
    });
    return reply.status(201).send({ entry });
  });

  server.delete("/v1/orgs/:orgId/channels/accounts/:accountId/allowlist", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const parsed = channelAllowlistEntrySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid allowlist payload", parsed.error.flatten());
    }

    const ok = await store.deleteChannelAllowlistEntry({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      scope: parsed.data.scope,
      subject: parsed.data.subject,
    });
    if (!ok) {
      throw notFound("Allowlist entry not found");
    }
    return { ok: true };
  });

  server.get("/v1/orgs/:orgId/channels/accounts/:accountId/status", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const account = await store.getChannelAccountById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
    });
    if (!account) {
      throw notFound("Channel account not found");
    }
    const [events, secrets, pendingPairings, allowlistEntries] = await Promise.all([
      store.listChannelEvents({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        accountId: account.id,
        limit: 20,
      }),
      store.listChannelAccountSecrets({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        accountId: account.id,
      }),
      store.listChannelPairingRequests({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        accountId: account.id,
        status: "pending",
      }),
      store.listChannelAllowlistEntries({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        accountId: account.id,
      }),
    ]);
    return {
      status: {
        account,
        secretsCount: secrets.length,
        pendingPairings: pendingPairings.length,
        allowlistCount: allowlistEntries.length,
        latestEvents: events,
      },
    };
  });

  server.post("/v1/orgs/:orgId/channels/accounts/:accountId/actions/:action", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string; action?: string };
    if (!params.orgId || !params.accountId || !params.action) {
      throw badRequest("Missing orgId, accountId or action");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const action = z.enum(["start", "stop", "reconnect", "login", "logout"]).safeParse(params.action);
    if (!action.success) {
      throw badRequest("Invalid action");
    }
    const nextStatus = action.data === "stop" || action.data === "logout" ? "stopped" : "running";
    const account = await store.updateChannelAccount({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
      patch: {
        status: nextStatus,
        ...(action.data === "start" || action.data === "reconnect" || action.data === "login" ? { lastError: null } : {}),
      },
    });
    if (!account) {
      throw notFound("Channel account not found");
    }
    return { ok: true, action: action.data, account };
  });

  server.post("/v1/orgs/:orgId/channels/accounts/:accountId/test-send", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; accountId?: string };
    if (!params.orgId || !params.accountId) {
      throw badRequest("Missing orgId or accountId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }

    const parsed = channelTestSendSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid channel test-send payload", parsed.error.flatten());
    }

    const account = await store.getChannelAccountById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      accountId: params.accountId,
    });
    if (!account) {
      throw notFound("Channel account not found");
    }

    const gatewayPayload = {
      organizationId: orgContext.organizationId,
      channelId: account.channelId,
      accountId: account.id,
      accountKey: account.accountKey,
      conversationId: parsed.data.conversationId,
      text: parsed.data.text,
      ...(parsed.data.replyToProviderMessageId ? { replyToProviderMessageId: parsed.data.replyToProviderMessageId } : {}),
    };

    let gatewayResponse: Response;
    try {
      gatewayResponse = await fetch(new URL("/internal/v1/channels/test-send", GATEWAY_HTTP_URL).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gateway-token": GATEWAY_INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify(gatewayPayload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw channelDeliveryUnavailable(error instanceof Error ? error.message : "Gateway request failed");
    }

    if (!gatewayResponse.ok) {
      const body = await gatewayResponse.text();
      throw channelDeliveryFailed(`Gateway returned ${gatewayResponse.status} for channel test-send`, {
        status: gatewayResponse.status,
        body: body.slice(0, 500),
      });
    }

    let gatewayJson: unknown = null;
    try {
      gatewayJson = await gatewayResponse.json();
    } catch {
      throw channelDeliveryFailed("Gateway returned non-JSON response for channel test-send");
    }

    const gatewayResult = z
      .object({
        ok: z.boolean(),
        result: z.object({
          delivered: z.boolean(),
          status: z.enum(["accepted", "dead_letter", "failed", "channel_disabled", "account_unavailable"]),
          attemptCount: z.number().int().min(0),
          providerMessageId: z.string().min(1),
          error: z.string().nullable(),
        }),
      })
      .safeParse(gatewayJson);
    if (!gatewayResult.success) {
      throw channelDeliveryFailed("Gateway returned invalid channel test-send payload", gatewayResult.error.flatten());
    }

    return gatewayResult.data;
  });

  server.get("/v1/orgs/:orgId/channels/pairing/requests", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const query = z
      .object({
        accountId: z.string().uuid().optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
      })
      .safeParse(request.query ?? {});
    if (!query.success) {
      throw badRequest("Invalid pairing request query", query.error.flatten());
    }
    const requests = await store.listChannelPairingRequests({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      ...(query.data.accountId ? { accountId: query.data.accountId } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
    });
    return { requests };
  });

  server.post("/v1/orgs/:orgId/channels/pairing/requests/:requestId/approve", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; requestId?: string };
    if (!params.orgId || !params.requestId) {
      throw badRequest("Missing orgId or requestId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const updated = await store.updateChannelPairingRequestStatus({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      requestId: params.requestId,
      status: "approved",
    });
    if (!updated) {
      throw notFound("Pairing request not found");
    }
    return { request: updated };
  });

  server.post("/v1/orgs/:orgId/channels/pairing/requests/:requestId/reject", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; requestId?: string };
    if (!params.orgId || !params.requestId) {
      throw badRequest("Missing orgId or requestId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage channels");
    }
    const updated = await store.updateChannelPairingRequestStatus({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      requestId: params.requestId,
      status: "rejected",
    });
    if (!updated) {
      throw notFound("Pairing request not found");
    }
    return { request: updated };
  });

  server.get("/v1/orgs/:orgId/toolsets", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }
    const toolsets = await store.listAgentToolsetsByOrg({ organizationId: orgContext.organizationId, actorUserId: auth.userId });
    return { toolsets };
  });

  server.post("/v1/orgs/:orgId/toolsets", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid toolset payload", parsed.error.flatten());
    }

    const mcpCheck = validateMcpPlaceholderPolicy(parsed.data.mcpServers);
    if (!mcpCheck.ok) {
      throw invalidMcpPlaceholder(mcpCheck);
    }
    const skillCheck = validateAgentSkillBundles(parsed.data.agentSkills);
    if (!skillCheck.ok) {
      throw invalidSkillBundle(skillCheck);
    }

    const toolset = await store.createAgentToolset({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility,
      mcpServers: parsed.data.mcpServers,
      agentSkills: parsed.data.agentSkills,
    });

    return reply.status(201).send({ toolset });
  });

  server.get("/v1/orgs/:orgId/toolsets/:toolsetId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; toolsetId?: string };
    if (!params.orgId || !params.toolsetId) {
      throw badRequest("Missing orgId or toolsetId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const toolset = await store.getAgentToolsetById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
    });
    if (!toolset) {
      throw toolsetNotFound();
    }
    return { toolset };
  });

  server.put("/v1/orgs/:orgId/toolsets/:toolsetId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; toolsetId?: string };
    if (!params.orgId || !params.toolsetId) {
      throw badRequest("Missing orgId or toolsetId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid toolset payload", parsed.error.flatten());
    }

    const current = await store.getAgentToolsetById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
    });
    if (!current) {
      throw toolsetNotFound();
    }
    if (current.visibility === "public") {
      throw new AppError(400, { code: "BAD_REQUEST", message: "Published toolsets must be unpublished before editing." });
    }
    const mcpCheck = validateMcpPlaceholderPolicy(parsed.data.mcpServers);
    if (!mcpCheck.ok) {
      throw invalidMcpPlaceholder(mcpCheck);
    }
    const skillCheck = validateAgentSkillBundles(parsed.data.agentSkills);
    if (!skillCheck.ok) {
      throw invalidSkillBundle(skillCheck);
    }

    const toolset = await store.updateAgentToolset({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility,
      mcpServers: parsed.data.mcpServers,
      agentSkills: parsed.data.agentSkills,
    });
    if (!toolset) {
      throw toolsetNotFound();
    }
    return { toolset };
  });

  server.delete("/v1/orgs/:orgId/toolsets/:toolsetId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; toolsetId?: string };
    if (!params.orgId || !params.toolsetId) {
      throw badRequest("Missing orgId or toolsetId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const ok = await store.deleteAgentToolset({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
    });
    if (!ok) {
      throw toolsetNotFound();
    }
    return { ok: true };
  });

  server.post("/v1/orgs/:orgId/toolsets/:toolsetId/publish", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; toolsetId?: string };
    if (!params.orgId || !params.toolsetId) {
      throw badRequest("Missing orgId or toolsetId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetPublishSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid publish payload", parsed.error.flatten());
    }

    // Re-validate placeholder policy for public distribution.
    const current = await store.getAgentToolsetById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
    });
    if (!current) {
      throw toolsetNotFound();
    }
    const mcpCheck = validateMcpPlaceholderPolicy(current.mcpServers);
    if (!mcpCheck.ok) {
      throw invalidMcpPlaceholder(mcpCheck);
    }
    const skillCheck = validateAgentSkillBundles(current.agentSkills);
    if (!skillCheck.ok) {
      throw invalidSkillBundle(skillCheck);
    }

    try {
      const toolset = await store.publishAgentToolset({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        toolsetId: params.toolsetId,
        publicSlug: parsed.data.publicSlug,
      });
      if (!toolset) {
        throw toolsetNotFound();
      }
      return { toolset };
    } catch (error) {
      if (error instanceof Error && error.message === "PUBLIC_SLUG_CONFLICT") {
        throw publicSlugConflict();
      }
      throw error;
    }
  });

  server.post("/v1/orgs/:orgId/toolsets/:toolsetId/unpublish", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; toolsetId?: string };
    if (!params.orgId || !params.toolsetId) {
      throw badRequest("Missing orgId or toolsetId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetUnpublishSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid unpublish payload", parsed.error.flatten());
    }
    const visibility = parsed.data.visibility ?? "org";

    const toolset = await store.unpublishAgentToolset({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      toolsetId: params.toolsetId,
      visibility,
    });
    if (!toolset) {
      throw toolsetNotFound();
    }
    return { toolset };
  });

  const toolsetCatalog = getToolsetCatalog();
  const toolsetCatalogByKey = new Map<string, ToolsetCatalogItem>(toolsetCatalog.map((it) => [it.key, it]));

  function normalizeSelectedComponentKeys(keys: string[]): string[] {
    const uniq = Array.from(new Set(keys.map((k) => String(k).trim()).filter(Boolean)));
    const invalid = uniq.filter((k) => !toolsetCatalogByKey.has(k));
    if (invalid.length > 0) {
      throw badRequest("Invalid selectedComponentKeys", { invalid });
    }
    return uniq;
  }

  function expectedLlmConnectorId(provider: LlmProviderId): string {
    const connectorId = getDefaultConnectorIdForProvider(provider);
    if (!connectorId) {
      throw badRequest(`Provider ${provider} does not support secrets in toolset builder context.`);
    }
    return normalizeConnectorId(connectorId);
  }

  async function resolveToolsetBuilderSecretValue(input: {
    llm: ToolsetBuilderLlmConfig;
    organizationId: string;
    actorUserId: string;
  }): Promise<string | null> {
    const secretId = input.llm.auth?.secretId?.trim() ?? "";
    if (!secretId) {
      return null;
    }
    const expectedConnectorId = expectedLlmConnectorId(input.llm.provider);
    const allSecrets = await store.listConnectorSecrets({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      connectorId: null,
    });
    const secrets = allSecrets.filter((secret) => normalizeConnectorId(secret.connectorId) === expectedConnectorId);
    const secretMeta = secrets.find((s) => s.id === secretId) ?? null;
    if (!secretMeta) {
      throw llmSecretRequired(`Secret must be a ${expectedConnectorId} org secret`);
    }
    const secretValue = await store.loadConnectorSecretValue({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      secretId,
    });
    if (!secretValue || secretValue.trim().length === 0) {
      throw llmSecretRequired(`Secret value is required for ${expectedConnectorId}`);
    }
    return secretValue;
  }

  function resolveLlmProviderRuntime(input: {
    provider: LlmProviderId;
    orgSettings: ReturnType<typeof normalizeOrgSettings>;
  }): { apiKind: LlmProviderApiKind; apiBaseUrl: string | null } {
    const providerMeta = getLlmProviderMeta(input.provider);
    if (!providerMeta) {
      throw badRequest(`Unsupported provider: ${input.provider}`);
    }
    const providerOverride = input.orgSettings.llm.providers[input.provider];
    return {
      apiKind: providerOverride?.apiKind ?? providerMeta.apiKind,
      apiBaseUrl: providerOverride?.baseUrl ?? null,
    };
  }

  function resolveManagedBuilderApiKey(apiKind: LlmProviderApiKind): string | null {
    if (apiKind === "anthropic-compatible") {
      return process.env.LLM_MANAGED_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? null;
    }
    if (apiKind === "google") {
      return process.env.LLM_MANAGED_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
    }
    return process.env.LLM_MANAGED_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  }

  async function callBuilderLlm(input: {
    llm: ToolsetBuilderLlmConfig;
    secretValue: string | null;
    messages: OpenAiChatMessage[];
    orgSettings: ReturnType<typeof normalizeOrgSettings>;
  }) {
    const timeoutMs = 25_000;
    const runtime = resolveLlmProviderRuntime({ provider: input.llm.provider, orgSettings: input.orgSettings });

    if (runtime.apiKind === "vertex") {
      const parsedSecret = z
        .object({
          refreshToken: z.string().min(1),
          projectId: z.string().min(1),
          location: z.string().min(1),
        })
        .safeParse((() => {
          try {
            return JSON.parse(input.secretValue ?? "");
          } catch {
            return null;
          }
        })());
      if (!parsedSecret.success) {
        return { ok: false as const, error: "VERTEX_SECRET_INVALID" };
      }
      return vertexGenerateContent({
        refreshToken: parsedSecret.data.refreshToken,
        projectId: parsedSecret.data.projectId,
        location: parsedSecret.data.location,
        model: input.llm.model,
        messages: input.messages,
        timeoutMs,
        maxOutputChars: 80_000,
        ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
      });
    }

    const explicitApiKey = input.secretValue?.trim() ?? "";
    const managedApiKey = resolveManagedBuilderApiKey(runtime.apiKind);
    const apiKey = explicitApiKey || managedApiKey || "";
    if (!apiKey) {
      return { ok: false as const, error: "LLM_AUTH_NOT_CONFIGURED" };
    }

    if (runtime.apiKind === "anthropic-compatible") {
      return anthropicChatCompletion({
        apiKey,
        model: input.llm.model,
        messages: input.messages,
        timeoutMs,
        maxOutputChars: 80_000,
        ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
      });
    }

    if (runtime.apiKind === "google") {
      return geminiGenerateContent({
        apiKey,
        model: input.llm.model,
        messages: input.messages,
        timeoutMs,
        maxOutputChars: 80_000,
        ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
      });
    }

    // Provider families without a dedicated builder client currently use OpenAI-compatible chat.
    return openAiChatCompletion({
      apiKey,
      model: input.llm.model,
      messages: input.messages,
      timeoutMs,
      maxOutputChars: 80_000,
      ...(runtime.apiBaseUrl ? { apiBaseUrl: runtime.apiBaseUrl } : {}),
    });
  }

  server.post("/v1/orgs/:orgId/toolsets/builder/sessions", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetBuilderCreateSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid builder session payload", parsed.error.flatten());
    }

    const orgSettings = normalizeOrgSettings(
      await store.getOrganizationSettings({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
      })
    );

    const llm = parsed.data.llm as ToolsetBuilderLlmConfig;
    const secretValue = await resolveToolsetBuilderSecretValue({
      llm,
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });

    const intent = parsed.data.intent?.trim() ?? "";
    const session = await store.createToolsetBuilderSession({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      llm: parsed.data.llm,
      latestIntent: intent.length > 0 ? intent : null,
    });

    const ranked = rankCatalogItems({ query: intent, items: toolsetCatalog, limit: 20 });
    const catalogPreview = ranked.map((it) => ({
      key: it.key,
      kind: it.kind,
      name: it.name,
      description: it.description ?? null,
      ...(it.kind === "mcp" ? { requiredEnv: it.requiredEnv ?? [] } : {}),
      ...(it.kind === "skill" ? { idHint: it.skillTemplate.idHint } : {}),
    }));

    let assistantMessage = "Select components, then tell me your environment and constraints (e.g. repo host, Slack workspace, DB access).";
    let suggestedKeys: string[] = [];

    if (intent.length > 0) {
      await store.appendToolsetBuilderTurn({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        sessionId: session.id,
        role: "USER",
        messageText: redactLikelySecrets(intent),
      });

      const system = [
        "You are Vespid Toolset Builder.",
        "You help generate a Toolset draft (MCP servers + Agent Skills bundles).",
        "MCP servers must be selected only by component key from the provided catalog; do not invent commands/URLs.",
        "Never include secret literals. MCP env/headers values must be ${ENV:VAR} placeholders only.",
        "Return JSON only.",
      ].join("\n");

      const user = JSON.stringify({
        intent,
        catalog: catalogPreview,
        outputFormat: {
          message: "string",
          suggestedComponentKeys: ["string"],
        },
      });

      const llmRes = await callBuilderLlm({
        llm,
        secretValue,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        orgSettings,
      });
      if (!llmRes.ok) {
        throw new AppError(503, { code: "LLM_UNAVAILABLE", message: llmRes.error });
      }

      const obj = parseJsonObject(llmRes.content);
      const parsedAssistant = z
        .object({
          message: z.string().min(1).max(20_000),
          suggestedComponentKeys: z.array(z.string().min(1).max(80)).max(50).optional(),
        })
        .safeParse(obj);
      if (!parsedAssistant.success) {
        throw toolsetBuilderInvalidModelOutput({ error: parsedAssistant.error.flatten() });
      }

      assistantMessage = parsedAssistant.data.message;
      suggestedKeys = normalizeSelectedComponentKeys(parsedAssistant.data.suggestedComponentKeys ?? []);
    }

    await store.appendToolsetBuilderTurn({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      role: "ASSISTANT",
      messageText: assistantMessage,
    });

    const updatedSession = await store.updateToolsetBuilderSessionSelection({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      selectedComponentKeys: suggestedKeys,
    });

    return {
      sessionId: session.id,
      status: updatedSession?.status ?? session.status,
      assistant: { message: assistantMessage, suggestedComponentKeys: suggestedKeys },
      components: ranked,
      selectedComponentKeys: suggestedKeys,
    };
  });

  server.post("/v1/orgs/:orgId/toolsets/builder/sessions/:sessionId/chat", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const session = await store.getToolsetBuilderSessionById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw toolsetBuilderSessionNotFound();
    }
    if (session.status === "FINALIZED") {
      throw toolsetBuilderSessionFinalized();
    }

    const parsed = toolsetBuilderChatSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid builder chat payload", parsed.error.flatten());
    }

    const orgSettings = normalizeOrgSettings(
      await store.getOrganizationSettings({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
      })
    );

    const selected = normalizeSelectedComponentKeys(parsed.data.selectedComponentKeys);
    const message = parsed.data.message.trim();
    await store.appendToolsetBuilderTurn({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      role: "USER",
      messageText: redactLikelySecrets(message),
    });

    const llm = session.llm as ToolsetBuilderLlmConfig;
    const secretValue = await resolveToolsetBuilderSecretValue({
      llm,
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });

    const ranked = rankCatalogItems({ query: message, items: toolsetCatalog, limit: 20 });
    const catalogPreview = ranked.map((it) => ({
      key: it.key,
      kind: it.kind,
      name: it.name,
      description: it.description ?? null,
      ...(it.kind === "mcp" ? { requiredEnv: it.requiredEnv ?? [] } : {}),
      ...(it.kind === "skill" ? { idHint: it.skillTemplate.idHint } : {}),
    }));

    const turns = await store.listToolsetBuilderTurns({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      limit: 24,
    });

    const system = [
      "You are Vespid Toolset Builder.",
      "You help the user pick catalog components and refine constraints.",
      "MCP servers must be selected only by component key from the catalog; do not invent commands/URLs.",
      "Never include secret literals. Use ${ENV:VAR} placeholders only.",
      "Return JSON only.",
    ].join("\n");

    const user = JSON.stringify({
      latestIntent: session.latestIntent ?? null,
      selectedComponentKeys: selected,
      catalog: catalogPreview,
      turns: turns.map((t) => ({ role: t.role, message: t.messageText })).slice(-12),
      newMessage: message,
      outputFormat: {
        message: "string",
        suggestedComponentKeys: ["string"],
      },
    });

    const llmRes = await callBuilderLlm({
      llm,
      secretValue,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      orgSettings,
    });
    if (!llmRes.ok) {
      throw new AppError(503, { code: "LLM_UNAVAILABLE", message: llmRes.error });
    }

    const obj = parseJsonObject(llmRes.content);
    const parsedAssistant = z
      .object({
        message: z.string().min(1).max(20_000),
        suggestedComponentKeys: z.array(z.string().min(1).max(80)).max(50).optional(),
      })
      .safeParse(obj);
    if (!parsedAssistant.success) {
      throw toolsetBuilderInvalidModelOutput({ error: parsedAssistant.error.flatten() });
    }

    const assistantMessage = parsedAssistant.data.message;
    const suggestedKeys = normalizeSelectedComponentKeys(parsedAssistant.data.suggestedComponentKeys ?? []);
    const mergedSelected = Array.from(new Set([...selected, ...suggestedKeys]));

    await store.appendToolsetBuilderTurn({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      role: "ASSISTANT",
      messageText: assistantMessage,
    });

    await store.updateToolsetBuilderSessionSelection({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      latestIntent: message,
      selectedComponentKeys: mergedSelected,
    });

    return {
      sessionId: session.id,
      status: "ACTIVE",
      assistant: { message: assistantMessage, suggestedComponentKeys: suggestedKeys },
      components: ranked,
      selectedComponentKeys: mergedSelected,
    };
  });

  server.post("/v1/orgs/:orgId/toolsets/builder/sessions/:sessionId/finalize", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; sessionId?: string };
    if (!params.orgId || !params.sessionId) {
      throw badRequest("Missing orgId or sessionId");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const session = await store.getToolsetBuilderSessionById({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: params.sessionId,
    });
    if (!session) {
      throw toolsetBuilderSessionNotFound();
    }
    if (session.status === "FINALIZED") {
      throw toolsetBuilderSessionFinalized();
    }

    const parsed = toolsetBuilderFinalizeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid finalize payload", parsed.error.flatten());
    }

    const orgSettings = normalizeOrgSettings(
      await store.getOrganizationSettings({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
      })
    );

    const selectedComponentKeys = normalizeSelectedComponentKeys(parsed.data.selectedComponentKeys);
    const selectedComponents = selectedComponentKeys.map((k) => toolsetCatalogByKey.get(k)!).filter(Boolean);
    const selectedMcp = selectedComponents.filter((c) => c.kind === "mcp") as Array<Extract<ToolsetCatalogItem, { kind: "mcp" }>>;
    const selectedSkillTemplates = selectedComponents.filter((c) => c.kind === "skill") as Array<Extract<ToolsetCatalogItem, { kind: "skill" }>>;

    const llm = session.llm as ToolsetBuilderLlmConfig;
    const secretValue = await resolveToolsetBuilderSecretValue({
      llm,
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
    });

    const turns = await store.listToolsetBuilderTurns({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      limit: 24,
    });

    const system = [
      "You are Vespid Toolset Builder.",
      "Generate Agent Skills bundles only. MCP servers are selected from catalog and will be injected by the server.",
      "Never include secret literals. MCP env/headers values must use ${ENV:VAR} placeholders only.",
      "Return JSON only.",
    ].join("\n");

    const user = JSON.stringify({
      latestIntent: session.latestIntent ?? null,
      selectedMcpServers: selectedMcp.map((m) => ({ name: m.mcp.name, transport: m.mcp.transport, requiredEnv: m.requiredEnv ?? [] })),
      selectedSkillTemplates: selectedSkillTemplates.map((s) => ({
        idHint: s.skillTemplate.idHint,
        name: s.name,
        description: s.description ?? null,
        optionalDirs: s.skillTemplate.optionalDirs ?? null,
      })),
      turns: turns.map((t) => ({ role: t.role, message: t.messageText })).slice(-12),
      outputFormat: {
        name: "string",
        description: "string",
        agentSkills: "AgentSkillBundle[] (format=agentskills-v1; must include files with SKILL.md)",
      },
    });

    const llmRes = await callBuilderLlm({
      llm,
      secretValue,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      orgSettings,
    });
    if (!llmRes.ok) {
      throw new AppError(503, { code: "LLM_UNAVAILABLE", message: llmRes.error });
    }

    const obj = parseJsonObject(llmRes.content);
    const parsedDraft = z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        agentSkills: z.array(agentSkillBundleSchema).default([]),
      })
      .safeParse(obj);
    if (!parsedDraft.success) {
      throw toolsetBuilderInvalidModelOutput({ error: parsedDraft.error.flatten() });
    }

    const draftName = parsed.data.name?.trim() || parsedDraft.data.name.trim();
    const draftDescription = parsed.data.description?.trim() ?? parsedDraft.data.description?.trim() ?? "";
    const visibility = parsed.data.visibility ?? "private";

    const mcpServers = selectedMcp.map((m) => m.mcp);
    const names = new Set<string>();
    for (const s of mcpServers) {
      if (s.name === "vespid-tools") {
        throw badRequest("MCP server name is reserved: vespid-tools");
      }
      if (names.has(s.name)) {
        throw badRequest("Duplicate MCP server name", { name: s.name });
      }
      names.add(s.name);
    }

    const draft: ToolsetDraft = {
      name: draftName,
      description: draftDescription,
      visibility,
      mcpServers,
      // Drop optional undefined fields at the boundary; placeholder policy and bundle validation are enforced separately.
      agentSkills: parsedDraft.data.agentSkills as any,
    };

    const mcpCheck = validateMcpPlaceholderPolicy(draft.mcpServers);
    if (!mcpCheck.ok) {
      throw invalidMcpPlaceholder(mcpCheck);
    }
    const skillCheck = validateAgentSkillBundles(draft.agentSkills);
    if (!skillCheck.ok) {
      throw invalidSkillBundle(skillCheck);
    }

    const finalized = await store.finalizeToolsetBuilderSession({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      sessionId: session.id,
      selectedComponentKeys,
      finalDraft: draft,
    });
    if (!finalized) {
      throw toolsetBuilderSessionNotFound();
    }

    const warnings: string[] = [];
    const requiredEnv = new Set<string>();
    for (const m of selectedMcp) {
      for (const e of m.requiredEnv ?? []) requiredEnv.add(e);
    }
    if (requiredEnv.size > 0) {
      warnings.push(`This toolset requires environment variables: ${Array.from(requiredEnv).sort().join(", ")}`);
    }

    return { draft, ...(warnings.length > 0 ? { warnings } : {}) };
  });

  server.get("/v1/toolset-gallery", async (request) => {
    const auth = requireAuth(request);
    const rows = await store.listPublicToolsetGallery({ actorUserId: auth.userId });
    const items = rows
      .filter((t) => t.visibility === "public" && typeof t.publicSlug === "string" && t.publicSlug.length > 0)
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        publicSlug: t.publicSlug!,
        publishedAt: t.publishedAt ?? t.updatedAt,
        mcpServerCount: Array.isArray(t.mcpServers) ? t.mcpServers.length : 0,
        agentSkillCount: Array.isArray(t.agentSkills) ? t.agentSkills.length : 0,
      }));
    return { items };
  });

  server.get("/v1/toolset-gallery/:publicSlug", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { publicSlug?: string };
    if (!params.publicSlug) {
      throw badRequest("Missing publicSlug");
    }
    const toolset = await store.getPublicToolsetBySlug({ actorUserId: auth.userId, publicSlug: params.publicSlug });
    if (!toolset) {
      throw toolsetNotFound();
    }
    return { toolset };
  });

  server.post("/v1/orgs/:orgId/toolset-gallery/:publicSlug/adopt", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; publicSlug?: string };
    if (!params.orgId || !params.publicSlug) {
      throw badRequest("Missing orgId or publicSlug");
    }
    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage toolsets");
    }

    const parsed = toolsetAdoptSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid adopt payload", parsed.error.flatten());
    }

    const adopted = await store.adoptPublicToolset({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      publicSlug: params.publicSlug,
      nameOverride: parsed.data.name ?? null,
      descriptionOverride: parsed.data.description ?? null,
    });
    if (!adopted) {
      throw toolsetNotFound("Public toolset not found");
    }

    return reply.status(201).send({ toolset: adopted });
  });

  async function pairExecutorHandler(request: any, reply: any) {
    const parsed = agentPairSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid agent pairing payload", parsed.error.flatten());
    }

    const orgId = parsePairingTokenOrganizationId(parsed.data.pairingToken);
    if (!orgId) {
      throw pairingTokenInvalid("Pairing token is malformed");
    }

    const tokenHash = sha256Hex(parsed.data.pairingToken);
    const existing = await store.getExecutorPairingTokenByHash({ organizationId: orgId, tokenHash });
    if (!existing) {
      throw pairingTokenInvalid();
    }
    if (existing.usedAt) {
      throw pairingTokenInvalid("Pairing token has already been used");
    }
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      throw pairingTokenExpired();
    }

    const consumed = await store.consumeExecutorPairingToken({ organizationId: orgId, tokenHash });
    if (!consumed) {
      throw pairingTokenInvalid();
    }

    const executorToken = `${orgId}.${crypto.randomBytes(32).toString("base64url")}`;
    const executor = await store.createOrganizationExecutor({
      organizationId: orgId,
      name: parsed.data.name,
      tokenHash: sha256Hex(executorToken),
      createdByUserId: existing.createdByUserId,
      capabilities: parsed.data.capabilities ?? null,
    });

    const gatewayWsUrl = process.env.GATEWAY_WS_URL ?? "ws://localhost:3002/ws/executor";

    return reply.status(201).send({
      executorId: executor.id,
      executorToken,
      organizationId: orgId,
      gatewayWsUrl,
    });
  }

  server.post("/v1/agents/pair", pairExecutorHandler);
  server.post("/v1/executors/pair", pairExecutorHandler);

  server.post("/v1/orgs/:orgId/workflows", async (request, reply) => {
    const auth = requireAuth(request);
    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to create workflows");
    }

    const parsed = createWorkflowSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid workflow payload", parsed.error.flatten());
    }

    if (parsed.data.dsl.version === "v3") {
      const constraints = validateV3GraphConstraints(parsed.data.dsl);
      if (!constraints.ok) {
        throw new AppError(400, {
          code: constraints.code,
          message: constraints.message,
          details: constraints.issues ? { issues: constraints.issues } : undefined,
        });
      }
    }

    const workflow = await store.createWorkflow({
      organizationId: orgContext.organizationId,
      name: parsed.data.name,
      dsl: parsed.data.dsl,
      createdByUserId: auth.userId,
    });

    return reply.status(201).send({ workflow });
  });

  server.get("/v1/orgs/:orgId/workflows", async (request) => {
    const auth = requireAuth(request);
    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      throw badRequest("Missing orgId");
    }

    const queryParsed = listWorkflowsQuerySchema.safeParse(request.query ?? {});
    if (!queryParsed.success) {
      throw badRequest("Invalid query", queryParsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: orgId });

    const decodedCursor = queryParsed.data.cursor ? decodeCursor(queryParsed.data.cursor) : null;
    const cursor =
      decodedCursor && typeof decodedCursor === "object" && "createdAt" in decodedCursor && "id" in decodedCursor
        ? (decodedCursor as { createdAt: string; id: string })
        : null;

    const result = await store.listWorkflows({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      limit: queryParsed.data.limit ?? 50,
      cursor,
    });

    const nextCursor = result.nextCursor ? encodeCursor(result.nextCursor) : null;
    return { workflows: result.workflows, nextCursor };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });

    if (!workflow) {
      throw notFound("Workflow not found");
    }

    return { workflow };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/revisions", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const queryParsed = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .safeParse(request.query ?? {});
    if (!queryParsed.success) {
      throw badRequest("Invalid query", queryParsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflows = await store.listWorkflowRevisions({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
      limit: queryParsed.data.limit ?? 50,
    });

    return workflows;
  });

  server.put("/v1/orgs/:orgId/workflows/:workflowId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to update workflows");
    }

    const parsed = updateWorkflowDraftSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid workflow payload", parsed.error.flatten());
    }

    const existing = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!existing) {
      throw notFound("Workflow not found");
    }
    if (existing.status !== "draft") {
      throw conflict("Published workflows cannot be edited");
    }

    if (parsed.data.dsl && parsed.data.dsl.version === "v3") {
      const constraints = validateV3GraphConstraints(parsed.data.dsl);
      if (!constraints.ok) {
        throw new AppError(400, {
          code: constraints.code,
          message: constraints.message,
          details: constraints.issues ? { issues: constraints.issues } : undefined,
        });
      }
    }

    const updated = await store.updateWorkflowDraft({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.dsl !== undefined ? { dsl: parsed.data.dsl } : {}),
      ...(parsed.data.editorState !== undefined ? { editorState: parsed.data.editorState } : {}),
    });
    if (!updated) {
      throw conflict("Workflow draft update failed");
    }

    return { workflow: updated };
  });

  server.post("/v1/orgs/:orgId/workflows/:workflowId/publish", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to publish workflows");
    }

    const workflow = await store.publishWorkflow({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }

    return { workflow };
  });

  // Creates a new draft revision cloned from an existing workflow (typically a published revision).
  server.post("/v1/orgs/:orgId/workflows/:workflowId/drafts", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to create workflow drafts");
    }

    const existing = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!existing) {
      throw notFound("Workflow not found");
    }
    if (existing.status !== "published") {
      throw conflict("Only published workflows can be cloned into a new draft");
    }

    const draft = await store.createWorkflowDraftFromWorkflow({
      organizationId: orgContext.organizationId,
      sourceWorkflowId: existing.id,
      actorUserId: auth.userId,
    });
    if (!draft) {
      throw conflict("Failed to create workflow draft");
    }

    return reply.status(201).send({ workflow: draft });
  });

  server.post("/v1/orgs/:orgId/workflows/:workflowId/runs", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const parsed = createWorkflowRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid workflow run payload", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }
    if (workflow.status !== "published") {
      throw conflict("Workflow must be published before runs can be created");
    }

    const run = await store.createWorkflowRun({
      organizationId: orgContext.organizationId,
      workflowId: workflow.id,
      triggerType: "manual",
      requestedByUserId: auth.userId,
      input: parsed.data.input,
    });

    try {
      await queueProducer.enqueueWorkflowRun({
        payload: {
          runId: run.id,
          organizationId: run.organizationId,
          workflowId: run.workflowId,
          requestedByUserId: run.requestedByUserId,
        },
        maxAttempts: run.maxAttempts,
      });
      server.log.info(
        {
          event: "workflow_run_enqueued",
          userId: auth.userId,
          orgId: orgContext.organizationId,
          workflowId: workflow.id,
          runId: run.id,
          requestId: request.id,
          path: request.url,
          method: request.method,
        },
        "workflow run enqueued"
      );
    } catch (error) {
      await store.deleteQueuedWorkflowRun({
        organizationId: orgContext.organizationId,
        workflowId: workflow.id,
        runId: run.id,
        actorUserId: auth.userId,
      });
      server.log.error(
        {
          event: "queue_unavailable",
          userId: auth.userId,
          orgId: orgContext.organizationId,
          workflowId: workflow.id,
          runId: run.id,
          requestId: request.id,
          path: request.url,
          method: request.method,
          error: error instanceof Error ? error.message : String(error),
        },
        "workflow queue unavailable"
      );
      throw queueUnavailable();
    }

    return reply.status(201).send({ run });
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs/:runId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string; runId?: string };
    if (!params.orgId || !params.workflowId || !params.runId) {
      throw badRequest("Missing orgId, workflowId, or runId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const run = await store.getWorkflowRunById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
    });
    if (!run) {
      throw notFound("Workflow run not found");
    }

    return { run };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const parsed = listWorkflowRunsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list runs query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }

    const cursorPayload = parsed.data.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(parsed.data.cursor)
      : null;

    const result = await store.listWorkflowRuns({
      organizationId: orgContext.organizationId,
      workflowId: workflow.id,
      actorUserId: auth.userId,
      limit: parsed.data.limit ?? 50,
      cursor: cursorPayload,
    });

    return {
      runs: result.runs,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs/:runId/events", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string; runId?: string };
    if (!params.orgId || !params.workflowId || !params.runId) {
      throw badRequest("Missing orgId, workflowId, or runId");
    }

    const parsed = listWorkflowRunEventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list events query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const run = await store.getWorkflowRunById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
    });
    if (!run) {
      throw notFound("Workflow run not found");
    }

    const cursorPayload = parsed.data.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(parsed.data.cursor)
      : null;

    const result = await store.listWorkflowRunEvents({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
      limit: parsed.data.limit ?? 200,
      cursor: cursorPayload,
    });

    return {
      events: result.events,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    };
  });

  server.get("/v1/admin/platform/settings", async (request) => {
    await requireSystemAdmin(request);
    const settings = await store.listPlatformSettings();
    return { settings };
  });

  server.put("/v1/admin/platform/settings", async (request) => {
    const auth = await requireSystemAdmin(request);
    const parsed = adminPlatformSettingUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid platform setting payload", parsed.error.flatten());
    }
    const setting = await store.upsertPlatformSetting({
      key: parsed.data.key,
      value: parsed.data.value,
      updatedByUserId: auth.userId,
    });
    await store.appendPlatformAuditLog({
      actorUserId: auth.userId,
      action: "platform_settings.updated",
      targetType: "platform_setting",
      targetId: setting.key,
      metadata: { key: setting.key },
    });
    return { setting };
  });

  server.get("/v1/admin/system-admins", async (request) => {
    await requireSystemAdmin(request);
    const rows = await store.listPlatformUserRoles({ roleKey: "system_admin" });
    const items = await Promise.all(
      rows.map(async (row) => {
        const user = await store.getUserById(row.userId);
        return {
          ...row,
          user: user ? toPublicUser(user) : null,
        };
      })
    );
    return { systemAdmins: items };
  });

  server.post("/v1/admin/system-admins", async (request, reply) => {
    const auth = await requireSystemAdmin(request);
    const parsed = adminSystemAdminMutationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid system admin payload", parsed.error.flatten());
    }

    let userId = parsed.data.userId ?? null;
    if (!userId && parsed.data.email) {
      const user = await store.getUserByEmail(parsed.data.email.toLowerCase());
      if (!user) {
        throw notFound("User not found");
      }
      userId = user.id;
    }
    if (!userId) {
      throw badRequest("Missing userId");
    }

    const created = await store.createPlatformUserRole({
      userId,
      roleKey: "system_admin",
      grantedByUserId: auth.userId,
    });
    await store.appendPlatformAuditLog({
      actorUserId: auth.userId,
      action: "system_admin.granted",
      targetType: "user",
      targetId: userId,
      metadata: { roleKey: "system_admin" },
    });
    return reply.status(201).send({ role: created });
  });

  server.delete("/v1/admin/system-admins", async (request) => {
    const auth = await requireSystemAdmin(request);
    const parsed = adminSystemAdminMutationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid system admin payload", parsed.error.flatten());
    }

    let userId = parsed.data.userId ?? null;
    if (!userId && parsed.data.email) {
      const user = await store.getUserByEmail(parsed.data.email.toLowerCase());
      if (!user) {
        throw notFound("User not found");
      }
      userId = user.id;
    }
    if (!userId) {
      throw badRequest("Missing userId");
    }

    if (userId === auth.userId) {
      throw forbidden("Cannot remove your own system administrator role");
    }

    const deleted = await store.deletePlatformUserRole({ userId, roleKey: "system_admin" });
    await store.appendPlatformAuditLog({
      actorUserId: auth.userId,
      action: "system_admin.revoked",
      targetType: "user",
      targetId: userId,
      metadata: { deleted },
    });
    return { ok: deleted };
  });

  server.get("/v1/admin/risk/policies", async (request) => {
    await requireSystemAdmin(request);
    const setting = await store.getPlatformSetting({ key: "risk.policies" });
    return { policy: setting?.value ?? {} };
  });

  server.put("/v1/admin/risk/policies", async (request) => {
    const auth = await requireSystemAdmin(request);
    const nextPolicy = request.body ?? {};
    const setting = await store.upsertPlatformSetting({
      key: "risk.policies",
      value: nextPolicy,
      updatedByUserId: auth.userId,
    });
    await store.appendPlatformAuditLog({
      actorUserId: auth.userId,
      action: "risk.policies.updated",
      targetType: "platform_setting",
      targetId: "risk.policies",
      metadata: {},
    });
    return { policy: setting.value };
  });

  server.get("/v1/admin/risk/incidents", async (request) => {
    await requireSystemAdmin(request);
    const setting = await store.getPlatformSetting({ key: "risk.incidents" });
    return { incidents: setting?.value ?? { items: [] } };
  });

  server.get("/v1/admin/observability/health", async (request) => {
    await requireSystemAdmin(request);
    return {
      services: [
        { name: "api", status: "ok" },
        { name: "gateway", status: GATEWAY_HTTP_URL ? "configured" : "unknown" },
        { name: "redis", status: process.env.REDIS_URL ? "configured" : "in-memory" },
        { name: "queue", status: process.env.REDIS_URL ? "configured" : "in-memory" },
      ],
    };
  });

  server.get("/v1/admin/observability/metrics", async (request) => {
    await requireSystemAdmin(request);
    const setting = await store.getPlatformSetting({ key: "observability.metrics" });
    return { metrics: setting?.value ?? { items: [] } };
  });

  server.get("/v1/admin/observability/logs", async (request) => {
    await requireSystemAdmin(request);
    const setting = await store.getPlatformSetting({ key: "observability.logs" });
    return { logs: setting?.value ?? { items: [] } };
  });

  server.get("/v1/admin/tickets", async (request) => {
    await requireSystemAdmin(request);
    const parsed = adminSupportTicketsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid tickets query", parsed.error.flatten());
    }
    const tickets = await store.listSupportTickets({
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
    });
    return { tickets };
  });

  server.post("/v1/admin/tickets", async (request, reply) => {
    const auth = await requireSystemAdmin(request);
    const parsed = adminSupportTicketCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid ticket payload", parsed.error.flatten());
    }
    const ticket = await store.createSupportTicket({
      subject: parsed.data.subject,
      content: parsed.data.content,
      ...(parsed.data.requesterUserId !== undefined ? { requesterUserId: parsed.data.requesterUserId } : {}),
      ...(parsed.data.organizationId !== undefined ? { organizationId: parsed.data.organizationId } : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.assigneeUserId !== undefined ? { assigneeUserId: parsed.data.assigneeUserId } : {}),
    });
    await store.appendSupportTicketEvent({
      ticketId: ticket.id,
      actorUserId: auth.userId,
      eventType: "created",
      payload: { source: "admin" },
    });
    await store.appendPlatformAuditLog({
      actorUserId: auth.userId,
      action: "ticket.created",
      targetType: "support_ticket",
      targetId: ticket.id,
      metadata: {},
    });
    return reply.status(201).send({ ticket });
  });

  server.get("/v1/admin/tickets/:ticketId", async (request) => {
    await requireSystemAdmin(request);
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params ?? {});
    if (!params.success) {
      throw badRequest("Invalid ticket id", params.error.flatten());
    }
    const ticket = await store.getSupportTicketById({ ticketId: params.data.ticketId });
    if (!ticket) {
      throw notFound("Ticket not found");
    }
    const events = await store.listSupportTicketEvents({ ticketId: ticket.id, limit: 200 });
    return { ticket, events };
  });

  server.patch("/v1/admin/tickets/:ticketId", async (request) => {
    const auth = await requireSystemAdmin(request);
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params ?? {});
    if (!params.success) {
      throw badRequest("Invalid ticket id", params.error.flatten());
    }
    const parsed = adminSupportTicketPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid ticket patch payload", parsed.error.flatten());
    }
    const ticket = await store.patchSupportTicket({
      ticketId: params.data.ticketId,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.assigneeUserId !== undefined ? { assigneeUserId: parsed.data.assigneeUserId } : {}),
    });
    if (!ticket) {
      throw notFound("Ticket not found");
    }
    await store.appendSupportTicketEvent({
      ticketId: ticket.id,
      actorUserId: auth.userId,
      eventType: "updated",
      payload: parsed.data,
    });
    return { ticket };
  });

  server.post("/v1/admin/tickets/:ticketId/events", async (request, reply) => {
    const auth = await requireSystemAdmin(request);
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params ?? {});
    if (!params.success) {
      throw badRequest("Invalid ticket id", params.error.flatten());
    }
    const parsed = adminSupportTicketEventCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid ticket event payload", parsed.error.flatten());
    }
    const ticket = await store.getSupportTicketById({ ticketId: params.data.ticketId });
    if (!ticket) {
      throw notFound("Ticket not found");
    }
    const event = await store.appendSupportTicketEvent({
      ticketId: ticket.id,
      actorUserId: auth.userId,
      eventType: parsed.data.eventType,
      payload: parsed.data.payload ?? {},
    });
    return reply.status(201).send({ event });
  });

  server.post("/v1/invitations/:token/accept", async (request) => {
    const auth = requireAuth(request);
    const token = (request.params as { token?: string }).token;
    if (!token) {
      throw badRequest("Missing invitation token");
    }

    const organizationId = parseInvitationTokenOrganizationId(token);
    if (!organizationId) {
      throw badRequest("Invalid invitation token");
    }

    const headerOrgId = request.headers["x-org-id"];
    if (headerOrgId) {
      const parsedHeaderOrgId = parseOrgHeaderValue(headerOrgId);
      if (parsedHeaderOrgId !== organizationId) {
        throw orgContextInvalid("X-Org-Id does not match invitation organization");
      }
    }

    const capabilities = await resolveUserCapabilities({ userId: auth.userId, email: auth.email });
    if (capabilities.orgPolicy.maxOrganizations !== null) {
      const orgs = await store.listOrganizationsForUser({ actorUserId: auth.userId });
      const alreadyMember = orgs.some((row) => row.organization.id === organizationId);
      if (!alreadyMember && orgs.length >= capabilities.orgPolicy.maxOrganizations) {
        throw orgPlanUpgradeRequired("Joining this organization requires a higher plan.");
      }
    }

    try {
      const result = await store.acceptInvitation({
        organizationId,
        token,
        userId: auth.userId,
        email: auth.email,
      });
      return { result };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      const mapped = invitationErrorToAppError(error);
      server.log.warn(
        {
          event: "invitation_accept_failed",
          tokenPrefix: token.slice(0, 8),
          reasonCode: mapped.payload.code,
          userId: auth.userId,
          requestId: request.id,
          path: request.url,
        },
        "invitation accept failed"
      );
      throw mapped;
    }
  });

  server.get("/healthz", async () => ({ ok: true }));

  return server;
}
