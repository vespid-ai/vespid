export type Role = {
  id: string;
  key: "owner" | "admin" | "member";
  name: string;
};

export type Organization = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
};

export type Membership = {
  id: string;
  organizationId: string;
  userId: string;
  role: Role["key"];
  createdAt: string;
};

export type AuthSession = {
  token: string;
  userId: string;
  email: string;
  sessionId: string;
  tokenType: "access";
  issuedAt: number;
  expiresAt: number;
};

export type AccessTokenClaims = {
  userId: string;
  email: string;
  sessionId: string;
  tokenType: "access";
  issuedAt: number;
  expiresAt: number;
};

export type SessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
};

export type SessionCookieOptions = {
  name: string;
  path: string;
  maxAgeSec: number;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type InvitationAcceptResult = {
  invitationId: string;
  organizationId: string;
  membershipId: string;
  accepted: boolean;
};

export type OrgContextError = "ORG_CONTEXT_REQUIRED" | "ORG_ACCESS_DENIED" | "INVALID_ORG_CONTEXT";

export type WorkflowRunJobPayload = {
  runId: string;
  organizationId: string;
  workflowId: string;
  requestedByUserId: string;
};

export type GatewayExecutionKind = "connector.action" | "agent.execute" | "agent.run";
export type GatewayToolKind = Exclude<GatewayExecutionKind, "agent.run">;

export type GatewayDispatchRequest = {
  organizationId: string;
  requestedByUserId: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  nodeType: string;
  attemptCount: number;
  kind: GatewayExecutionKind;
  payload: unknown;
  executorSelector?: ExecutorSelectorV1;
  secret?: string;
  timeoutMs?: number;
};

export type GatewayDispatchResponse = {
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
};

export type RemoteExecutionEvent = {
  seq: number;
  ts: number;
  kind: string;
  level: "info" | "warn" | "error";
  message?: string;
  payload?: unknown;
};

export type GatewayAgentHelloMessage = {
  type: "hello";
  agentVersion: string;
  name: string;
  capabilities?: Record<string, unknown>;
};

export type GatewayAgentPingMessage = {
  type: "ping";
  ts: number;
};

export type GatewayAgentExecuteResultMessage = {
  type: "execute_result";
  requestId: string;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
};

export type GatewayAgentExecuteReceivedMessage = {
  type: "execute_received";
  requestId: string;
};

export type GatewayAgentExecuteEventMessage = {
  type: "execute_event";
  requestId: string;
  event: RemoteExecutionEvent;
};

export type GatewayServerExecuteMessage = {
  type: "execute";
  requestId: string;
  organizationId: string;
  userId: string;
  kind: GatewayExecutionKind;
  payload: unknown;
  secret?: string;
};

// Gateway -> agent acknowledgement for at-least-once result delivery.
// Agents may resend execute_result frames on reconnect until acked.
export type GatewayServerExecuteAckMessage = {
  type: "execute_ack";
  requestId: string;
};

export type ExecutorPool = "managed" | "byon";

export type WorkspacePointerV1 = {
  workspaceId: string;
  version: number;
  objectKey: string;
  etag?: string | null;
};

export type WorkspaceAccessV1 = {
  // Optional for version 0 / empty workspaces.
  downloadUrl?: string | null;
  // Upload target for the next version (single-writer per workspace in v1).
  upload: { url: string; objectKey: string; version: number };
};

export type ToolPolicyV1 = {
  // Default-deny network unless explicitly enabled for this invocation.
  networkModeDefaultDeny: boolean;
  // Executor should treat "enabled" as an explicit opt-in; default is "none".
  networkMode: "none" | "enabled";
  timeoutMs: number;
  outputMaxChars: number;
  mountsAllowlist: Array<{ containerPath: string; mode: "ro" | "rw" }>;
};

export type ExecutorSelectorV1 = {
  pool: ExecutorPool;
  labels?: string[] | undefined;
  group?: string | undefined;
  tag?: string | undefined;
  executorId?: string | undefined;
};

export type GatewayExecutorHelloV2 = {
  type: "executor_hello_v2";
  executorVersion: string;
  // For BYON, this is the control-plane executor id.
  executorId: string;
  pool: ExecutorPool;
  // BYON executors are org-bound. Managed executors may omit.
  organizationId?: string;
  name?: string | null;
  labels: string[];
  maxInFlight: number;
  // Interactive sessions may pin a host that can run agent turns end-to-end.
  kinds: GatewayExecutionKind[];
  resourceHints?: { cpu?: number; memoryMb?: number };
};

export type GatewayInvokeToolV2 = {
  type: "invoke_tool_v2";
  requestId: string;
  organizationId: string;
  userId: string;
  kind: GatewayToolKind;
  payload: unknown;
  // Connector actions may require a secret to call third-party APIs.
  // Never populated for shell-like tools.
  secret?: string;
  toolPolicy: ToolPolicyV1;
  workspace: WorkspacePointerV1;
  workspaceAccess: WorkspaceAccessV1;
  idempotencyKey?: string;
};

export type GatewayToolEventV2 = {
  type: "tool_event_v2";
  requestId: string;
  event: RemoteExecutionEvent;
};

export type GatewayToolResultV2 = {
  type: "tool_result_v2";
  requestId: string;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
  workspace?: WorkspacePointerV1;
};

export type GatewayBrainSessionEventV2 = {
  type: "session_event_v2";
  sessionId: string;
  seq: number;
  eventType: string;
  level: "info" | "warn" | "error";
  payload: unknown;
  createdAt: string;
};

export type ChannelId =
  | "whatsapp"
  | "telegram"
  | "discord"
  | "irc"
  | "slack"
  | "googlechat"
  | "signal"
  | "imessage"
  | "feishu"
  | "mattermost"
  | "bluebubbles"
  | "msteams"
  | "line"
  | "nextcloud-talk"
  | "matrix"
  | "nostr"
  | "tlon"
  | "twitch"
  | "zalo"
  | "zalouser"
  | "webchat";

export type ChannelDmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type ChannelGroupPolicy = "allowlist" | "open" | "disabled";
export type ChannelMessageEventType = "message.received" | "message.mentioned" | "message.dm";

export type ChannelSecurityPolicy = {
  dmPolicy: ChannelDmPolicy;
  groupPolicy: ChannelGroupPolicy;
  requireMentionInGroup: boolean;
  allowFrom: string[];
  groupAllowFrom: string[];
};

export type ChannelInboundEnvelope = {
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
  organizationId: string;
  providerMessageId: string;
  conversationId: string;
  senderId: string;
  senderDisplayName?: string | null;
  text: string;
  receivedAt: string;
  event: ChannelMessageEventType;
  mentionMatched: boolean;
  raw?: unknown;
};

export type ChannelOutboundRequest = {
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
  organizationId: string;
  conversationId: string;
  text: string;
  replyToProviderMessageId?: string | null;
  metadata?: Record<string, unknown>;
};

export type ChannelTriggerPayload = {
  organizationId: string;
  workflowId: string;
  requestedByUserId: string;
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
  conversationId: string;
  providerMessageId: string;
  senderId: string;
  senderDisplayName?: string | null;
  text: string;
  event: ChannelMessageEventType;
  mentionMatched: boolean;
  receivedAt: string;
  raw?: unknown;
};

export type ChannelSessionSource = {
  channelId: ChannelId;
  accountId: string;
  accountKey: string;
  conversationId: string;
  providerMessageId: string;
  mentionMatched: boolean;
  event: ChannelMessageEventType;
};

export type SessionScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

export type BindingDimension =
  | "peer"
  | "parent_peer"
  | "org_roles"
  | "organization"
  | "team"
  | "account"
  | "channel"
  | "default";

export type SessionEventType =
  | "user_message"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "agent_handoff"
  | "agent_final"
  | "error"
  | "system";

export type MemoryProvider = "builtin" | "qmd";

export type ExecutionMode = "pinned-node-host";

export type AgentBindingMatch = {
  peer?: string | null;
  parentPeer?: string | null;
  orgRoles?: string[] | null;
  organizationId?: string | null;
  teamId?: string | null;
  accountId?: string | null;
  channelId?: string | null;
};

export type AgentBindingRecord = {
  id: string;
  organizationId: string;
  agentId: string;
  priority: number;
  dimension: BindingDimension;
  match: AgentBindingMatch;
  metadata?: Record<string, unknown> | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRouteContext = {
  organizationId: string;
  actorUserId: string;
  channel?: string | null;
  account?: string | null;
  peer?: string | null;
  parentPeer?: string | null;
  orgRoles?: string[];
  team?: string | null;
  scope: SessionScope;
};

export type SessionRouteResolved = {
  routedAgentId: string;
  sessionKey: string;
  bindingId?: string | null;
};

export type SessionAttachmentV2 = {
  name: string;
  mimeType: string;
  contentUrl?: string | null;
  contentText?: string | null;
  metadata?: Record<string, unknown>;
};

export type SessionClientJoinMessageV2 = {
  type: "session_join";
  sessionId: string;
};

export type SessionClientSendMessageV2 = {
  type: "session_send";
  sessionId: string;
  message: string;
  attachments?: SessionAttachmentV2[];
  idempotencyKey?: string;
};

export type SessionClientResetAgentMessageV2 = {
  type: "session_reset_agent";
  sessionId: string;
  mode?: "keep_history" | "clear_history";
};

export type SessionClientLeaveMessageV2 = {
  type: "session_leave";
  sessionId: string;
};

export type SessionClientHelloMessageV2 = {
  type: "client_hello";
  clientVersion?: string;
};

export type SessionClientToGatewayMessageV2 =
  | SessionClientHelloMessageV2
  | SessionClientJoinMessageV2
  | SessionClientSendMessageV2
  | SessionClientResetAgentMessageV2
  | SessionClientLeaveMessageV2;

export type SessionGatewayAckMessageV2 = {
  type: "session_ack";
  sessionId: string;
};

export type SessionGatewayDeltaMessageV2 = {
  type: "agent_delta";
  sessionId: string;
  seq: number;
  content: string;
  createdAt: string;
};

export type SessionGatewayFinalMessageV2 = {
  type: "agent_final";
  sessionId: string;
  seq: number;
  content: string;
  payload?: unknown;
  createdAt: string;
};

export type SessionGatewayHandoffMessageV2 = {
  type: "agent_handoff";
  sessionId: string;
  seq: number;
  fromAgentId: string | null;
  toAgentId: string;
  reason?: string | null;
  createdAt: string;
};

export type SessionGatewayStateMessageV2 = {
  type: "session_state";
  sessionId: string;
  pinnedExecutorId: string | null;
  pinnedExecutorPool: ExecutorPool | null;
  pinnedAgentId: string | null;
  routedAgentId: string | null;
  scope: SessionScope;
  executionMode: ExecutionMode;
};

export type SessionGatewayErrorMessageV2 = {
  type: "session_error";
  sessionId?: string;
  code: string;
  message: string;
};

export type SessionGatewayToClientMessageV2 =
  | SessionGatewayAckMessageV2
  | SessionGatewayDeltaMessageV2
  | SessionGatewayFinalMessageV2
  | SessionGatewayHandoffMessageV2
  | SessionGatewayStateMessageV2
  | SessionGatewayErrorMessageV2;

export type GatewaySessionOpenV2 = {
  type: "session_open";
  requestId: string;
  organizationId: string;
  sessionId: string;
  sessionKey: string;
  routedAgentId: string;
  userId: string;
  sessionConfig: {
    engineId: string;
    llm: {
      provider: "openai" | "anthropic" | "gemini" | "vertex";
      model: string;
      authMode: "env" | "inline_api_key" | "inline_vertex_oauth";
      auth?:
        | {
            kind: "api_key";
            apiKey: string;
          }
        | {
            kind: "vertex_oauth";
            refreshToken: string;
            projectId: string;
            location: string;
          };
    };
    prompt: {
      system?: string | null;
      instructions: string;
    };
    toolsAllow: string[];
    limits: {
      maxTurns: number;
      maxToolCalls: number;
      timeoutMs: number;
      maxOutputChars: number;
      maxRuntimeChars: number;
    };
    memoryProvider: MemoryProvider;
  };
};

export type GatewaySessionTurnV2 = {
  type: "session_turn";
  requestId: string;
  organizationId: string;
  sessionId: string;
  sessionKey: string;
  userId: string;
  eventSeq: number;
  message: string;
  attachments?: SessionAttachmentV2[];
};

export type GatewaySessionCancelV2 = {
  type: "session_cancel";
  requestId: string;
  organizationId: string;
  sessionId: string;
};

export type GatewayMemorySyncV2 = {
  type: "memory_sync";
  requestId: string;
  organizationId: string;
  sessionId: string;
  sessionKey: string;
  provider: MemoryProvider;
  workspaceDir: string;
};

export type GatewayMemoryQueryV2 = {
  type: "memory_query";
  requestId: string;
  organizationId: string;
  sessionId: string;
  sessionKey: string;
  provider: MemoryProvider;
  query: string;
  limit?: number;
};

export type GatewaySessionToExecutorMessageV2 =
  | GatewaySessionOpenV2
  | GatewaySessionTurnV2
  | GatewaySessionCancelV2
  | GatewayMemorySyncV2
  | GatewayMemoryQueryV2;

export type ExecutorSessionOpenedV2 = {
  type: "session_opened";
  requestId: string;
  sessionId: string;
};

export type ExecutorTurnDeltaV2 = {
  type: "turn_delta";
  requestId: string;
  sessionId: string;
  content: string;
};

export type ExecutorTurnFinalV2 = {
  type: "turn_final";
  requestId: string;
  sessionId: string;
  content: string;
  payload?: unknown;
};

export type ExecutorTurnErrorV2 = {
  type: "turn_error";
  requestId: string;
  sessionId: string;
  code: string;
  message: string;
};

export type ExecutorMemorySyncResultV2 = {
  type: "memory_sync_result";
  requestId: string;
  sessionId: string;
  status: "ok" | "failed";
  details?: unknown;
};

export type ExecutorMemoryQueryResultV2 = {
  type: "memory_query_result";
  requestId: string;
  sessionId: string;
  status: "ok" | "failed";
  results?: unknown[];
  error?: string;
};

export type ExecutorToGatewaySessionMessageV2 =
  | ExecutorSessionOpenedV2
  | ExecutorTurnDeltaV2
  | ExecutorTurnFinalV2
  | ExecutorTurnErrorV2
  | ExecutorMemorySyncResultV2
  | ExecutorMemoryQueryResultV2;
