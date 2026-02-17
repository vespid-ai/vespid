export const REMOTE_EXEC_ERROR = {
  NoAgentAvailable: "NO_AGENT_AVAILABLE",
  PinnedAgentOffline: "PINNED_AGENT_OFFLINE",
  NodeExecutionFailed: "NODE_EXECUTION_FAILED",
  NodeExecutionTimeout: "NODE_EXECUTION_TIMEOUT",
  AgentDisconnected: "AGENT_DISCONNECTED",
  GatewayUnavailable: "GATEWAY_UNAVAILABLE",
  GatewayNotConfigured: "GATEWAY_NOT_CONFIGURED",
  GatewayResponseInvalid: "GATEWAY_RESPONSE_INVALID",
  GatewayDispatchFailed: "GATEWAY_DISPATCH_FAILED",
  GatewayShutdown: "GATEWAY_SHUTDOWN",
  DockerFailed: "DOCKER_FAILED",
} as const;

export type RemoteExecErrorCode =
  | (typeof REMOTE_EXEC_ERROR)[keyof typeof REMOTE_EXEC_ERROR]
  | `DOCKER_EXIT_CODE:${number}`;

export function isRemoteExecErrorCode(value: unknown): value is RemoteExecErrorCode {
  if (typeof value !== "string") {
    return false;
  }
  if (Object.values(REMOTE_EXEC_ERROR).includes(value as (typeof REMOTE_EXEC_ERROR)[keyof typeof REMOTE_EXEC_ERROR])) {
    return true;
  }
  return /^DOCKER_EXIT_CODE:\d+$/.test(value);
}
