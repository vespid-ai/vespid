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
});

export async function openAiChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
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

    return { ok: true, content };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "LLM_TIMEOUT" };
    }
    return { ok: false, error: "OPENAI_UNAVAILABLE" };
  } finally {
    clearTimeout(timeout);
  }
}

