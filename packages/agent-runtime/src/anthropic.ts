import { z } from "zod";
import type { OpenAiChatMessage } from "./openai.js";

const anthropicResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string(),
      })
    )
    .min(1),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

function toAnthropic(input: { messages: OpenAiChatMessage[] }): { system: string | undefined; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of input.messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    out.push({ role: "assistant", content: m.content });
  }

  const system = systemParts.length > 0 ? systemParts.join("\n") : undefined;
  return { system, messages: out };
}

export async function anthropicChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  maxOutputChars?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; content: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { ok: false; error: string }
> {
  const fetchImpl = input.fetchImpl ?? fetch;

  const deadline = Date.now() + Math.max(1000, input.timeoutMs);
  const maxTokens =
    typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)
      ? Math.max(16, Math.floor(input.maxTokens))
      : typeof input.maxOutputChars === "number" && Number.isFinite(input.maxOutputChars)
        ? Math.min(4096, Math.max(64, Math.floor(input.maxOutputChars / 4)))
        : 1024;

  const converted = toAnthropic({ messages: input.messages });

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.model,
          ...(converted.system ? { system: converted.system } : {}),
          messages: converted.messages,
          max_tokens: maxTokens,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && Date.now() + 200 < deadline) {
          const backoffMs = Math.min(2000, 200 * Math.pow(2, Math.min(6, attempt - 1)));
          const jitterMs = Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, Math.min(backoffMs + jitterMs, Math.max(1, deadline - Date.now()))));
          continue;
        }
        return { ok: false, error: `ANTHROPIC_REQUEST_FAILED:${response.status}` };
      }

      const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
      const parsed = anthropicResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: "ANTHROPIC_RESPONSE_INVALID" };
      }

      const text = parsed.data.content.map((c) => c.text).join("");
      if (typeof text !== "string" || text.trim().length === 0) {
        return { ok: false, error: "ANTHROPIC_RESPONSE_EMPTY" };
      }

      const inputTokens = parsed.data.usage?.input_tokens ?? 0;
      const outputTokens = parsed.data.usage?.output_tokens ?? 0;

      return {
        ok: true,
        content: text,
        usage: {
          inputTokens: Math.max(0, Math.floor(inputTokens)),
          outputTokens: Math.max(0, Math.floor(outputTokens)),
          totalTokens: Math.max(0, Math.floor(inputTokens + outputTokens)),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: "LLM_TIMEOUT" };
      }
      if (Date.now() + 200 < deadline) {
        const backoffMs = Math.min(2000, 200 * Math.pow(2, Math.min(6, attempt - 1)));
        const jitterMs = Math.floor(Math.random() * 100);
        await new Promise((r) => setTimeout(r, Math.min(backoffMs + jitterMs, Math.max(1, deadline - Date.now()))));
        continue;
      }
      return { ok: false, error: "ANTHROPIC_UNAVAILABLE" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
