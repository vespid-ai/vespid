export type SandboxNetworkMode = "none" | "enabled";
export type SandboxBackendId = "docker" | "host" | "provider";

export type ExecuteShellTaskContext = {
  requestId: string;
  organizationId: string;
  userId: string;
  runId: string | null;
  workflowId: string | null;
  nodeId: string;
  attemptCount: number | null;
  script: string;
  shell: "sh" | "bash";
  taskEnv: Record<string, string>;
  backend?: SandboxBackendId | null;
  networkMode: SandboxNetworkMode | null;
  timeoutMs: number | null;
  dockerImage: string | null;
  envPassthroughAllowlist: string[];
};

export type SandboxExecuteResult =
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; error: string; output?: unknown };

export interface SandboxBackend {
  executeShellTask(ctx: ExecuteShellTaskContext): Promise<SandboxExecuteResult>;
  close(): Promise<void>;
}
