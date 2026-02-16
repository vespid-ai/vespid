import { z } from "zod";
import type { OpenAiChatMessage } from "./openai.js";

const vertexTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const vertexGenerateResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).min(1),
          })
          .optional(),
      })
    )
    .min(1),
});

function toVertexContents(messages: OpenAiChatMessage[]) {
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

function normalizeVertexModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return `publishers/google/models/${trimmed}`;
}

export async function vertexGenerateContent(input: {
  refreshToken: string;
  projectId: string;
  location: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs: number;
  maxOutputChars?: number;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? process.env.VERTEX_API_BASE_URL ?? `https://${input.location}-aiplatform.googleapis.com`;

  const clientId = process.env.GOOGLE_VERTEX_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_VERTEX_CLIENT_SECRET ?? "";
  if (clientId.trim().length === 0 || clientSecret.trim().length === 0) {
    return { ok: false, error: "VERTEX_OAUTH_NOT_CONFIGURED" };
  }

  const deadline = Date.now() + Math.max(1000, input.timeoutMs);

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const tokenResp = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: controller.signal,
      });

      const tokenRaw = await tokenResp.text();
      if (!tokenResp.ok) {
        const retryable = tokenResp.status === 429 || tokenResp.status >= 500;
        if (retryable && Date.now() + 200 < deadline) {
          const backoffMs = Math.min(2000, 200 * Math.pow(2, Math.min(6, attempt - 1)));
          const jitterMs = Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, Math.min(backoffMs + jitterMs, Math.max(1, deadline - Date.now()))));
          continue;
        }
        return { ok: false, error: `VERTEX_TOKEN_FAILED:${tokenResp.status}` };
      }

      const tokenPayload = tokenRaw.length > 0 ? (JSON.parse(tokenRaw) as unknown) : null;
      const tokenParsed = vertexTokenResponseSchema.safeParse(tokenPayload);
      if (!tokenParsed.success) {
        return { ok: false, error: "VERTEX_TOKEN_INVALID" };
      }

      const modelRef = normalizeVertexModel(input.model);
      const url = new URL(
        `/v1/projects/${encodeURIComponent(input.projectId)}/locations/${encodeURIComponent(input.location)}/${modelRef}:generateContent`,
        apiBaseUrl
      );

      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokenParsed.data.access_token}`,
        },
        body: JSON.stringify({
          contents: toVertexContents(input.messages),
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
        return { ok: false, error: `VERTEX_REQUEST_FAILED:${response.status}` };
      }

      const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
      const parsed = vertexGenerateResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, error: "VERTEX_RESPONSE_INVALID" };
      }

      const text = parsed.data.candidates[0]?.content?.parts.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        return { ok: false, error: "VERTEX_RESPONSE_EMPTY" };
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
      return { ok: false, error: "VERTEX_UNAVAILABLE" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
