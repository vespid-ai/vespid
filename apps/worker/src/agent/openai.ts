import { z } from "zod";

export type OpenAiChatMessage = { role: "system" | "user" | "assistant"; content: string };

const chatCompletionsResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export async function openAiChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  maxOutputChars?: number;
  maxTokens?: number;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; content: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { ok: false; error: string }
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com";

  const deadline = Date.now() + Math.max(1000, input.timeoutMs);
  const maxTokens =
    typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)
      ? Math.max(16, Math.floor(input.maxTokens))
      : typeof input.maxOutputChars === "number" && Number.isFinite(input.maxOutputChars)
        ? Math.min(4096, Math.max(64, Math.floor(input.maxOutputChars / 4)))
        : undefined;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await fetchImpl(new URL("/v1/chat/completions", apiBaseUrl).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: 0,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
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
        return { ok: false, error: `OPENAI_REQUEST_FAILED:${response.status}` };
      }

      const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
      const parsed = chatCompletionsResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: "OPENAI_RESPONSE_INVALID" };
      }

      const content = parsed.data.choices[0]?.message.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        return { ok: false, error: "OPENAI_RESPONSE_EMPTY" };
      }

      const promptTokens = parsed.data.usage?.prompt_tokens ?? 0;
      const completionTokens = parsed.data.usage?.completion_tokens ?? 0;
      const totalTokens = parsed.data.usage?.total_tokens ?? promptTokens + completionTokens;

      return {
        ok: true,
        content,
        usage: {
          inputTokens: Math.max(0, Math.floor(promptTokens)),
          outputTokens: Math.max(0, Math.floor(completionTokens)),
          totalTokens: Math.max(0, Math.floor(totalTokens)),
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
      return { ok: false, error: "OPENAI_UNAVAILABLE" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
