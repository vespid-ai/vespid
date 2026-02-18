import { afterEach, describe, expect, it } from "vitest";
import { __testables } from "./runtime.js";

const ORIGINAL_CODEX_CMD = process.env.VESPID_CODEX_OAUTH_VERIFY_CMD;

describe("executor OAuth probe", () => {
  afterEach(() => {
    if (ORIGINAL_CODEX_CMD === undefined) {
      delete process.env.VESPID_CODEX_OAUTH_VERIFY_CMD;
    } else {
      process.env.VESPID_CODEX_OAUTH_VERIFY_CMD = ORIGINAL_CODEX_CMD;
    }
  });

  it("marks verified when probe command exits zero", async () => {
    process.env.VESPID_CODEX_OAUTH_VERIFY_CMD = "sh -c 'exit 0'";
    const result = await __testables.probeEngineOauthStatus({ engineId: "gateway.codex.v2", timeoutMs: 2000 });
    expect(result.oauthVerified).toBe(true);
    expect(result.reason).toBe("verified");
  });

  it("marks unauthenticated when probe exits non-zero", async () => {
    process.env.VESPID_CODEX_OAUTH_VERIFY_CMD = "sh -c 'exit 9'";
    const result = await __testables.probeEngineOauthStatus({ engineId: "gateway.codex.v2", timeoutMs: 2000 });
    expect(result.oauthVerified).toBe(false);
    expect(result.reason).toBe("unauthenticated");
  });

  it("marks cli_not_found when command is missing", async () => {
    process.env.VESPID_CODEX_OAUTH_VERIFY_CMD = "vespid-missing-auth-command";
    const result = await __testables.probeEngineOauthStatus({ engineId: "gateway.codex.v2", timeoutMs: 2000 });
    expect(result.oauthVerified).toBe(false);
    expect(result.reason).toBe("cli_not_found");
  });

  it("marks probe_timeout when command exceeds timeout", async () => {
    process.env.VESPID_CODEX_OAUTH_VERIFY_CMD = "sh -c 'sleep 2'";
    const result = await __testables.probeEngineOauthStatus({ engineId: "gateway.codex.v2", timeoutMs: 200 });
    expect(result.oauthVerified).toBe(false);
    expect(result.reason).toBe("probe_timeout");
  });
});
