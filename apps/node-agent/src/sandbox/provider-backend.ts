import type { ExecuteShellTaskContext, SandboxBackend, SandboxExecuteResult } from "./types.js";

type ProviderModule = {
  sandboxProvider?: {
    name: string;
    version?: string;
    executeShellTask: (ctx: ExecuteShellTaskContext) => Promise<SandboxExecuteResult> | SandboxExecuteResult;
  };
};

export async function createProviderBackend(): Promise<SandboxBackend> {
  const modulePath = process.env.VESPID_AGENT_SANDBOX_PROVIDER_MODULE;
  if (!modulePath || modulePath.trim().length === 0) {
    return {
      async executeShellTask() {
        return { status: "failed", error: "SANDBOX_PROVIDER_NOT_CONFIGURED" };
      },
      async close() {
        return;
      },
    };
  }

  let loaded: ProviderModule;
  try {
    loaded = (await import(modulePath)) as ProviderModule;
  } catch {
    return {
      async executeShellTask() {
        return { status: "failed", error: "SANDBOX_PROVIDER_LOAD_FAILED" };
      },
      async close() {
        return;
      },
    };
  }

  const provider = loaded.sandboxProvider;
  if (!provider || typeof provider.executeShellTask !== "function") {
    return {
      async executeShellTask() {
        return { status: "failed", error: "SANDBOX_PROVIDER_INVALID" };
      },
      async close() {
        return;
      },
    };
  }

  return {
    async executeShellTask(ctx: ExecuteShellTaskContext): Promise<SandboxExecuteResult> {
      return await provider.executeShellTask(ctx);
    },
    async close() {
      return;
    },
  };
}

