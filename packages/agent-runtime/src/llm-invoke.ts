import type { OpenAiChatMessage } from "./openai.js";
import { openAiChatCompletion } from "./openai.js";
import { anthropicChatCompletion } from "./anthropic.js";
import { geminiGenerateContent } from "./gemini.js";
import { vertexGenerateContent } from "./vertex.js";

export type LlmInvokeProvider = "openai" | "anthropic" | "gemini" | "vertex";

export type LlmInvokeAuth =
  | { kind: "api_key"; apiKey: string }
  | { kind: "vertex_oauth"; refreshToken: string; projectId: string; location: string };

export type LlmInvokeInput = {
  provider: LlmInvokeProvider;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  maxOutputChars?: number;
  auth: LlmInvokeAuth;
  fetchImpl?: typeof fetch;
};

export type LlmInvokeResult =
  | { ok: true; content: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { ok: false; error: string };

export async function runLlmInference(input: LlmInvokeInput): Promise<LlmInvokeResult> {
  if (input.provider === "vertex") {
    if (input.auth.kind !== "vertex_oauth") {
      return { ok: false, error: "LLM_AUTH_NOT_CONFIGURED" };
    }
    return await vertexGenerateContent({
      refreshToken: input.auth.refreshToken,
      projectId: input.auth.projectId,
      location: input.auth.location,
      model: input.model,
      messages: input.messages as any,
      timeoutMs: input.timeoutMs,
      ...(typeof input.maxOutputChars === "number" ? { maxOutputChars: input.maxOutputChars } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  if (input.auth.kind !== "api_key") {
    return { ok: false, error: "LLM_AUTH_NOT_CONFIGURED" };
  }

  if (input.provider === "anthropic") {
    return await anthropicChatCompletion({
      apiKey: input.auth.apiKey,
      model: input.model,
      messages: input.messages,
      timeoutMs: input.timeoutMs,
      ...(typeof input.maxOutputChars === "number" ? { maxOutputChars: input.maxOutputChars } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  if (input.provider === "gemini") {
    return await geminiGenerateContent({
      apiKey: input.auth.apiKey,
      model: input.model,
      messages: input.messages as any,
      timeoutMs: input.timeoutMs,
      ...(typeof input.maxOutputChars === "number" ? { maxOutputChars: input.maxOutputChars } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  return await openAiChatCompletion({
    apiKey: input.auth.apiKey,
    model: input.model,
    messages: input.messages,
    timeoutMs: input.timeoutMs,
    ...(typeof input.maxOutputChars === "number" ? { maxOutputChars: input.maxOutputChars } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
}
