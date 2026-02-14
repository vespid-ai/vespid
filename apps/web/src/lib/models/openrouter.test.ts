import { describe, expect, it } from "vitest";
import { parseOpenRouterModelsResponse, splitOpenRouterModelId } from "./openrouter";

describe("openrouter model mapping", () => {
  it("maps key fields and prefers context_length fallback from top_provider", () => {
    const payload = {
      data: [
        {
          id: "openai/gpt-4.1-mini",
          name: "GPT-4.1 mini",
          description: "Test model",
          top_provider: { context_length: 123456, max_completion_tokens: 8192 },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: ["json_schema"],
          pricing: { prompt: "0.000001", completion: "0.000002" },
        },
      ],
    };

    const mapped = parseOpenRouterModelsResponse(payload);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.id).toBe("openai/gpt-4.1-mini");
    expect(mapped[0]?.name).toBe("GPT-4.1 mini");
    expect(mapped[0]?.contextLength).toBe(123456);
    expect(mapped[0]?.maxCompletionTokens).toBe(8192);
    expect(mapped[0]?.inputModalities).toEqual(["text"]);
    expect(mapped[0]?.outputModalities).toEqual(["text"]);
    expect(mapped[0]?.supportedParameters).toEqual(["json_schema"]);
    expect(mapped[0]?.pricing?.prompt).toBe("0.000001");
    expect(mapped[0]?.pricing?.completion).toBe("0.000002");
  });

  it("splits openrouter model IDs", () => {
    expect(splitOpenRouterModelId("openai/gpt-5-chat-latest")).toEqual({
      providerId: "openai",
      model: "gpt-5-chat-latest",
    });
    expect(splitOpenRouterModelId("gpt-4.1-mini")).toBeNull();
    expect(splitOpenRouterModelId("openai/")).toBeNull();
  });
});

