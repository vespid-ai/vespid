import type { SandboxBackend } from "./types.js";
import { createHostBackend } from "./host-backend.js";
import { createDockerBackend } from "./docker-backend.js";
import { createProviderBackend } from "./provider-backend.js";

export type { SandboxBackend } from "./types.js";

export function resolveSandboxBackend(): SandboxBackend {
  const raw = process.env.VESPID_AGENT_EXEC_BACKEND ?? "host";
  if (raw === "docker") {
    return createDockerBackend();
  }
  if (raw === "provider") {
    // Provider backend is optional and loaded dynamically.
    // It may fail if not configured; we treat it as a backend that returns stable errors.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    return {
      async executeShellTask(ctx) {
        const backend = await createProviderBackend();
        return await backend.executeShellTask(ctx);
      },
      async close() {
        return;
      },
    };
  }
  return createHostBackend();
}

