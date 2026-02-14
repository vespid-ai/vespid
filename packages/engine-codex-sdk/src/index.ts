export function createEngineRunner() {
  return {
    id: "codex.sdk.v1" as const,
    async run() {
      return { ok: false as const, error: "ENGINE_ADAPTER_NOT_IMPLEMENTED" };
    },
  };
}

