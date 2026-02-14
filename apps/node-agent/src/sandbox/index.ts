import type { SandboxBackend } from "./types.js";
import { createHostBackend } from "./host-backend.js";
import { createDockerBackend } from "./docker-backend.js";
import { createProviderBackend } from "./provider-backend.js";
import type { SandboxBackendId } from "./types.js";

export type { SandboxBackend } from "./types.js";

export function resolveSandboxBackend(): SandboxBackend {
  const defaultBackend = (process.env.VESPID_AGENT_EXEC_BACKEND ?? "host") as SandboxBackendId;
  const host = createHostBackend();
  const docker = createDockerBackend();
  let provider: SandboxBackend | null = null;

  async function getBackend(id: SandboxBackendId): Promise<SandboxBackend> {
    if (id === "docker") {
      return docker;
    }
    if (id === "provider") {
      if (!provider) {
        provider = await createProviderBackend();
      }
      return provider;
    }
    return host;
  }

  return {
    async executeShellTask(ctx) {
      const selected = (ctx.backend ?? defaultBackend) as SandboxBackendId;
      const backend = await getBackend(selected);
      return await backend.executeShellTask(ctx);
    },
    async close() {
      await host.close();
      await docker.close();
      if (provider) {
        await provider.close();
      }
    },
  };
}
