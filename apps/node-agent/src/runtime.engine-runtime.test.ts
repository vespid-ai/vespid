import { describe, expect, it } from "vitest";
import { __testables } from "./runtime.js";

describe("node-agent engine runtime env mapping", () => {
  it("maps claude engine credentials and base URL to anthropic env vars", () => {
    const env = __testables.buildEngineCredentialEnv({
      engineId: "gateway.claude.v2",
      apiKey: "sk-claude",
      baseUrl: "http://127.0.0.1:8045",
    });

    expect(env.ANTHROPIC_API_KEY).toBe("sk-claude");
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8045");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });

  it("maps codex/opencode runtime base URL to openai env vars", () => {
    const codexEnv = __testables.buildEngineCredentialEnv({
      engineId: "gateway.codex.v2",
      apiKey: "sk-openai",
      baseUrl: "http://model.mify.ai.srv/v1/",
    });
    expect(codexEnv.OPENAI_API_KEY).toBe("sk-openai");
    expect(codexEnv.OPENAI_BASE_URL).toBe("http://model.mify.ai.srv/v1/");

    const opencodeEnv = __testables.buildEngineCredentialEnv({
      engineId: "gateway.opencode.v2",
      apiKey: "sk-opencode",
      baseUrl: "http://localhost:9000/v1",
    });
    expect(opencodeEnv.OPENAI_API_KEY).toBe("sk-opencode");
    expect(opencodeEnv.OPENAI_BASE_URL).toBe("http://localhost:9000/v1");
  });
});
