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

export type GatewayExecutionKind = "connector.action" | "agent.execute";

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
  selectorTag?: string;
  selectorAgentId?: string;
  selectorGroup?: string;
  secret?: string;
  timeoutMs?: number;
};

export type GatewayDispatchResponse = {
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
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

export type GatewayServerExecuteMessage = {
  type: "execute";
  requestId: string;
  organizationId: string;
  userId: string;
  kind: GatewayExecutionKind;
  payload: unknown;
  secret?: string;
};
