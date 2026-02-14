import type { ExecuteShellTaskContext, SandboxBackend, SandboxExecuteResult } from "./types.js";

export function createHostBackend(): SandboxBackend {
  return {
    async executeShellTask(ctx: ExecuteShellTaskContext): Promise<SandboxExecuteResult> {
      // Backward-compatible stub: keep host backend non-executing in this slice.
      return {
        status: "succeeded",
        output: {
          accepted: true,
          backend: "host",
          taskId: `${ctx.nodeId}-remote-task`,
        },
      };
    },
    async close() {
      return;
    },
  };
}

