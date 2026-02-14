export type OpenRouterModelItem = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v) => typeof v === "string" && v.trim().length > 0) as string[];
  return out.length ? out : [];
}

export function parseOpenRouterModelsResponse(payload: unknown): OpenRouterModelItem[] {
  const root = asObject(payload);
  const data = root ? (root["data"] as unknown) : null;
  if (!Array.isArray(data)) return [];

  const out: OpenRouterModelItem[] = [];
  for (const entry of data) {
    const obj = asObject(entry);
    if (!obj) continue;
    const id = typeof obj["id"] === "string" ? obj["id"] : null;
    if (!id || id.trim().length === 0) continue;

    const name =
      typeof obj["name"] === "string" && obj["name"].trim().length > 0
        ? obj["name"]
        : typeof obj["canonical_slug"] === "string" && obj["canonical_slug"].trim().length > 0
          ? obj["canonical_slug"]
          : id;

    const description = typeof obj["description"] === "string" && obj["description"].trim().length > 0 ? obj["description"] : null;

    const topProvider = asObject(obj["top_provider"]);
    const contextLengthRaw = obj["context_length"];
    const contextLengthTop = topProvider ? topProvider["context_length"] : null;
    const contextLength =
      typeof contextLengthRaw === "number"
        ? contextLengthRaw
        : typeof contextLengthTop === "number"
          ? contextLengthTop
          : undefined;

    const maxCompletionTokens =
      topProvider && typeof topProvider["max_completion_tokens"] === "number" ? topProvider["max_completion_tokens"] : undefined;

    const architecture = asObject(obj["architecture"]);
    const inputModalities = architecture ? asStringArray(architecture["input_modalities"]) : null;
    const outputModalities = architecture ? asStringArray(architecture["output_modalities"]) : null;

    const supportedParameters = asStringArray(obj["supported_parameters"]);

    const pricingObj = asObject(obj["pricing"]);
    const promptRaw = pricingObj ? pricingObj["prompt"] : null;
    const completionRaw = pricingObj ? pricingObj["completion"] : null;
    const prompt = typeof promptRaw === "string" ? promptRaw : typeof promptRaw === "number" ? String(promptRaw) : undefined;
    const completion =
      typeof completionRaw === "string" ? completionRaw : typeof completionRaw === "number" ? String(completionRaw) : undefined;

    out.push({
      id,
      name,
      ...(description ? { description } : {}),
      ...(typeof contextLength === "number" ? { contextLength } : {}),
      ...(typeof maxCompletionTokens === "number" ? { maxCompletionTokens } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(outputModalities ? { outputModalities } : {}),
      ...(supportedParameters ? { supportedParameters } : {}),
      ...(prompt || completion ? { pricing: { ...(prompt ? { prompt } : {}), ...(completion ? { completion } : {}) } } : {}),
    });
  }

  return out;
}

export function splitOpenRouterModelId(modelId: string): { providerId: string; model: string } | null {
  const trimmed = modelId.trim();
  const idx = trimmed.indexOf("/");
  if (idx <= 0 || idx === trimmed.length - 1) {
    return null;
  }
  const providerId = trimmed.slice(0, idx).trim();
  const model = trimmed.slice(idx + 1).trim();
  if (!providerId || !model) {
    return null;
  }
  return { providerId, model };
}
