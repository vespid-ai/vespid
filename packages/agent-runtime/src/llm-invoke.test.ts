import { describe, expect, it, vi } from "vitest";
import { runLlmInference } from "./llm-invoke.js";

describe("runLlmInference", () => {
  it("uses custom OpenAI-compatible base URL when provided", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await runLlmInference({
      provider: "openai",
      model: "gpt-5-codex",
      messages: [{ role: "user", content: "ping" }],
      timeoutMs: 5_000,
      auth: { kind: "api_key", apiKey: "sk-test" },
      apiBaseUrl: "http://127.0.0.1:8045",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe("http://127.0.0.1:8045/v1/chat/completions");
  });

  it("uses custom Anthropic-compatible base URL when provided", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await runLlmInference({
      provider: "anthropic",
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "ping" }],
      timeoutMs: 5_000,
      auth: { kind: "api_key", apiKey: "sk-test" },
      apiBaseUrl: "http://127.0.0.1:8045",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe("http://127.0.0.1:8045/v1/messages");
  });
});
