import snapshot from "./model-catalog.snapshot.json" with { type: "json" };

export const LLM_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "openai-codex",
  "opencode",
  "google",
  "google-vertex",
  "google-antigravity",
  "google-gemini-cli",
  "zai",
  "openrouter",
  "xai",
  "groq",
  "cerebras",
  "mistral",
  "github-copilot",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "qwen-portal",
  "minimax",
  "minimax-portal",
  "moonshot",
  "kimi-coding",
  "synthetic",
  "together",
  "huggingface",
  "venice",
  "qianfan",
  "nvidia",
  "ollama",
  "vllm",
  "litellm",
  "amazon-bedrock",
  "xiaomi",
  "chutes",
  "copilot-proxy",
  "custom",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];
export type LlmProviderAlias = "gemini" | "vertex";
export type LlmProviderApiKind =
  | "openai-compatible"
  | "anthropic-compatible"
  | "google"
  | "vertex"
  | "bedrock"
  | "copilot"
  | "custom";
export type LlmProviderAuthMode = "api-key" | "oauth" | "none";
export type LlmOAuthFlowType = "pkce" | "device" | "none";
export type LlmUsageContext = "session" | "workflowAgentRun" | "toolsetBuilder";
export type LlmCatalogTag = "recommended" | "fast" | "coding" | "general" | "reasoning" | "vision" | "popular" | "local";

export type LlmProviderMeta = {
  id: LlmProviderId;
  displayName: string;
  apiKind: LlmProviderApiKind;
  authMode: LlmProviderAuthMode;
  oauthFlow: LlmOAuthFlowType;
  defaultModelId: string;
  defaultConnectorId: string | null;
  aliases?: LlmProviderAlias[];
  contexts: {
    session: boolean;
    workflowAgentRun: boolean;
    toolsetBuilder: boolean;
  };
  tags: LlmCatalogTag[];
};

export type LlmModelCatalogEntry = {
  providerId: LlmProviderId;
  modelId: string;
  name: string;
  tags?: LlmCatalogTag[];
};

export type LlmModelCatalogSnapshot = {
  version: number;
  source: {
    kind: string;
    sourceRepo: string;
    sourceCommit: string;
    generatedAt: string;
  };
  models: LlmModelCatalogEntry[];
};

