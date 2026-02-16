export type LlmProviderId = "openai" | "anthropic" | "gemini" | "vertex";

export type CuratedModel = {
  providerId: LlmProviderId;
  modelId: string;
  name: string;
  tags?: Array<"recommended" | "fast" | "coding" | "general">;
};

export const curatedModels: CuratedModel[] = [
  { providerId: "openai", modelId: "gpt-4.1-mini", name: "GPT-4.1 mini", tags: ["recommended", "fast", "coding"] },
  { providerId: "openai", modelId: "gpt-4o-mini", name: "GPT-4o mini", tags: ["fast", "general"] },
  { providerId: "openai", modelId: "gpt-5-codex", name: "GPT-5 Codex", tags: ["coding"] },

  { providerId: "anthropic", modelId: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet (latest)", tags: ["recommended", "coding"] },

  { providerId: "gemini", modelId: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tags: ["recommended", "fast"] },

  { providerId: "vertex", modelId: "gemini-2.0-flash-001", name: "Vertex: Gemini 2.0 Flash 001", tags: ["recommended", "fast"] },
];

export const providerLabels: Record<LlmProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  vertex: "Vertex",
};

export const defaultModelByProvider: Record<LlmProviderId, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.0-flash",
  vertex: "gemini-2.0-flash-001",
};

export function inferProviderFromModelId(modelIdRaw: string): LlmProviderId | null {
  const modelId = modelIdRaw.trim().toLowerCase();
  if (!modelId) return null;

  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gemini-")) return "gemini";
  if (modelId.startsWith("gpt-")) return "openai";
  if (/^o[0-9]/.test(modelId)) return "openai";

  return null;
}

