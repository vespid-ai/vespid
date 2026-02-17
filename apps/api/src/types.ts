import type {
  AgentSkillBundle,
  BindingDimension,
  ChannelId,
  ExecutionMode,
  ExecutorSelectorV1,
  LlmProviderApiKind,
  LlmProviderId,
  MemoryProvider,
  McpServerConfig,
  SessionScope,
  ToolsetVisibility,
} from "@vespid/shared";

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
      primary?: {
        provider?: LlmProviderId | null;
        model?: string | null;
        secretId?: string | null;
      };
    };
    providers?: Partial<Record<LlmProviderId, { baseUrl?: string | null; apiKind?: LlmProviderApiKind | null }>>;
  };
  execution?: {
    quotas?: {
      maxExecutorInFlight?: number;
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
  triggerType: WorkflowRunTriggerType;
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

export type WorkflowRunTriggerType = "manual" | "channel";

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

export type ManagedExecutorRecord = {
  id: string;
  name: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  maxInFlight: number;
  enabled: boolean;
  drain: boolean;
  runtimeClass: string;
  region: string | null;
  capabilities: unknown;
  labels: string[];
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

export type AccountTier = "free" | "paid" | "enterprise";

export type PlatformUserRoleRecord = {
  id: string;
  userId: string;
  roleKey: string;
  grantedByUserId: string | null;
  createdAt: string;
};

export type PlatformSettingRecord = {
  key: string;
  value: unknown;
  updatedByUserId: string | null;
  updatedAt: string;
};

export type UserPaymentEventRecord = {
  id: string;
  provider: string;
  providerEventId: string;
  payerUserId: string | null;
  payerEmail: string | null;
  status: "pending" | "paid" | "failed" | "refunded" | string;
  amount: number | null;
  currency: string | null;
  rawPayload: unknown;
  createdAt: string;
};

export type UserEntitlementRecord = {
  id: string;
  userId: string;
  tier: "paid" | string;
  sourceProvider: string;
  sourceEventId: string;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  createdAt: string;
};

export type SupportTicketRecord = {
  id: string;
  requesterUserId: string | null;
  organizationId: string | null;
  category: string;
  priority: string;
  status: string;
  subject: string;
  content: string;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketEventRecord = {
  id: string;
  ticketId: string;
  actorUserId: string | null;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

export type PlatformAuditLogRecord = {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
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
  sessionKey: string;
  scope: SessionScope | string;
  title: string;
  status: "active" | "archived";
  pinnedExecutorId: string | null;
  pinnedExecutorPool: "managed" | "byon" | null;
  pinnedAgentId: string | null;
  routedAgentId: string | null;
  bindingId: string | null;
  executionMode: ExecutionMode;
  executorSelector: ExecutorSelectorV1 | null;
  selectorTag: string | null;
  selectorGroup: string | null;
  engineId: string;
  toolsetId: string | null;
  llmProvider: string;
  llmModel: string;
  llmSecretId: string | null;
  toolsAllow: unknown;
  limits: unknown;
  promptSystem: string | null;
  promptInstructions: string;
  resetPolicySnapshot: unknown;
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
  handoffFromAgentId: string | null;
  handoffToAgentId: string | null;
  idempotencyKey: string | null;
  payload: unknown;
  createdAt: string;
};

export type AgentBindingRecord = {
  id: string;
  organizationId: string;
  agentId: string;
  priority: number;
  dimension: BindingDimension | string;
  match: unknown;
  metadata: unknown;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentMemoryDocumentRecord = {
  id: string;
  organizationId: string;
  sessionId: string | null;
  sessionKey: string;
  provider: MemoryProvider | string;
  docPath: string;
  contentHash: string;
  lineCount: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AgentMemoryChunkRecord = {
  id: number;
  organizationId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  embedding: unknown;
  metadata: unknown;
  createdAt: string;
};

export type AgentMemorySyncJobRecord = {
  id: string;
  organizationId: string;
  sessionId: string | null;
  sessionKey: string;
  provider: MemoryProvider | string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  reason: string | null;
  details: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChannelAccountRecord = {
  id: string;
  organizationId: string;
  channelId: ChannelId | string;
  accountKey: string;
  displayName: string | null;
  enabled: boolean;
  status: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled" | string;
  groupPolicy: "allowlist" | "open" | "disabled" | string;
  requireMentionInGroup: boolean;
  webhookUrl: string | null;
  metadata: unknown;
  lastError: string | null;
  lastSeenAt: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChannelAccountSecretRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  name: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChannelPairingRequestRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  scope: string;
  requesterId: string;
  requesterDisplayName: string | null;
  code: string;
  status: "pending" | "approved" | "rejected" | string;
  expiresAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
};

export type ChannelAllowlistEntryRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  scope: string;
  subject: string;
  createdByUserId: string;
  createdAt: string;
};

export type ChannelEventRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  conversationId: string | null;
  eventType: string;
  level: "info" | "warn" | "error";
  message: string | null;
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
  listPlatformUserRoles(input?: { roleKey?: string; userId?: string }): Promise<PlatformUserRoleRecord[]>;
  createPlatformUserRole(input: {
    userId: string;
    roleKey: string;
    grantedByUserId?: string | null;
  }): Promise<PlatformUserRoleRecord>;
  deletePlatformUserRole(input: { userId: string; roleKey: string }): Promise<boolean>;
  listPlatformSettings(): Promise<PlatformSettingRecord[]>;
  getPlatformSetting(input: { key: string }): Promise<PlatformSettingRecord | null>;
  upsertPlatformSetting(input: {
    key: string;
    value: unknown;
    updatedByUserId?: string | null;
  }): Promise<PlatformSettingRecord>;
  createUserPaymentEvent(input: {
    provider: string;
    providerEventId: string;
    payerUserId?: string | null;
    payerEmail?: string | null;
    status: string;
    amount?: number | null;
    currency?: string | null;
    rawPayload?: unknown;
  }): Promise<UserPaymentEventRecord>;
  listUserPaymentEvents(input?: { provider?: string; limit?: number }): Promise<UserPaymentEventRecord[]>;
  upsertUserEntitlement(input: {
    userId: string;
    tier: "paid";
    sourceProvider: string;
    sourceEventId: string;
    validFrom?: Date;
    validUntil?: Date | null;
    active?: boolean;
  }): Promise<UserEntitlementRecord>;
  listUserEntitlements(input: { userId: string; activeOnly?: boolean }): Promise<UserEntitlementRecord[]>;
  setUserEntitlementTier(input: {
    userId: string;
    tier: "free" | "paid";
    sourceProvider: string;
    sourceEventId: string;
    actorUserId?: string | null;
  }): Promise<UserEntitlementRecord | null>;
  createSupportTicket(input: {
    requesterUserId?: string | null;
    organizationId?: string | null;
    category?: string;
    priority?: string;
    status?: string;
    subject: string;
    content: string;
    assigneeUserId?: string | null;
  }): Promise<SupportTicketRecord>;
  listSupportTickets(input?: { status?: string; limit?: number }): Promise<SupportTicketRecord[]>;
  getSupportTicketById(input: { ticketId: string }): Promise<SupportTicketRecord | null>;
  patchSupportTicket(input: {
    ticketId: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
  }): Promise<SupportTicketRecord | null>;
  appendSupportTicketEvent(input: {
    ticketId: string;
    actorUserId?: string | null;
    eventType: string;
    payload?: unknown;
  }): Promise<SupportTicketEventRecord>;
  listSupportTicketEvents(input: { ticketId: string; limit?: number }): Promise<SupportTicketEventRecord[]>;
  appendPlatformAuditLog(input: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: unknown;
  }): Promise<PlatformAuditLogRecord>;
  listPlatformAuditLogs(input?: { action?: string; limit?: number }): Promise<PlatformAuditLogRecord[]>;
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
    triggerType: WorkflowRunTriggerType;
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
  createManagedExecutor(input: {
    name: string;
    tokenHash: string;
    maxInFlight?: number;
    labels?: string[];
    capabilities?: unknown;
    enabled?: boolean;
    drain?: boolean;
    runtimeClass?: string;
    region?: string | null;
  }): Promise<ManagedExecutorRecord>;
  revokeManagedExecutor(input: {
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
    sessionKey?: string;
    scope?: SessionScope;
    routedAgentId?: string | null;
    bindingId?: string | null;
    title?: string | null;
    engineId: string;
    toolsetId?: string | null;
    llm: { provider: string; model: string; auth?: { secretId?: string | null } };
    prompt: { system?: string | null; instructions: string };
    tools: { allow: string[] };
    limits?: unknown;
    resetPolicySnapshot?: unknown;
    executorSelector?: ExecutorSelectorV1 | null;
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
    handoffFromAgentId?: string | null;
    handoffToAgentId?: string | null;
    idempotencyKey?: string | null;
    payload?: unknown;
  }): Promise<AgentSessionEventRecord>;
  listAgentSessionEvents(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    limit: number;
    cursor?: { seq: number } | null;
  }): Promise<{ events: AgentSessionEventRecord[]; nextCursor: { seq: number } | null }>;
  setAgentSessionPinnedAgent(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    pinnedAgentId?: string | null;
    pinnedExecutorId?: string | null;
    pinnedExecutorPool?: "managed" | "byon" | null;
  }): Promise<AgentSessionRecord | null>;
  setAgentSessionRoute(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    routedAgentId: string | null;
    bindingId?: string | null;
    sessionKey?: string;
    scope?: SessionScope;
  }): Promise<AgentSessionRecord | null>;
  createAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    agentId: string;
    priority: number;
    dimension: BindingDimension;
    match: unknown;
    metadata?: unknown;
  }): Promise<AgentBindingRecord>;
  listAgentBindings(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<AgentBindingRecord[]>;
  patchAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    bindingId: string;
    patch: {
      agentId?: string;
      priority?: number;
      dimension?: BindingDimension;
      match?: unknown;
      metadata?: unknown;
    };
  }): Promise<AgentBindingRecord | null>;
  deleteAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    bindingId: string;
  }): Promise<boolean>;
  createAgentMemorySyncJob(input: {
    organizationId: string;
    actorUserId: string;
    sessionId?: string | null;
    sessionKey: string;
    provider: MemoryProvider;
    status?: "queued" | "running" | "succeeded" | "failed";
    reason?: string | null;
    details?: unknown;
  }): Promise<AgentMemorySyncJobRecord>;
  listAgentMemoryDocuments(input: {
    organizationId: string;
    actorUserId: string;
    sessionKey?: string;
    limit?: number;
  }): Promise<AgentMemoryDocumentRecord[]>;
  getAgentMemoryDocumentById(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
  }): Promise<AgentMemoryDocumentRecord | null>;
  listAgentMemoryChunksByDocument(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
    limit?: number;
  }): Promise<AgentMemoryChunkRecord[]>;

  listChannelAccounts(input: {
    organizationId: string;
    actorUserId: string;
    channelId?: string | null;
  }): Promise<ChannelAccountRecord[]>;
  createChannelAccount(input: {
    organizationId: string;
    actorUserId: string;
    channelId: string;
    accountKey: string;
    displayName?: string | null;
    enabled?: boolean;
    dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
    groupPolicy?: "allowlist" | "open" | "disabled";
    requireMentionInGroup?: boolean;
    webhookUrl?: string | null;
    metadata?: unknown;
  }): Promise<ChannelAccountRecord>;
  getChannelAccountById(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountRecord | null>;
  updateChannelAccount(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    patch: {
      displayName?: string | null;
      enabled?: boolean;
      dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
      groupPolicy?: "allowlist" | "open" | "disabled";
      requireMentionInGroup?: boolean;
      webhookUrl?: string | null;
      metadata?: unknown;
      status?: string;
      lastError?: string | null;
    };
  }): Promise<ChannelAccountRecord | null>;
  deleteChannelAccount(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<boolean>;
  createChannelAccountSecret(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    name: string;
    value: string;
  }): Promise<ChannelAccountSecretRecord>;
  listChannelAccountSecrets(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountSecretRecord[]>;
  listChannelPairingRequests(input: {
    organizationId: string;
    actorUserId: string;
    accountId?: string | null;
    status?: string | null;
  }): Promise<ChannelPairingRequestRecord[]>;
  listChannelAllowlistEntries(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope?: string | null;
  }): Promise<ChannelAllowlistEntryRecord[]>;
  putChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<ChannelAllowlistEntryRecord>;
  deleteChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<boolean>;
  updateChannelPairingRequestStatus(input: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    status: "approved" | "rejected";
  }): Promise<ChannelPairingRequestRecord | null>;
  listChannelEvents(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    limit?: number;
  }): Promise<ChannelEventRecord[]>;
}