const PROVIDERS: Record<LlmProviderId, LlmProviderMeta> = {
  openai: {
    id: "openai",
    displayName: "OpenAI",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "gpt-4.1-mini",
    defaultConnectorId: "llm.openai",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular", "recommended", "coding"],
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "claude-3-5-sonnet-latest",
    defaultConnectorId: "llm.anthropic",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular", "recommended", "coding"],
  },
  "openai-codex": {
    id: "openai-codex",
    displayName: "OpenAI Codex",
    apiKind: "openai-compatible",
    authMode: "oauth",
    oauthFlow: "pkce",
    defaultModelId: "gpt-5.3-codex",
    defaultConnectorId: "llm.openai-codex.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "claude-opus-4-6",
    defaultConnectorId: "llm.opencode",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  google: {
    id: "google",
    displayName: "Google Gemini",
    apiKind: "google",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "gemini-2.0-flash",
    defaultConnectorId: "llm.google",
    aliases: ["gemini"],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular", "fast"],
  },
  "google-vertex": {
    id: "google-vertex",
    displayName: "Google Vertex",
    apiKind: "vertex",
    authMode: "oauth",
    oauthFlow: "pkce",
    defaultModelId: "gemini-2.0-flash-001",
    defaultConnectorId: "llm.google-vertex.oauth",
    aliases: ["vertex"],
    contexts: { session: false, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  "google-antigravity": {
    id: "google-antigravity",
    displayName: "Google Antigravity",
    apiKind: "google",
    authMode: "oauth",
    oauthFlow: "pkce",
    defaultModelId: "gemini-3-pro-high",
    defaultConnectorId: "llm.google-antigravity.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  "google-gemini-cli": {
    id: "google-gemini-cli",
    displayName: "Google Gemini CLI",
    apiKind: "google",
    authMode: "oauth",
    oauthFlow: "pkce",
    defaultModelId: "gemini-2.5-pro",
    defaultConnectorId: "llm.google-gemini-cli.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  zai: {
    id: "zai",
    displayName: "Z.AI",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "glm-4.7",
    defaultConnectorId: "llm.zai",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "anthropic/claude-sonnet-4-5",
    defaultConnectorId: "llm.openrouter",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  xai: {
    id: "xai",
    displayName: "xAI",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "grok-4",
    defaultConnectorId: "llm.xai",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "llama-3.3-70b-versatile",
    defaultConnectorId: "llm.groq",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["fast"],
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "zai-glm-4.7",
    defaultConnectorId: "llm.cerebras",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "mistral-large-latest",
    defaultConnectorId: "llm.mistral",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  "github-copilot": {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    apiKind: "copilot",
    authMode: "oauth",
    oauthFlow: "device",
    defaultModelId: "gpt-4o",
    defaultConnectorId: "llm.github-copilot.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  "vercel-ai-gateway": {
    id: "vercel-ai-gateway",
    displayName: "Vercel AI Gateway",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "anthropic/claude-opus-4.6",
    defaultConnectorId: "llm.vercel-ai-gateway",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  "cloudflare-ai-gateway": {
    id: "cloudflare-ai-gateway",
    displayName: "Cloudflare AI Gateway",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "cf/meta/llama-3.1-70b-instruct",
    defaultConnectorId: "llm.cloudflare-ai-gateway",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  "qwen-portal": {
    id: "qwen-portal",
    displayName: "Qwen Portal",
    apiKind: "openai-compatible",
    authMode: "oauth",
    oauthFlow: "device",
    defaultModelId: "coder-model",
    defaultConnectorId: "llm.qwen-portal.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "MiniMax-M2.5",
    defaultConnectorId: "llm.minimax",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  "minimax-portal": {
    id: "minimax-portal",
    displayName: "MiniMax Portal",
    apiKind: "anthropic-compatible",
    authMode: "oauth",
    oauthFlow: "pkce",
    defaultModelId: "MiniMax-M2.1",
    defaultConnectorId: "llm.minimax-portal.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["recommended"],
  },
  moonshot: {
    id: "moonshot",
    displayName: "Moonshot",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "kimi-k2.5",
    defaultConnectorId: "llm.moonshot",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  "kimi-coding": {
    id: "kimi-coding",
    displayName: "Kimi Coding",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "k2p5",
    defaultConnectorId: "llm.kimi-coding",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  synthetic: {
    id: "synthetic",
    displayName: "Synthetic",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "hf:MiniMaxAI/MiniMax-M2.1",
    defaultConnectorId: "llm.synthetic",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["general"],
  },
  together: {
    id: "together",
    displayName: "Together",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "deepseek-ai/DeepSeek-V3",
    defaultConnectorId: "llm.together",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  huggingface: {
    id: "huggingface",
    displayName: "Hugging Face",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "deepseek-ai/DeepSeek-R1",
    defaultConnectorId: "llm.huggingface",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  venice: {
    id: "venice",
    displayName: "Venice",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "venice-uncensored",
    defaultConnectorId: "llm.venice",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["general"],
  },
  qianfan: {
    id: "qianfan",
    displayName: "Qianfan",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "deepseek-v3.2",
    defaultConnectorId: "llm.qianfan",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  nvidia: {
    id: "nvidia",
    displayName: "NVIDIA",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "nvidia/llama-3.1-nemotron-70b-instruct",
    defaultConnectorId: "llm.nvidia",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["fast"],
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama",
    apiKind: "openai-compatible",
    authMode: "none",
    oauthFlow: "none",
    defaultModelId: "llama3.3",
    defaultConnectorId: null,
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: false },
    tags: ["local", "popular"],
  },
  vllm: {
    id: "vllm",
    displayName: "vLLM",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
    defaultConnectorId: "llm.vllm",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: false },
    tags: ["local", "coding"],
  },
  litellm: {
    id: "litellm",
    displayName: "LiteLLM",
    apiKind: "openai-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "gpt-4.1-mini",
    defaultConnectorId: "llm.litellm",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["popular"],
  },
  "amazon-bedrock": {
    id: "amazon-bedrock",
    displayName: "Amazon Bedrock",
    apiKind: "bedrock",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    defaultConnectorId: "llm.amazon-bedrock",
    aliases: [],
    contexts: { session: false, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["reasoning"],
  },
  xiaomi: {
    id: "xiaomi",
    displayName: "Xiaomi",
    apiKind: "anthropic-compatible",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "mimo-v2-flash",
    defaultConnectorId: "llm.xiaomi",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["fast"],
  },
  chutes: {
    id: "chutes",
    displayName: "Chutes",
    apiKind: "openai-compatible",
    authMode: "oauth",
    oauthFlow: "device",
    defaultModelId: "chutes-fast",
    defaultConnectorId: "llm.chutes.oauth",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["fast"],
  },
  "copilot-proxy": {
    id: "copilot-proxy",
    displayName: "Copilot Proxy",
    apiKind: "copilot",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "gpt-4o",
    defaultConnectorId: "llm.copilot-proxy",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["coding"],
  },
  custom: {
    id: "custom",
    displayName: "Custom",
    apiKind: "custom",
    authMode: "api-key",
    oauthFlow: "none",
    defaultModelId: "custom-model",
    defaultConnectorId: "llm.custom",
    aliases: [],
    contexts: { session: true, workflowAgentRun: true, toolsetBuilder: true },
    tags: ["general"],
  },
};

const PROVIDER_ALIASES: Record<LlmProviderAlias, LlmProviderId> = {
  gemini: "google",
  vertex: "google-vertex",
};

const CONNECTOR_ALIASES: Record<string, string> = {
  "llm.gemini": "llm.google",
  "llm.vertex.oauth": "llm.google-vertex.oauth",
};

export const LLM_PROVIDERS: LlmProviderMeta[] = LLM_PROVIDER_IDS.map((id) => PROVIDERS[id]);
export const LLM_PROVIDER_ID_SET = new Set<LlmProviderId>(LLM_PROVIDER_IDS);

export const LLM_OAUTH_PROVIDER_IDS = new Set<LlmProviderId>(
  LLM_PROVIDER_IDS.filter((id) => PROVIDERS[id].authMode === "oauth")
);

const MODEL_SNAPSHOT = snapshot as LlmModelCatalogSnapshot;

export function isLlmProviderId(input: string): input is LlmProviderId {
  return LLM_PROVIDER_ID_SET.has(input as LlmProviderId);
}

export function normalizeLlmProviderId(input: string | null | undefined): LlmProviderId | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed in PROVIDER_ALIASES) return PROVIDER_ALIASES[trimmed as LlmProviderAlias];
  return isLlmProviderId(trimmed) ? trimmed : null;
}

export function getLlmProviderMeta(providerId: string | null | undefined): LlmProviderMeta | null {
  const normalized = normalizeLlmProviderId(providerId);
  return normalized ? PROVIDERS[normalized] : null;
}

export function listLlmProviders(params?: {
  context?: LlmUsageContext;
  includeHiddenSessionUnsupported?: boolean;
}): LlmProviderMeta[] {
  const context = params?.context;
  if (!context) return LLM_PROVIDERS;
  if (params?.includeHiddenSessionUnsupported) return LLM_PROVIDERS;
  return LLM_PROVIDERS.filter((p) => p.contexts[context]);
}

export function providerSupportsContext(providerId: string | null | undefined, context: LlmUsageContext): boolean {
  const meta = getLlmProviderMeta(providerId);
  return Boolean(meta?.contexts[context]);
}

export function isOAuthRequiredProvider(providerId: string | null | undefined): boolean {
  const meta = getLlmProviderMeta(providerId);
  return Boolean(meta && meta.authMode === "oauth");
}

export function getDefaultModelForProvider(providerId: string | null | undefined): string | null {
  const meta = getLlmProviderMeta(providerId);
  return meta?.defaultModelId ?? null;
}

export function getDefaultConnectorIdForProvider(providerId: string | null | undefined): string | null {
  const meta = getLlmProviderMeta(providerId);
  if (!meta) return null;
  return meta.defaultConnectorId;
}

export function normalizeConnectorId(connectorId: string): string {
  const trimmed = connectorId.trim();
  return CONNECTOR_ALIASES[trimmed] ?? trimmed;
}

export function getAllLlmConnectorIds(): string[] {
  const ids = new Set<string>();
  for (const provider of LLM_PROVIDERS) {
    if (provider.defaultConnectorId) {
      ids.add(provider.defaultConnectorId);
    }
    if (provider.authMode === "api-key" && provider.id !== "google-vertex") {
      ids.add(`llm.${provider.id}`);
    }
    if (provider.authMode === "oauth") {
      ids.add(`llm.${provider.id}.oauth`);
    }
  }
  ids.add("llm.google");
  ids.add("llm.google-vertex.oauth");
  ids.add("llm.gemini");
  ids.add("llm.vertex.oauth");
  return Array.from(ids).sort();
}

export function listModelsForProvider(providerId: string | null | undefined): LlmModelCatalogEntry[] {
  const normalized = normalizeLlmProviderId(providerId);
  if (!normalized) return [];
  return MODEL_SNAPSHOT.models.filter((m) => m.providerId === normalized);
}

export function listAllCatalogModels(): LlmModelCatalogEntry[] {
  return MODEL_SNAPSHOT.models;
}

export function getCatalogSnapshotInfo(): LlmModelCatalogSnapshot["source"] {
  return MODEL_SNAPSHOT.source;
}

export function inferProviderFromModelId(modelIdRaw: string): LlmProviderId | null {
  const modelId = modelIdRaw.trim().toLowerCase();
  if (!modelId) return null;
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("gpt-")) return "openai";
  if (modelId.startsWith("glm-")) return "zai";
  if (modelId.startsWith("grok-")) return "xai";
  if (modelId.startsWith("kimi-")) return "moonshot";
  if (modelId.includes("copilot")) return "github-copilot";
  if (modelId.includes("llama3") || modelId.includes("qwen2.5-coder:")) return "ollama";
  return null;
}

export function searchCatalog(params: {
  query: string;
  providerFilter?: LlmProviderId;
  context?: LlmUsageContext;
}): LlmModelCatalogEntry[] {
  const query = params.query.trim().toLowerCase();
  const providers = params.context ? listLlmProviders({ context: params.context }) : listLlmProviders();
  const allowedProviders = new Set(providers.map((p) => p.id));
  return MODEL_SNAPSHOT.models.filter((model) => {
    if (params.providerFilter && model.providerId !== params.providerFilter) return false;
    if (!allowedProviders.has(model.providerId)) return false;
    if (!query) return true;
    return (
      model.modelId.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      model.providerId.toLowerCase().includes(query)
    );
  });
}
