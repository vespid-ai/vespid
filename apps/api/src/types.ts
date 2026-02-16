import type { AgentSkillBundle, McpServerConfig, ToolsetVisibility } from "@vespid/shared";

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

export type OrganizationSettings = {
  tools?: {
    shellRunEnabled?: boolean;
  };
  toolsets?: {
    defaultToolsetId?: string | null;
  };
  llm?: {
    defaults?: {
      // Nullable fields represent "explicitly cleared" defaults.
      session?: { provider?: "openai" | "anthropic" | "gemini" | null; model?: string | null };
      workflowAgentRun?: {
        provider?: "openai" | "anthropic" | "gemini" | "vertex" | null;
        model?: string | null;
        secretId?: string | null;
      };
      toolsetBuilder?: {
        provider?: "openai" | "anthropic" | null;
        model?: string | null;
        secretId?: string | null;
      };
    };
  };
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
  familyId: string;
  revision: number;
  sourceWorkflowId: string | null;
  name: string;
  status: "draft" | "published";
  version: number;
  dsl: unknown;
  editorState?: unknown | null;
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

export type WorkflowRunEventRecord = {
  id: string;
  organizationId: string;
  workflowId: string;
  runId: string;
  attemptCount: number;
  eventType: string;
  nodeId: string | null;
  nodeType: string | null;
  level: "info" | "warn" | "error";
  message: string | null;
  payload: unknown;
  createdAt: string;
};

export type ConnectorSecretRecord = {
  id: string;
  organizationId: string;
  connectorId: string;
  name: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationAgentRecord = {
  id: string;
  organizationId: string;
  name: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  capabilities: unknown;
  tags: string[];
  createdByUserId: string;
  createdAt: string;
};

export type OrganizationExecutorRecord = {
  id: string;
  organizationId: string;
  name: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  capabilities: unknown;
  labels: string[];
  createdByUserId: string;
  createdAt: string;
};

export type UserOrgSummaryRecord = {
  organization: OrganizationRecord;
  membership: MembershipRecord;
};

export type OrganizationCreditsRecord = {
  organizationId: string;
  balanceCredits: number;
  updatedAt: string;
};

export type OrganizationCreditLedgerEntryRecord = {
  id: string;
  organizationId: string;
  deltaCredits: number;
  reason: string;
  stripeEventId: string | null;
  workflowRunId: string | null;
  createdByUserId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type AgentPairingTokenRecord = {
  id: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type ExecutorPairingTokenRecord = {
  id: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type AgentToolsetRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  visibility: ToolsetVisibility;
  publicSlug: string | null;
  publishedAt: string | null;
  mcpServers: McpServerConfig[];
  agentSkills: AgentSkillBundle[];
  adoptedFrom?: { toolsetId: string; publicSlug: string | null } | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolsetBuilderSessionRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  status: "ACTIVE" | "FINALIZED" | "ARCHIVED";
  llm: unknown;
  latestIntent: string | null;
  selectedComponentKeys: string[];
  finalDraft: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolsetBuilderTurnRecord = {
  id: number;
  sessionId: string;
  role: "USER" | "ASSISTANT";
  messageText: string;
  createdAt: string;
};

export type AgentSessionRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  status: "active" | "archived";
  pinnedAgentId: string | null;
  selectorTag: string | null;
  selectorGroup: string | null;
  engineId: string;
  toolsetId: string | null;
  llmProvider: string;
  llmModel: string;
  toolsAllow: unknown;
  limits: unknown;
  promptSystem: string | null;
  promptInstructions: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type AgentSessionEventRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  seq: number;
  eventType: string;
  level: "info" | "warn" | "error";
  payload: unknown;
  createdAt: string;
};

export interface AppStore {
  ensureDefaultRoles(): Promise<void>;
  createUser(input: { email: string; passwordHash: string; displayName?: string | null }): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  listOrganizationsForUser(input: { actorUserId: string }): Promise<UserOrgSummaryRecord[]>;
  ensurePersonalOrganizationForUser(input: {
    actorUserId: string;
    trialCredits: number;
  }): Promise<{ defaultOrgId: string; created: boolean }>;
  createOrganizationWithOwner(input: { name: string; slug: string; ownerUserId: string }): Promise<{
    organization: OrganizationRecord;
    membership: MembershipRecord;
  }>;
  getOrganizationSettings(input: { organizationId: string; actorUserId: string }): Promise<OrganizationSettings>;
  updateOrganizationSettings(input: {
    organizationId: string;
    actorUserId: string;
    settings: OrganizationSettings;
  }): Promise<OrganizationSettings>;
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
  createWorkflowDraftFromWorkflow(input: {
    organizationId: string;
    sourceWorkflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null>;
  listWorkflows(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ workflows: WorkflowRecord[]; nextCursor: { createdAt: string; id: string } | null }>;
  listWorkflowRevisions(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
  }): Promise<{ workflows: WorkflowRecord[] }>;
  getWorkflowById(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null>;
  updateWorkflowDraft(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    name?: string | null;
    dsl?: unknown;
    editorState?: unknown;
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
  listWorkflowRuns(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ runs: WorkflowRunRecord[]; nextCursor: { createdAt: string; id: string } | null }>;
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
  appendWorkflowRunEvent(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    attemptCount: number;
    eventType: string;
    nodeId?: string | null;
    nodeType?: string | null;
    level: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }): Promise<WorkflowRunEventRecord>;
  listWorkflowRunEvents(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ events: WorkflowRunEventRecord[]; nextCursor: { createdAt: string; id: string } | null }>;
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

  listConnectorSecrets(input: {
    organizationId: string;
    actorUserId: string;
    connectorId?: string | null;
  }): Promise<ConnectorSecretRecord[]>;
  createConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    connectorId: string;
    name: string;
    value: string;
  }): Promise<ConnectorSecretRecord>;
  loadConnectorSecretValue(input: {
    organizationId: string;
    actorUserId: string;
    secretId: string;
  }): Promise<string>;
  rotateConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    secretId: string;
    value: string;
  }): Promise<ConnectorSecretRecord | null>;
  deleteConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    secretId: string;
  }): Promise<boolean>;

  getOrganizationCredits(input: {
    organizationId: string;
    actorUserId?: string;
  }): Promise<OrganizationCreditsRecord>;
  grantOrganizationCredits(input: {
    organizationId: string;
    actorUserId?: string;
    credits: number;
    reason: string;
    metadata?: unknown;
  }): Promise<OrganizationCreditsRecord>;
  creditOrganizationFromStripeEvent(input: {
    organizationId: string;
    stripeEventId: string;
    credits: number;
    metadata?: unknown;
  }): Promise<{ applied: boolean; balance: OrganizationCreditsRecord }>;

  listOrganizationCreditLedger(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ entries: OrganizationCreditLedgerEntryRecord[]; nextCursor: { createdAt: string; id: string } | null }>;
  getOrganizationBillingAccount(input: { organizationId: string; actorUserId?: string }): Promise<{ stripeCustomerId: string } | null>;
  createOrganizationBillingAccount(input: {
    organizationId: string;
    actorUserId?: string;
    stripeCustomerId: string;
  }): Promise<{ stripeCustomerId: string }>;

  createAgentPairingToken(input: {
    organizationId: string;
    actorUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AgentPairingTokenRecord>;
  getAgentPairingTokenByHash(input: {
    organizationId: string;
    actorUserId?: string;
    tokenHash: string;
  }): Promise<AgentPairingTokenRecord | null>;
  consumeAgentPairingToken(input: {
    organizationId: string;
    tokenHash: string;
  }): Promise<AgentPairingTokenRecord | null>;
  createOrganizationAgent(input: {
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }): Promise<OrganizationAgentRecord>;
  listOrganizationAgents(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<OrganizationAgentRecord[]>;
  setOrganizationAgentTags(input: {
    organizationId: string;
    actorUserId: string;
    agentId: string;
    tags: string[];
  }): Promise<OrganizationAgentRecord | null>;
  revokeOrganizationAgent(input: {
    organizationId: string;
    actorUserId: string;
    agentId: string;
  }): Promise<boolean>;

  createExecutorPairingToken(input: {
    organizationId: string;
    actorUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<ExecutorPairingTokenRecord>;
  getExecutorPairingTokenByHash(input: {
    organizationId: string;
    actorUserId?: string;
    tokenHash: string;
  }): Promise<ExecutorPairingTokenRecord | null>;
  consumeExecutorPairingToken(input: { organizationId: string; tokenHash: string }): Promise<ExecutorPairingTokenRecord | null>;
  createOrganizationExecutor(input: {
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }): Promise<OrganizationExecutorRecord>;
  listOrganizationExecutors(input: { organizationId: string; actorUserId: string }): Promise<OrganizationExecutorRecord[]>;
  setOrganizationExecutorLabels(input: {
    organizationId: string;
    actorUserId: string;
    executorId: string;
    labels: string[];
  }): Promise<OrganizationExecutorRecord | null>;
  revokeOrganizationExecutor(input: {
    organizationId: string;
    actorUserId: string;
    executorId: string;
  }): Promise<boolean>;

  listAgentToolsetsByOrg(input: { organizationId: string; actorUserId: string }): Promise<AgentToolsetRecord[]>;
  createAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org";
    mcpServers: unknown;
    agentSkills: unknown;
  }): Promise<AgentToolsetRecord>;
  getAgentToolsetById(input: { organizationId: string; actorUserId: string; toolsetId: string }): Promise<AgentToolsetRecord | null>;
  updateAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org";
    mcpServers: unknown;
    agentSkills: unknown;
  }): Promise<AgentToolsetRecord | null>;
  deleteAgentToolset(input: { organizationId: string; actorUserId: string; toolsetId: string }): Promise<boolean>;
  publishAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    publicSlug: string;
  }): Promise<AgentToolsetRecord | null>;
  unpublishAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    visibility: "private" | "org";
  }): Promise<AgentToolsetRecord | null>;

  listPublicToolsetGallery(input: { actorUserId: string }): Promise<AgentToolsetRecord[]>;
  getPublicToolsetBySlug(input: { actorUserId: string; publicSlug: string }): Promise<AgentToolsetRecord | null>;
  adoptPublicToolset(input: {
    organizationId: string;
    actorUserId: string;
    publicSlug: string;
    nameOverride?: string | null;
    descriptionOverride?: string | null;
  }): Promise<AgentToolsetRecord | null>;

  createToolsetBuilderSession(input: {
    organizationId: string;
    actorUserId: string;
    llm: unknown;
    latestIntent?: string | null;
  }): Promise<ToolsetBuilderSessionRecord>;
  appendToolsetBuilderTurn(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    role: "USER" | "ASSISTANT";
    messageText: string;
  }): Promise<ToolsetBuilderTurnRecord>;
  listToolsetBuilderTurns(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    limit?: number;
  }): Promise<ToolsetBuilderTurnRecord[]>;
  getToolsetBuilderSessionById(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
  }): Promise<ToolsetBuilderSessionRecord | null>;
  updateToolsetBuilderSessionSelection(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    latestIntent?: string | null;
    selectedComponentKeys: string[];
  }): Promise<ToolsetBuilderSessionRecord | null>;
  finalizeToolsetBuilderSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    selectedComponentKeys: string[];
    finalDraft: unknown;
  }): Promise<ToolsetBuilderSessionRecord | null>;

  createAgentSession(input: {
    organizationId: string;
    actorUserId: string;
    title?: string | null;
    engineId: string;
    toolsetId?: string | null;
    llm: { provider: string; model: string };
    prompt: { system?: string | null; instructions: string };
    tools: { allow: string[] };
    limits?: unknown;
    selector?: { tag?: string; group?: string } | null;
  }): Promise<AgentSessionRecord>;
  listAgentSessions(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { updatedAt: string; id: string } | null;
  }): Promise<{ sessions: AgentSessionRecord[]; nextCursor: { updatedAt: string; id: string } | null }>;
  getAgentSessionById(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
  }): Promise<AgentSessionRecord | null>;
  appendAgentSessionEvent(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    eventType: string;
    level: "info" | "warn" | "error";
    payload?: unknown;
  }): Promise<AgentSessionEventRecord>;
  listAgentSessionEvents(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    limit: number;
    cursor?: { seq: number } | null;
  }): Promise<{ events: AgentSessionEventRecord[]; nextCursor: { seq: number } | null }>;
}
