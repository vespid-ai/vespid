import { z } from "zod";

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

const openRouterModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    context_length: z.number().int().positive().optional(),
    top_provider: z
      .object({
        context_length: z.number().int().positive().optional(),
        max_completion_tokens: z.number().int().positive().optional(),
      })
      .optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string().min(1)).optional(),
        output_modalities: z.array(z.string().min(1)).optional(),
      })
      .optional(),
    supported_parameters: z.array(z.string().min(1)).optional(),
    pricing: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const openRouterModelsResponseSchema = z
  .object({
    data: z.array(openRouterModelSchema),
  })
  .passthrough();

export function parseOpenRouterModelsResponse(payload: unknown): OpenRouterModelItem[] {
  const parsed = openRouterModelsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.data.map((raw) => {
    const contextLength = raw.context_length ?? raw.top_provider?.context_length;
    const maxCompletionTokens = raw.top_provider?.max_completion_tokens;

    const prompt = raw.pricing?.prompt;
    const completion = raw.pricing?.completion;

    return {
      id: raw.id,
      name: raw.name,
      ...(raw.description ? { description: raw.description } : {}),
      ...(typeof contextLength === "number" ? { contextLength } : {}),
      ...(typeof maxCompletionTokens === "number" ? { maxCompletionTokens } : {}),
      ...(raw.architecture?.input_modalities ? { inputModalities: raw.architecture.input_modalities } : {}),
      ...(raw.architecture?.output_modalities ? { outputModalities: raw.architecture.output_modalities } : {}),
      ...(raw.supported_parameters ? { supportedParameters: raw.supported_parameters } : {}),
      ...(prompt || completion ? { pricing: { ...(prompt ? { prompt } : {}), ...(completion ? { completion } : {}) } } : {}),
    };
  });
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

