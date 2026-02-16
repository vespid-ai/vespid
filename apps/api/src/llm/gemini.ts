import { z } from "zod";
import type { OpenAiChatMessage } from "./openai.js";

const geminiGenerateResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })).min(1),
        }),
      })
    )
    .min(1),
});

function toGeminiContents(messages: OpenAiChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const msg of rest) {
    const role = msg.role === "assistant" ? "model" : "user";
    out.push({ role, parts: [{ text: msg.content }] });
  }
  if (system.trim().length > 0) {
    const firstUser = out.find((c) => c.role === "user") ?? null;
    if (firstUser) {
      firstUser.parts = [{ text: `${system}\n\n${firstUser.parts.map((p) => p.text).join("\n")}` }];
    } else {
      out.unshift({ role: "user", parts: [{ text: system }] });
    }
  }
  return out;
}

export async function geminiGenerateContent(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  maxOutputChars?: number;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com";

  const deadline = Date.now() + Math.max(1000, input.timeoutMs);
  const url = new URL(`/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, apiBaseUrl);
  url.searchParams.set("key", input.apiKey);

  const contents = toGeminiContents(input.messages);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0,
            ...(typeof input.maxOutputChars === "number" && Number.isFinite(input.maxOutputChars)
              ? { maxOutputTokens: Math.max(32, Math.min(8192, Math.floor(input.maxOutputChars / 4))) }
              : {}),
          },
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
        return { ok: false, error: `GEMINI_REQUEST_FAILED:${response.status}` };
      }

      const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
      const parsed = geminiGenerateResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: "GEMINI_RESPONSE_INVALID" };
      }

      const text = parsed.data.candidates[0]?.content.parts.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        return { ok: false, error: "GEMINI_RESPONSE_EMPTY" };
      }
      return { ok: true, content: text };
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
      return { ok: false, error: "GEMINI_UNAVAILABLE" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
