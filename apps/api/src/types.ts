export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: string;
};

export type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
};

export type MembershipRecord = {
  id: string;
  organizationId: string;
  userId: string;
  roleKey: "owner" | "admin" | "member";
  createdAt: string;
};

export type InvitationRecord = {
  id: string;
  organizationId: string;
  email: string;
  roleKey: "admin" | "member";
  invitedByUserId: string;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
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

export type InvitationAcceptResultRecord = {
  invitationId: string;
  organizationId: string;
  membershipId: string;
  accepted: boolean;
};

export type WorkflowRecord = {
  id: string;
  organizationId: string;
  name: string;
  status: "draft" | "published";
  version: number;
  dsl: unknown;
  createdByUserId: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunRecord = {
  id: string;
  organizationId: string;
  workflowId: string;
  triggerType: "manual";
  status: "queued" | "running" | "succeeded" | "failed";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  requestedByUserId: string;
  input: unknown;
  output: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export interface AppStore {
  ensureDefaultRoles(): Promise<void>;
  createUser(input: { email: string; passwordHash: string; displayName?: string | null }): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  createOrganizationWithOwner(input: { name: string; slug: string; ownerUserId: string }): Promise<{
    organization: OrganizationRecord;
    membership: MembershipRecord;
  }>;
  getMembership(input: { organizationId: string; userId: string; actorUserId?: string }): Promise<MembershipRecord | null>;
  createInvitation(input: {
    organizationId: string;
    email: string;
    roleKey: "admin" | "member";
    invitedByUserId: string;
    ttlHours?: number;
  }): Promise<InvitationRecord>;
  getInvitationByToken(input: { organizationId: string; token: string; actorUserId: string }): Promise<InvitationRecord | null>;
  acceptInvitation(input: {
    organizationId: string;
    token: string;
    userId: string;
    email: string;
  }): Promise<InvitationAcceptResultRecord>;
  updateMembershipRole(input: {
    organizationId: string;
    actorUserId: string;
    memberUserId: string;
    roleKey: "owner" | "admin" | "member";
  }): Promise<MembershipRecord | null>;
  createSession(input: {
    id?: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<SessionRecord>;
  getSessionById(input: { userId: string; sessionId: string }): Promise<SessionRecord | null>;
  rotateSessionRefreshToken(input: {
    userId: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord | null>;
  revokeSession(input: { userId: string; sessionId: string }): Promise<boolean>;
  revokeAllSessionsForUser(userId: string): Promise<number>;
  touchSession(input: { userId: string; sessionId: string }): Promise<void>;
  createWorkflow(input: {
    organizationId: string;
    name: string;
    dsl: unknown;
    createdByUserId: string;
  }): Promise<WorkflowRecord>;
  getWorkflowById(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null>;
  publishWorkflow(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null>;
  createWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    triggerType: "manual";
    requestedByUserId: string;
    input?: unknown;
    maxAttempts?: number;
  }): Promise<WorkflowRunRecord>;
  deleteQueuedWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
  }): Promise<boolean>;
  getWorkflowRunById(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
  }): Promise<WorkflowRunRecord | null>;
  markWorkflowRunRunning(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    attemptCount?: number;
  }): Promise<WorkflowRunRecord | null>;
  markWorkflowRunQueuedForRetry(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }): Promise<WorkflowRunRecord | null>;
  markWorkflowRunSucceeded(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    output: unknown;
  }): Promise<WorkflowRunRecord | null>;
  markWorkflowRunFailed(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }): Promise<WorkflowRunRecord | null>;
}
