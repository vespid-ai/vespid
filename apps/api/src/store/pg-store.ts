import {
  createAuthSession,
  createConnectorSecret as dbCreateConnectorSecret,
  createDb,
  createPool,
  createInvitation,
  createOrganizationWithOwner,
  createMembershipIfNotExists,
  createUser,
  getOrganizationById,
  deleteConnectorSecret as dbDeleteConnectorSecret,
  ensureDefaultRoles,
  getAuthSessionById,
  getInvitationByToken,
  getMembership,
  getUserById,
  getUserByEmail,
  getPlatformSetting as dbGetPlatformSetting,
  listConnectorSecrets as dbListConnectorSecrets,
  listPlatformSettings as dbListPlatformSettings,
  listPlatformUserRoles as dbListPlatformUserRoles,
  getConnectorSecretById as dbGetConnectorSecretById,
  markInvitationAccepted,
  revokeAllUserAuthSessions,
  revokeAuthSession,
  rotateAuthSessionRefreshToken,
  touchAuthSession,
  updateMembershipRole,
  updateConnectorSecretValue as dbUpdateConnectorSecretValue,
  createAgentPairingToken as dbCreateAgentPairingToken,
  getAgentPairingTokenByHash as dbGetAgentPairingTokenByHash,
  consumeAgentPairingToken as dbConsumeAgentPairingToken,
  createOrganizationAgent as dbCreateOrganizationAgent,
  listOrganizationAgents as dbListOrganizationAgents,
  setOrganizationAgentTags as dbSetOrganizationAgentTags,
  revokeOrganizationAgent as dbRevokeOrganizationAgent,
  createExecutorPairingToken as dbCreateExecutorPairingToken,
  getExecutorPairingTokenByHash as dbGetExecutorPairingTokenByHash,
  consumeExecutorPairingToken as dbConsumeExecutorPairingToken,
  createOrganizationExecutor as dbCreateOrganizationExecutor,
  createManagedExecutor as dbCreateManagedExecutor,
  listOrganizationExecutors as dbListOrganizationExecutors,
  setOrganizationExecutorLabels as dbSetOrganizationExecutorLabels,
  revokeOrganizationExecutor as dbRevokeOrganizationExecutor,
  revokeManagedExecutor as dbRevokeManagedExecutor,
  createAgentToolset as dbCreateAgentToolset,
  listAgentToolsetsByOrg as dbListAgentToolsetsByOrg,
  getAgentToolsetById as dbGetAgentToolsetById,
  updateAgentToolset as dbUpdateAgentToolset,
  deleteAgentToolset as dbDeleteAgentToolset,
  publishAgentToolset as dbPublishAgentToolset,
  unpublishAgentToolset as dbUnpublishAgentToolset,
  listPublicAgentToolsets as dbListPublicAgentToolsets,
  getPublicAgentToolsetBySlug as dbGetPublicAgentToolsetBySlug,
  adoptPublicAgentToolset as dbAdoptPublicAgentToolset,
  createAgentSession as dbCreateAgentSession,
  getAgentSessionById as dbGetAgentSessionById,
  listAgentSessions as dbListAgentSessions,
  setAgentSessionPinnedAgent as dbSetAgentSessionPinnedAgent,
  setAgentSessionRoute as dbSetAgentSessionRoute,
  appendAgentSessionEvent as dbAppendAgentSessionEvent,
  listAgentSessionEvents as dbListAgentSessionEvents,
  createAgentBinding as dbCreateAgentBinding,
  listAgentBindings as dbListAgentBindings,
  patchAgentBinding as dbPatchAgentBinding,
  deleteAgentBinding as dbDeleteAgentBinding,
  createAgentMemorySyncJob as dbCreateAgentMemorySyncJob,
  listAgentMemoryDocuments as dbListAgentMemoryDocuments,
  getAgentMemoryDocumentById as dbGetAgentMemoryDocumentById,
  listAgentMemoryChunksByDocument as dbListAgentMemoryChunksByDocument,
  createToolsetBuilderSession as dbCreateToolsetBuilderSession,
  appendToolsetBuilderTurn as dbAppendToolsetBuilderTurn,
  getToolsetBuilderSessionById as dbGetToolsetBuilderSessionById,
  updateToolsetBuilderSessionSelection as dbUpdateToolsetBuilderSessionSelection,
  finalizeToolsetBuilderSession as dbFinalizeToolsetBuilderSession,
  listToolsetBuilderTurnsBySession as dbListToolsetBuilderTurnsBySession,
  withTenantContext,
  createWorkflow as dbCreateWorkflow,
  createWorkflowDraftFromWorkflow as dbCreateWorkflowDraftFromWorkflow,
  listWorkflows as dbListWorkflows,
  listWorkflowRevisions as dbListWorkflowRevisions,
  getWorkflowById as dbGetWorkflowById,
  updateWorkflowDraft as dbUpdateWorkflowDraft,
  publishWorkflow as dbPublishWorkflow,
  createWorkflowRun as dbCreateWorkflowRun,
  deleteQueuedWorkflowRun as dbDeleteQueuedWorkflowRun,
  listWorkflowRuns as dbListWorkflowRuns,
  getWorkflowRunById as dbGetWorkflowRunById,
  appendWorkflowRunEvent as dbAppendWorkflowRunEvent,
  listWorkflowRunEvents as dbListWorkflowRunEvents,
  markWorkflowRunRunning as dbMarkWorkflowRunRunning,
  markWorkflowRunQueuedForRetry as dbMarkWorkflowRunQueuedForRetry,
  markWorkflowRunSucceeded as dbMarkWorkflowRunSucceeded,
  markWorkflowRunFailed as dbMarkWorkflowRunFailed,
  updateOrganizationSettings as dbUpdateOrganizationSettings,
  listOrganizationsForUser as dbListOrganizationsForUser,
  createPlatformUserRole as dbCreatePlatformUserRole,
  createSupportTicket as dbCreateSupportTicket,
  createChannelAccount as dbCreateChannelAccount,
  listChannelAccountsByOrg as dbListChannelAccountsByOrg,
  getChannelAccountById as dbGetChannelAccountById,
  updateChannelAccount as dbUpdateChannelAccount,
  deleteChannelAccount as dbDeleteChannelAccount,
  createChannelAccountSecret as dbCreateChannelAccountSecret,
  listChannelAccountSecrets as dbListChannelAccountSecrets,
  listChannelAllowlistEntries as dbListChannelAllowlistEntries,
  putChannelAllowlistEntry as dbPutChannelAllowlistEntry,
  deleteChannelAllowlistEntry as dbDeleteChannelAllowlistEntry,
  listChannelPairingRequests as dbListChannelPairingRequests,
  updateChannelPairingRequestStatus as dbUpdateChannelPairingRequestStatus,
  listChannelEvents as dbListChannelEvents,
  listPlatformAuditLogs as dbListPlatformAuditLogs,
  listSupportTicketEvents as dbListSupportTicketEvents,
  listSupportTickets as dbListSupportTickets,
  appendPlatformAuditLog as dbAppendPlatformAuditLog,
  appendSupportTicketEvent as dbAppendSupportTicketEvent,
  deletePlatformUserRole as dbDeletePlatformUserRole,
  getSupportTicketById as dbGetSupportTicketById,
  patchSupportTicket as dbPatchSupportTicket,
  upsertPlatformSetting as dbUpsertPlatformSetting,
} from "@vespid/db";
import crypto from "node:crypto";
import { decryptSecret, encryptSecret, parseKekFromEnv } from "@vespid/shared/secrets";
import type {
  AgentBindingRecord,
  AgentMemoryChunkRecord,
  AgentMemoryDocumentRecord,
  AgentMemorySyncJobRecord,
  AgentSessionEventRecord,
  AgentSessionRecord,
  AgentToolsetRecord,
  AppStore,
  ChannelAccountRecord,
  ChannelAccountSecretRecord,
  ChannelAllowlistEntryRecord,
  ChannelEventRecord,
  ChannelPairingRequestRecord,
  PlatformAuditLogRecord,
  PlatformSettingRecord,
  PlatformUserRoleRecord,
  SupportTicketEventRecord,
  SupportTicketRecord,
  ExecutorPairingTokenRecord,
  OrganizationExecutorRecord,
  OrganizationSettings,
  ManagedExecutorRecord,
  ToolsetBuilderSessionRecord,
  ToolsetBuilderTurnRecord,
  UserOrgSummaryRecord,
} from "../types.js";

function toIso(value: Date): string {
  return value.toISOString();
}

function toWorkflowRunTriggerType(value: unknown): "manual" | "channel" {
  return value === "channel" ? "channel" : "manual";
}

export class PgAppStore implements AppStore {
  private readonly pool: ReturnType<typeof createPool>;

  constructor(databaseUrl?: string) {
    this.pool = createPool(databaseUrl);
  }

  private db() {
    return createDb(this.pool);
  }

  private async withOrgContext<T>(
    input: { userId?: string; organizationId: string },
    fn: (db: ReturnType<typeof createDb>) => Promise<T>
  ): Promise<T> {
    return withTenantContext(this.pool, input, async (db) => fn(db));
  }

  private async withUserContext<T>(
    input: { userId: string },
    fn: (db: ReturnType<typeof createDb>) => Promise<T>
  ): Promise<T> {
    return withTenantContext(this.pool, { userId: input.userId }, async (db) => fn(db));
  }

  private async withPublicContext<T>(input: { userId: string }, fn: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
    // No org context; RLS policies must explicitly allow any needed SELECTs (e.g. public toolsets).
    return withTenantContext(this.pool, { userId: input.userId }, async (db) => fn(db));
  }

  private toToolsetRecord(row: any): AgentToolsetRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description ?? null,
      visibility: row.visibility,
      publicSlug: row.publicSlug ?? null,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      mcpServers: Array.isArray(row.mcpServers) ? row.mcpServers : (row.mcpServers ?? []),
      agentSkills: Array.isArray(row.agentSkills) ? row.agentSkills : (row.agentSkills ?? []),
      adoptedFrom: (row.adoptedFrom ?? null) as any,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toToolsetBuilderSessionRecord(row: any): ToolsetBuilderSessionRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      createdByUserId: row.createdByUserId,
      status: row.status,
      llm: row.llm,
      latestIntent: row.latestIntent ?? null,
      selectedComponentKeys: Array.isArray(row.selectedComponentKeys) ? row.selectedComponentKeys : (row.selectedComponentKeys ?? []),
      finalDraft: row.finalDraft ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toToolsetBuilderTurnRecord(row: any): ToolsetBuilderTurnRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      messageText: row.messageText,
      createdAt: toIso(row.createdAt),
    };
  }

  private toAgentSessionRecord(row: any): AgentSessionRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      createdByUserId: row.createdByUserId,
      sessionKey: row.sessionKey ?? "",
      scope: row.scope ?? "main",
      title: row.title ?? "",
      status: row.status === "archived" ? "archived" : "active",
      pinnedExecutorId: row.pinnedExecutorId ?? null,
      pinnedExecutorPool: row.pinnedExecutorPool ?? null,
      pinnedAgentId: row.pinnedAgentId ?? null,
      routedAgentId: row.routedAgentId ?? null,
      bindingId: row.bindingId ?? null,
      executionMode: "pinned-node-host",
      executorSelector: (row.executorSelector as any) ?? null,
      selectorTag: row.selectorTag ?? null,
      selectorGroup: row.selectorGroup ?? null,
      engineId: row.engineId,
      toolsetId: row.toolsetId ?? null,
      llmProvider: row.llmProvider,
      llmModel: row.llmModel,
      llmSecretId: row.llmSecretId ?? null,
      toolsAllow: row.toolsAllow ?? [],
      limits: row.limits ?? {},
      promptSystem: row.promptSystem ?? null,
      promptInstructions: row.promptInstructions ?? "",
      resetPolicySnapshot: row.resetPolicySnapshot ?? {},
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      lastActivityAt: toIso(row.lastActivityAt),
    };
  }

  private toAgentSessionEventRecord(row: any): AgentSessionEventRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      seq: row.seq,
      eventType: row.eventType,
      level: row.level,
      handoffFromAgentId: row.handoffFromAgentId ?? null,
      handoffToAgentId: row.handoffToAgentId ?? null,
      idempotencyKey: row.idempotencyKey ?? null,
      payload: row.payload ?? null,
      createdAt: toIso(row.createdAt),
    };
  }

  private toAgentBindingRecord(row: any): AgentBindingRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      agentId: row.agentId,
      priority: row.priority ?? 0,
      dimension: row.dimension,
      match: row.match ?? {},
      metadata: row.metadata ?? null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toAgentMemoryDocumentRecord(row: any): AgentMemoryDocumentRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId ?? null,
      sessionKey: row.sessionKey ?? "",
      provider: row.provider ?? "builtin",
      docPath: row.docPath,
      contentHash: row.contentHash,
      lineCount: row.lineCount ?? 0,
      metadata: row.metadata ?? {},
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toAgentMemoryChunkRecord(row: any): AgentMemoryChunkRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      documentId: row.documentId,
      chunkIndex: row.chunkIndex,
      text: row.text,
      tokenCount: row.tokenCount ?? 0,
      embedding: row.embedding ?? null,
      metadata: row.metadata ?? {},
      createdAt: toIso(row.createdAt),
    };
  }

  private toAgentMemorySyncJobRecord(row: any): AgentMemorySyncJobRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId ?? null,
      sessionKey: row.sessionKey ?? "",
      provider: row.provider ?? "builtin",
      status: row.status ?? "queued",
      reason: row.reason ?? null,
      details: row.details ?? {},
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toChannelAccountRecord(row: any): ChannelAccountRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      channelId: row.channelId,
      accountKey: row.accountKey,
      displayName: row.displayName ?? null,
      enabled: Boolean(row.enabled),
      status: row.status,
      dmPolicy: row.dmPolicy,
      groupPolicy: row.groupPolicy,
      requireMentionInGroup: Boolean(row.requireMentionInGroup),
      webhookUrl: row.webhookUrl ?? null,
      metadata: row.metadata ?? {},
      lastError: row.lastError ?? null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toChannelAccountSecretRecord(row: any): ChannelAccountSecretRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  private toChannelPairingRequestRecord(row: any): ChannelPairingRequestRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      scope: row.scope,
      requesterId: row.requesterId,
      requesterDisplayName: row.requesterDisplayName ?? null,
      code: row.code,
      status: row.status,
      expiresAt: toIso(row.expiresAt),
      approvedByUserId: row.approvedByUserId ?? null,
      approvedAt: row.approvedAt ? toIso(row.approvedAt) : null,
      rejectedAt: row.rejectedAt ? toIso(row.rejectedAt) : null,
      createdAt: toIso(row.createdAt),
    };
  }

  private toChannelAllowlistEntryRecord(row: any): ChannelAllowlistEntryRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      scope: row.scope,
      subject: row.subject,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  private toChannelEventRecord(row: any): ChannelEventRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      conversationId: row.conversationId ?? null,
      eventType: row.eventType,
      level: row.level,
      message: row.message ?? null,
      payload: row.payload ?? null,
      createdAt: toIso(row.createdAt),
    };
  }

  async ensureDefaultRoles(): Promise<void> {
    await ensureDefaultRoles(this.db());
  }

  async createUser(input: { email: string; passwordHash: string; displayName?: string | null }) {
    const row = await createUser(this.db(), input);
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      createdAt: toIso(row.createdAt),
    };
  }

  async getUserByEmail(email: string) {
    const row = await getUserByEmail(this.db(), email);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      createdAt: toIso(row.createdAt),
    };
  }

  async getUserById(id: string) {
    const row = await getUserById(this.db(), id);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      createdAt: toIso(row.createdAt),
    };
  }

  async listOrganizationsForUser(input: { actorUserId: string }): Promise<UserOrgSummaryRecord[]> {
    const rows = await this.withUserContext({ userId: input.actorUserId }, async (db) =>
      dbListOrganizationsForUser(db, { userId: input.actorUserId })
    );

    return rows.map((row) => ({
      organization: {
        id: row.organization.id,
        slug: row.organization.slug,
        name: row.organization.name,
        createdAt: toIso(row.organization.createdAt),
      },
      membership: {
        id: row.membership.id,
        organizationId: row.membership.organizationId,
        userId: row.membership.userId,
        roleKey: row.membership.roleKey as any,
        createdAt: toIso(row.membership.createdAt),
      },
    }));
  }

  async ensurePersonalOrganizationForUser(input: { actorUserId: string }): Promise<{ defaultOrgId: string; created: boolean }> {
    const existing = await this.listOrganizationsForUser({ actorUserId: input.actorUserId });
    if (existing.length > 0) {
      return { defaultOrgId: existing[0]!.organization.id, created: false };
    }

    const organizationId = crypto.randomUUID();
    const baseSlug = `personal-${input.actorUserId.slice(0, 8)}`;
    const name = "Personal workspace";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomBytes(3).toString("hex")}`;
      try {
        await this.withOrgContext({ userId: input.actorUserId, organizationId }, async (db) =>
          createOrganizationWithOwner(db, {
            id: organizationId,
            name,
            slug,
            ownerUserId: input.actorUserId,
          })
        );

        return { defaultOrgId: organizationId, created: true };
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error("Failed to create personal organization");
  }

  async listPlatformUserRoles(input?: { roleKey?: string; userId?: string }): Promise<PlatformUserRoleRecord[]> {
    const rows = await this.withUserContext({ userId: input?.userId ?? crypto.randomUUID() }, async (db) =>
      dbListPlatformUserRoles(db, input)
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      roleKey: row.roleKey,
      grantedByUserId: row.grantedByUserId ?? null,
      createdAt: toIso(row.createdAt),
    }));
  }

  async createPlatformUserRole(input: {
    userId: string;
    roleKey: string;
    grantedByUserId?: string | null;
  }): Promise<PlatformUserRoleRecord> {
    const row = await this.withUserContext({ userId: input.grantedByUserId ?? input.userId }, async (db) =>
      dbCreatePlatformUserRole(db, input)
    );
    return {
      id: row.id,
      userId: row.userId,
      roleKey: row.roleKey,
      grantedByUserId: row.grantedByUserId ?? null,
      createdAt: toIso(row.createdAt),
    };
  }

  async deletePlatformUserRole(input: { userId: string; roleKey: string }): Promise<boolean> {
    return this.withUserContext({ userId: input.userId }, async (db) => dbDeletePlatformUserRole(db, input));
  }

  async listPlatformSettings(): Promise<PlatformSettingRecord[]> {
    const rows = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbListPlatformSettings(db));
    return rows.map((row) => ({
      key: row.key,
      value: row.value ?? {},
      updatedByUserId: row.updatedByUserId ?? null,
      updatedAt: toIso(row.updatedAt),
    }));
  }

  async getPlatformSetting(input: { key: string }): Promise<PlatformSettingRecord | null> {
    const row = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbGetPlatformSetting(db, input));
    if (!row) {
      return null;
    }
    return {
      key: row.key,
      value: row.value ?? {},
      updatedByUserId: row.updatedByUserId ?? null,
      updatedAt: toIso(row.updatedAt),
    };
  }

  async upsertPlatformSetting(input: {
    key: string;
    value: unknown;
    updatedByUserId?: string | null;
  }): Promise<PlatformSettingRecord> {
    const row = await this.withUserContext({ userId: input.updatedByUserId ?? crypto.randomUUID() }, async (db) =>
      dbUpsertPlatformSetting(db, input)
    );
    return {
      key: row.key,
      value: row.value ?? {},
      updatedByUserId: row.updatedByUserId ?? null,
      updatedAt: toIso(row.updatedAt),
    };
  }

  async createSupportTicket(input: {
    requesterUserId?: string | null;
    organizationId?: string | null;
    category?: string;
    priority?: string;
    status?: string;
    subject: string;
    content: string;
    assigneeUserId?: string | null;
  }): Promise<SupportTicketRecord> {
    const row = await this.withUserContext({ userId: input.requesterUserId ?? crypto.randomUUID() }, async (db) =>
      dbCreateSupportTicket(db, input)
    );
    return {
      id: row.id,
      requesterUserId: row.requesterUserId ?? null,
      organizationId: row.organizationId ?? null,
      category: row.category,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      content: row.content,
      assigneeUserId: row.assigneeUserId ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async listSupportTickets(input?: { status?: string; limit?: number }): Promise<SupportTicketRecord[]> {
    const rows = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbListSupportTickets(db, input));
    return rows.map((row) => ({
      id: row.id,
      requesterUserId: row.requesterUserId ?? null,
      organizationId: row.organizationId ?? null,
      category: row.category,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      content: row.content,
      assigneeUserId: row.assigneeUserId ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    }));
  }

  async getSupportTicketById(input: { ticketId: string }): Promise<SupportTicketRecord | null> {
    const row = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbGetSupportTicketById(db, input));
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      requesterUserId: row.requesterUserId ?? null,
      organizationId: row.organizationId ?? null,
      category: row.category,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      content: row.content,
      assigneeUserId: row.assigneeUserId ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async patchSupportTicket(input: {
    ticketId: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
  }): Promise<SupportTicketRecord | null> {
    const row = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbPatchSupportTicket(db, input));
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      requesterUserId: row.requesterUserId ?? null,
      organizationId: row.organizationId ?? null,
      category: row.category,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      content: row.content,
      assigneeUserId: row.assigneeUserId ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async appendSupportTicketEvent(input: {
    ticketId: string;
    actorUserId?: string | null;
    eventType: string;
    payload?: unknown;
  }): Promise<SupportTicketEventRecord> {
    const row = await this.withUserContext({ userId: input.actorUserId ?? crypto.randomUUID() }, async (db) =>
      dbAppendSupportTicketEvent(db, input)
    );
    return {
      id: row.id,
      ticketId: row.ticketId,
      actorUserId: row.actorUserId ?? null,
      eventType: row.eventType,
      payload: row.payload ?? {},
      createdAt: toIso(row.createdAt),
    };
  }

  async listSupportTicketEvents(input: { ticketId: string; limit?: number }): Promise<SupportTicketEventRecord[]> {
    const rows = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbListSupportTicketEvents(db, input));
    return rows.map((row) => ({
      id: row.id,
      ticketId: row.ticketId,
      actorUserId: row.actorUserId ?? null,
      eventType: row.eventType,
      payload: row.payload ?? {},
      createdAt: toIso(row.createdAt),
    }));
  }

  async appendPlatformAuditLog(input: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: unknown;
  }): Promise<PlatformAuditLogRecord> {
    const row = await this.withUserContext({ userId: input.actorUserId ?? crypto.randomUUID() }, async (db) =>
      dbAppendPlatformAuditLog(db, input)
    );
    return {
      id: row.id,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      metadata: row.metadata ?? {},
      createdAt: toIso(row.createdAt),
    };
  }

  async listPlatformAuditLogs(input?: { action?: string; limit?: number }): Promise<PlatformAuditLogRecord[]> {
    const rows = await this.withUserContext({ userId: crypto.randomUUID() }, async (db) => dbListPlatformAuditLogs(db, input));
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      metadata: row.metadata ?? {},
      createdAt: toIso(row.createdAt),
    }));
  }

  async createOrganizationWithOwner(input: { name: string; slug: string; ownerUserId: string }) {
    const organizationId = crypto.randomUUID();
    const { organization, membership } = await this.withOrgContext(
      { userId: input.ownerUserId, organizationId },
      async (db) =>
        createOrganizationWithOwner(db, {
          id: organizationId,
          name: input.name,
          slug: input.slug,
          ownerUserId: input.ownerUserId,
        })
    );
    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        createdAt: toIso(organization.createdAt),
      },
      membership: {
        id: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        roleKey: membership.roleKey as "owner" | "admin" | "member",
        createdAt: toIso(membership.createdAt),
      },
    };
  }

  async getOrganizationSettings(input: { organizationId: string; actorUserId: string }): Promise<OrganizationSettings> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => getOrganizationById(db, { organizationId: input.organizationId })
    );
    if (!row) {
      throw new Error("ORGANIZATION_NOT_FOUND");
    }
    return (row.settings ?? {}) as OrganizationSettings;
  }

  async updateOrganizationSettings(input: {
    organizationId: string;
    actorUserId: string;
    settings: OrganizationSettings;
  }): Promise<OrganizationSettings> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbUpdateOrganizationSettings(db, { organizationId: input.organizationId, settings: input.settings })
    );
    if (!row) {
      throw new Error("ORGANIZATION_NOT_FOUND");
    }
    return (row.settings ?? {}) as OrganizationSettings;
  }

  async getMembership(input: { organizationId: string; userId: string; actorUserId?: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId ?? input.userId, organizationId: input.organizationId },
      async (db) => getMembership(db, { organizationId: input.organizationId, userId: input.userId })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      roleKey: row.roleKey as "owner" | "admin" | "member",
      createdAt: toIso(row.createdAt),
    };
  }

  async createInvitation(input: {
    organizationId: string;
    email: string;
    roleKey: "admin" | "member";
    invitedByUserId: string;
    ttlHours?: number;
  }) {
    const row = await this.withOrgContext(
      { userId: input.invitedByUserId, organizationId: input.organizationId },
      async (db) => createInvitation(db, input)
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      roleKey: row.roleKey as "admin" | "member",
      invitedByUserId: row.invitedByUserId,
      token: row.token,
      status: row.status as "pending" | "accepted" | "expired" | "revoked",
      expiresAt: toIso(row.expiresAt),
      createdAt: toIso(row.createdAt),
    };
  }

  async getInvitationByToken(input: { organizationId: string; token: string; actorUserId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => getInvitationByToken(db, input.token)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      roleKey: row.roleKey as "admin" | "member",
      invitedByUserId: row.invitedByUserId,
      token: row.token,
      status: row.status as "pending" | "accepted" | "expired" | "revoked",
      expiresAt: toIso(row.expiresAt),
      createdAt: toIso(row.createdAt),
    };
  }

  async acceptInvitation(input: { organizationId: string; token: string; userId: string; email: string }) {
    return this.withOrgContext({ userId: input.userId, organizationId: input.organizationId }, async (db) => {
      const invitation = await getInvitationByToken(db, input.token);
      if (!invitation) {
        throw new Error("INVITATION_NOT_FOUND");
      }

      if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
        throw new Error("INVITATION_EMAIL_MISMATCH");
      }

      if (invitation.expiresAt.getTime() <= Date.now()) {
        throw new Error("INVITATION_EXPIRED");
      }

      const membership = await createMembershipIfNotExists(db, {
        organizationId: invitation.organizationId,
        userId: input.userId,
        roleKey: invitation.roleKey as "owner" | "admin" | "member",
      });

      if (invitation.status === "pending") {
        const updated = await markInvitationAccepted(db, invitation.id);
        if (!updated) {
          throw new Error("INVITATION_ACCEPT_FAILED");
        }
      } else if (invitation.status !== "accepted") {
        throw new Error("INVITATION_NOT_PENDING");
      }

      return {
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        membershipId: membership.id,
        accepted: true,
      };
    });
  }

  async updateMembershipRole(input: {
    organizationId: string;
    actorUserId: string;
    memberUserId: string;
    roleKey: "owner" | "admin" | "member";
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        updateMembershipRole(db, {
          organizationId: input.organizationId,
          memberUserId: input.memberUserId,
          roleKey: input.roleKey,
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      roleKey: row.roleKey as "owner" | "admin" | "member",
      createdAt: toIso(row.createdAt),
    };
  }

  async createSession(input: {
    id?: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    const row = await this.withUserContext({ userId: input.userId }, async (db) => createAuthSession(db, input));
    return {
      id: row.id,
      userId: row.userId,
      refreshTokenHash: row.refreshTokenHash,
      expiresAt: toIso(row.expiresAt),
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: toIso(row.createdAt),
      lastUsedAt: toIso(row.lastUsedAt),
    };
  }

  async getSessionById(input: { userId: string; sessionId: string }) {
    const row = await this.withUserContext({ userId: input.userId }, async (db) => getAuthSessionById(db, input.sessionId));
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      refreshTokenHash: row.refreshTokenHash,
      expiresAt: toIso(row.expiresAt),
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: toIso(row.createdAt),
      lastUsedAt: toIso(row.lastUsedAt),
    };
  }

  async rotateSessionRefreshToken(input: { userId: string; sessionId: string; refreshTokenHash: string; expiresAt: Date }) {
    const row = await this.withUserContext(
      { userId: input.userId },
      async (db) =>
        rotateAuthSessionRefreshToken(db, {
          sessionId: input.sessionId,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      refreshTokenHash: row.refreshTokenHash,
      expiresAt: toIso(row.expiresAt),
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: toIso(row.createdAt),
      lastUsedAt: toIso(row.lastUsedAt),
    };
  }

  async revokeSession(input: { userId: string; sessionId: string }) {
    const row = await this.withUserContext({ userId: input.userId }, async (db) => revokeAuthSession(db, input.sessionId));
    return Boolean(row);
  }

  async revokeAllSessionsForUser(userId: string) {
    const rows = await this.withUserContext({ userId }, async (db) => revokeAllUserAuthSessions(db, userId));
    return rows.length;
  }

  async touchSession(input: { userId: string; sessionId: string }) {
    await this.withUserContext({ userId: input.userId }, async (db) => {
      await touchAuthSession(db, input.sessionId);
    });
  }

  async createWorkflow(input: {
    organizationId: string;
    name: string;
    dsl: unknown;
    createdByUserId: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.createdByUserId, organizationId: input.organizationId },
      async (db) => dbCreateWorkflow(db, input)
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      familyId: (row as any).familyId,
      revision: (row as any).revision,
      sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
      name: row.name,
      status: row.status as "draft" | "published",
      version: row.version,
      dsl: row.dsl,
      editorState: (row as any).editorState ?? null,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async createWorkflowDraftFromWorkflow(input: {
    organizationId: string;
    sourceWorkflowId: string;
    actorUserId: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateWorkflowDraftFromWorkflow(db, {
          organizationId: input.organizationId,
          sourceWorkflowId: input.sourceWorkflowId,
          createdByUserId: input.actorUserId,
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      familyId: (row as any).familyId,
      revision: (row as any).revision,
      sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
      name: row.name,
      status: row.status as "draft" | "published",
      version: row.version,
      dsl: row.dsl,
      editorState: (row as any).editorState ?? null,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async listWorkflows(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }) {
    const cursor = input.cursor
      ? {
          createdAt: new Date(input.cursor.createdAt),
          id: input.cursor.id,
        }
      : null;

    const result = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListWorkflows(db, {
          organizationId: input.organizationId,
          limit: input.limit,
          cursor,
        })
    );

    return {
      workflows: result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        familyId: (row as any).familyId,
        revision: (row as any).revision,
        sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
        name: row.name,
        status: row.status as "draft" | "published",
        version: row.version,
        dsl: row.dsl,
        editorState: (row as any).editorState ?? null,
        createdByUserId: row.createdByUserId,
        publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      nextCursor: result.nextCursor
        ? { createdAt: toIso(result.nextCursor.createdAt), id: result.nextCursor.id }
        : null,
    };
  }

  async listWorkflowRevisions(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
  }) {
    const existing = await this.getWorkflowById({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      actorUserId: input.actorUserId,
    });
    if (!existing) {
      return { workflows: [] };
    }

    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListWorkflowRevisions(db, {
          organizationId: input.organizationId,
          familyId: existing.familyId,
          limit: input.limit,
        })
    );

    return {
      workflows: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        familyId: (row as any).familyId,
        revision: (row as any).revision,
        sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
        name: row.name,
        status: row.status as "draft" | "published",
        version: row.version,
        dsl: row.dsl,
        editorState: (row as any).editorState ?? null,
        createdByUserId: row.createdByUserId,
        publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
    };
  }

  async getWorkflowById(input: { organizationId: string; workflowId: string; actorUserId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetWorkflowById(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      familyId: (row as any).familyId,
      revision: (row as any).revision,
      sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
      name: row.name,
      status: row.status as "draft" | "published",
      version: row.version,
      dsl: row.dsl,
      editorState: (row as any).editorState ?? null,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async updateWorkflowDraft(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    name?: string | null;
    dsl?: unknown;
    editorState?: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUpdateWorkflowDraft(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.dsl !== undefined ? { dsl: input.dsl } : {}),
          ...(input.editorState !== undefined ? { editorState: input.editorState } : {}),
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      familyId: (row as any).familyId,
      revision: (row as any).revision,
      sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
      name: row.name,
      status: row.status as "draft" | "published",
      version: row.version,
      dsl: row.dsl,
      editorState: (row as any).editorState ?? null,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async publishWorkflow(input: { organizationId: string; workflowId: string; actorUserId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbPublishWorkflow(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      familyId: (row as any).familyId,
      revision: (row as any).revision,
      sourceWorkflowId: ((row as any).sourceWorkflowId ?? null) as string | null,
      name: row.name,
      status: row.status as "draft" | "published",
      version: row.version,
      dsl: row.dsl,
      createdByUserId: row.createdByUserId,
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async createWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    triggerType: "manual" | "channel";
    requestedByUserId: string;
    input?: unknown;
    maxAttempts?: number;
  }) {
    const row = await this.withOrgContext(
      { userId: input.requestedByUserId, organizationId: input.organizationId },
      async (db) => dbCreateWorkflowRun(db, input)
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async listWorkflowRuns(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }) {
    const cursor = input.cursor
      ? {
          createdAt: new Date(input.cursor.createdAt),
          id: input.cursor.id,
        }
      : null;

    const result = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListWorkflowRuns(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          limit: input.limit,
          cursor,
        })
    );

    return {
      runs: result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        workflowId: row.workflowId,
        triggerType: toWorkflowRunTriggerType(row.triggerType),
        status: row.status as "queued" | "running" | "succeeded" | "failed",
        attemptCount: row.attemptCount,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
        requestedByUserId: row.requestedByUserId,
        input: row.input,
        output: row.output,
        error: row.error,
        createdAt: toIso(row.createdAt),
        startedAt: row.startedAt ? toIso(row.startedAt) : null,
        finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
      })),
      nextCursor: result.nextCursor ? { createdAt: toIso(result.nextCursor.createdAt), id: result.nextCursor.id } : null,
    };
  }

  async getWorkflowRunById(input: { organizationId: string; workflowId: string; runId: string; actorUserId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetWorkflowRunById(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async appendWorkflowRunEvent(input: {
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
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbAppendWorkflowRunEvent(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          runId: input.runId,
          attemptCount: input.attemptCount,
          eventType: input.eventType,
          nodeId: input.nodeId ?? null,
          nodeType: input.nodeType ?? null,
          level: input.level,
          message: input.message ?? null,
          payload: input.payload ?? null,
        })
    );

    if (!row) {
      throw new Error("Failed to append workflow run event");
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      runId: row.runId,
      attemptCount: row.attemptCount,
      eventType: row.eventType,
      nodeId: row.nodeId ?? null,
      nodeType: row.nodeType ?? null,
      level: row.level as "info" | "warn" | "error",
      message: row.message ?? null,
      payload: row.payload,
      createdAt: toIso(row.createdAt),
    };
  }

  async listWorkflowRunEvents(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }) {
    const cursor = input.cursor
      ? {
          createdAt: new Date(input.cursor.createdAt),
          id: input.cursor.id,
        }
      : null;

    const result = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListWorkflowRunEvents(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          runId: input.runId,
          limit: input.limit,
          cursor,
        })
    );

    return {
      events: result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        workflowId: row.workflowId,
        runId: row.runId,
        attemptCount: row.attemptCount,
        eventType: row.eventType,
        nodeId: row.nodeId ?? null,
        nodeType: row.nodeType ?? null,
        level: row.level as "info" | "warn" | "error",
        message: row.message ?? null,
        payload: row.payload,
        createdAt: toIso(row.createdAt),
      })),
      nextCursor: result.nextCursor ? { createdAt: toIso(result.nextCursor.createdAt), id: result.nextCursor.id } : null,
    };
  }

  async deleteQueuedWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbDeleteQueuedWorkflowRun(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          runId: input.runId,
        })
    );
    return Boolean(row);
  }

  async markWorkflowRunRunning(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    attemptCount?: number;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbMarkWorkflowRunRunning(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async markWorkflowRunQueuedForRetry(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbMarkWorkflowRunQueuedForRetry(db, {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          runId: input.runId,
          error: input.error,
          nextAttemptAt: null,
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async markWorkflowRunSucceeded(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    output: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbMarkWorkflowRunSucceeded(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async markWorkflowRunFailed(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbMarkWorkflowRunFailed(db, input)
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowId: row.workflowId,
      triggerType: toWorkflowRunTriggerType(row.triggerType),
      status: row.status as "queued" | "running" | "succeeded" | "failed",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt ? toIso(row.nextAttemptAt) : null,
      requestedByUserId: row.requestedByUserId,
      input: row.input,
      output: row.output,
      error: row.error,
      createdAt: toIso(row.createdAt),
      startedAt: row.startedAt ? toIso(row.startedAt) : null,
      finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    };
  }

  async listConnectorSecrets(input: { organizationId: string; actorUserId: string; connectorId?: string | null }) {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListConnectorSecrets(db, {
          organizationId: input.organizationId,
          connectorId: input.connectorId ?? null,
        })
    );

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      connectorId: row.connectorId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    }));
  }

  async createConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    connectorId: string;
    name: string;
    value: string;
  }) {
    const kek = parseKekFromEnv();
    const encrypted = encryptSecret({ plaintext: input.value, kek });

    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateConnectorSecret(db, {
          organizationId: input.organizationId,
          connectorId: input.connectorId,
          name: input.name,
          kekId: encrypted.kekId,
          dekCiphertext: encrypted.dekCiphertext,
          dekIv: encrypted.dekIv,
          dekTag: encrypted.dekTag,
          secretCiphertext: encrypted.secretCiphertext,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        })
    );

    return {
      id: row.id,
      organizationId: row.organizationId,
      connectorId: row.connectorId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async loadConnectorSecretValue(input: { organizationId: string; actorUserId: string; secretId: string }): Promise<string> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbGetConnectorSecretById(db, {
          organizationId: input.organizationId,
          secretId: input.secretId,
        })
    );
    if (!row) {
      throw new Error("SECRET_NOT_FOUND");
    }

    const kek = parseKekFromEnv();
    return decryptSecret({
      encrypted: {
        kekId: row.kekId,
        dekCiphertext: row.dekCiphertext,
        dekIv: row.dekIv,
        dekTag: row.dekTag,
        secretCiphertext: row.secretCiphertext,
        secretIv: row.secretIv,
        secretTag: row.secretTag,
      },
      resolveKek(kekId) {
        return kekId === kek.kekId ? kek.kekKeyBytes : null;
      },
    });
  }

  async rotateConnectorSecret(input: { organizationId: string; actorUserId: string; secretId: string; value: string }) {
    const kek = parseKekFromEnv();
    const encrypted = encryptSecret({ plaintext: input.value, kek });

    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUpdateConnectorSecretValue(db, {
          organizationId: input.organizationId,
          secretId: input.secretId,
          kekId: encrypted.kekId,
          dekCiphertext: encrypted.dekCiphertext,
          dekIv: encrypted.dekIv,
          dekTag: encrypted.dekTag,
          secretCiphertext: encrypted.secretCiphertext,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          updatedByUserId: input.actorUserId,
        })
    );

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      connectorId: row.connectorId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async deleteConnectorSecret(input: { organizationId: string; actorUserId: string; secretId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbDeleteConnectorSecret(db, { organizationId: input.organizationId, secretId: input.secretId })
    );
    return Boolean(row);
  }

  async createAgentPairingToken(input: {
    organizationId: string;
    actorUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateAgentPairingToken(db, {
          organizationId: input.organizationId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdByUserId: input.actorUserId,
        })
    );

    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async getAgentPairingTokenByHash(input: { organizationId: string; actorUserId?: string; tokenHash: string }) {
    const row = await this.withOrgContext(
      input.actorUserId
        ? { userId: input.actorUserId, organizationId: input.organizationId }
        : { organizationId: input.organizationId },
      async (db) => dbGetAgentPairingTokenByHash(db, { organizationId: input.organizationId, tokenHash: input.tokenHash })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async consumeAgentPairingToken(input: { organizationId: string; tokenHash: string }) {
    const row = await this.withOrgContext(
      { organizationId: input.organizationId },
      async (db) => dbConsumeAgentPairingToken(db, { organizationId: input.organizationId, tokenHash: input.tokenHash })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async createOrganizationAgent(input: {
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.createdByUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateOrganizationAgent(db, {
          organizationId: input.organizationId,
          name: input.name,
          tokenHash: input.tokenHash,
          createdByUserId: input.createdByUserId,
          capabilities: input.capabilities ?? null,
        })
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      tags: row.tags ?? [],
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async listOrganizationAgents(input: { organizationId: string; actorUserId: string }) {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbListOrganizationAgents(db, { organizationId: input.organizationId })
    );
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      tags: row.tags ?? [],
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    }));
  }

  async setOrganizationAgentTags(input: { organizationId: string; actorUserId: string; agentId: string; tags: string[] }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbSetOrganizationAgentTags(db, {
          organizationId: input.organizationId,
          agentId: input.agentId,
          tags: input.tags,
        })
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      tags: row.tags ?? [],
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async revokeOrganizationAgent(input: { organizationId: string; actorUserId: string; agentId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbRevokeOrganizationAgent(db, { organizationId: input.organizationId, agentId: input.agentId })
    );
    return Boolean(row);
  }

  async createExecutorPairingToken(input: { organizationId: string; actorUserId: string; tokenHash: string; expiresAt: Date }): Promise<ExecutorPairingTokenRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateExecutorPairingToken(db, {
          organizationId: input.organizationId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdByUserId: input.actorUserId,
        })
    );

    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async getExecutorPairingTokenByHash(input: { organizationId: string; actorUserId?: string; tokenHash: string }): Promise<ExecutorPairingTokenRecord | null> {
    const row = await this.withOrgContext(
      input.actorUserId
        ? { userId: input.actorUserId, organizationId: input.organizationId }
        : { organizationId: input.organizationId },
      async (db) => dbGetExecutorPairingTokenByHash(db, { organizationId: input.organizationId, tokenHash: input.tokenHash })
    );
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async consumeExecutorPairingToken(input: { organizationId: string; tokenHash: string }): Promise<ExecutorPairingTokenRecord | null> {
    const row = await this.withOrgContext(
      { organizationId: input.organizationId },
      async (db) => dbConsumeExecutorPairingToken(db, { organizationId: input.organizationId, tokenHash: input.tokenHash })
    );
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: toIso(row.expiresAt),
      usedAt: row.usedAt ? toIso(row.usedAt) : null,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async createOrganizationExecutor(input: { organizationId: string; name: string; tokenHash: string; createdByUserId: string; capabilities?: unknown }): Promise<OrganizationExecutorRecord> {
    const row = await this.withOrgContext(
      { userId: input.createdByUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateOrganizationExecutor(db, {
          organizationId: input.organizationId,
          name: input.name,
          tokenHash: input.tokenHash,
          createdByUserId: input.createdByUserId,
          capabilities: input.capabilities ?? null,
        })
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      labels: (row.labels ?? []) as any,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async listOrganizationExecutors(input: { organizationId: string; actorUserId: string }): Promise<OrganizationExecutorRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbListOrganizationExecutors(db, { organizationId: input.organizationId })
    );
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      labels: (row.labels ?? []) as any,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    }));
  }

  async setOrganizationExecutorLabels(input: { organizationId: string; actorUserId: string; executorId: string; labels: string[] }): Promise<OrganizationExecutorRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbSetOrganizationExecutorLabels(db, {
          organizationId: input.organizationId,
          executorId: input.executorId,
          labels: input.labels,
        })
    );
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      capabilities: row.capabilities,
      labels: (row.labels ?? []) as any,
      createdByUserId: row.createdByUserId,
      createdAt: toIso(row.createdAt),
    };
  }

  async revokeOrganizationExecutor(input: { organizationId: string; actorUserId: string; executorId: string }): Promise<boolean> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbRevokeOrganizationExecutor(db, { organizationId: input.organizationId, executorId: input.executorId })
    );
    return Boolean(row);
  }

  async createManagedExecutor(input: {
    name: string;
    tokenHash: string;
    maxInFlight?: number;
    labels?: string[];
    capabilities?: unknown;
    enabled?: boolean;
    drain?: boolean;
    runtimeClass?: string;
    region?: string | null;
  }): Promise<ManagedExecutorRecord> {
    const row = await dbCreateManagedExecutor(this.db(), {
      name: input.name,
      tokenHash: input.tokenHash,
      ...(typeof input.maxInFlight === "number" ? { maxInFlight: input.maxInFlight } : {}),
      ...(Array.isArray(input.labels) ? { labels: input.labels } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
      ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      ...(typeof input.drain === "boolean" ? { drain: input.drain } : {}),
      ...(typeof input.runtimeClass === "string" ? { runtimeClass: input.runtimeClass } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
    });
    return {
      id: row.id,
      name: row.name,
      revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
      lastSeenAt: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
      maxInFlight: row.maxInFlight ?? 50,
      enabled: row.enabled ?? true,
      drain: row.drain ?? false,
      runtimeClass: row.runtimeClass ?? "container",
      region: row.region ?? null,
      capabilities: row.capabilities,
      labels: (row.labels ?? []) as any,
      createdAt: toIso(row.createdAt),
    };
  }

  async revokeManagedExecutor(input: { executorId: string }): Promise<boolean> {
    const row = await dbRevokeManagedExecutor(this.db(), { executorId: input.executorId });
    return Boolean(row);
  }

  async listAgentToolsetsByOrg(input: { organizationId: string; actorUserId: string }) {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbListAgentToolsetsByOrg(db, { organizationId: input.organizationId })
    );
    return rows.map((r) => this.toToolsetRecord(r));
  }

  async createAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org";
    mcpServers: unknown;
    agentSkills: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateAgentToolset(db, {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          publicSlug: null,
          publishedAt: null,
          mcpServers: input.mcpServers,
          agentSkills: input.agentSkills,
          adoptedFrom: null,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        })
    );
    return this.toToolsetRecord(row);
  }

  async getAgentToolsetById(input: { organizationId: string; actorUserId: string; toolsetId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetAgentToolsetById(db, { organizationId: input.organizationId, toolsetId: input.toolsetId })
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async updateAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org";
    mcpServers: unknown;
    agentSkills: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => {
        const existing = await dbGetAgentToolsetById(db, { organizationId: input.organizationId, toolsetId: input.toolsetId });
        if (!existing) return null;
        return await dbUpdateAgentToolset(db, {
          organizationId: input.organizationId,
          toolsetId: input.toolsetId,
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          publicSlug: existing.publicSlug ?? null,
          publishedAt: existing.publishedAt ?? null,
          mcpServers: input.mcpServers,
          agentSkills: input.agentSkills,
          adoptedFrom: existing.adoptedFrom ?? null,
          updatedByUserId: input.actorUserId,
        });
      }
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async deleteAgentToolset(input: { organizationId: string; actorUserId: string; toolsetId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbDeleteAgentToolset(db, { organizationId: input.organizationId, toolsetId: input.toolsetId })
    );
    return Boolean(row);
  }

  async publishAgentToolset(input: { organizationId: string; actorUserId: string; toolsetId: string; publicSlug: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbPublishAgentToolset(db, {
          organizationId: input.organizationId,
          toolsetId: input.toolsetId,
          publicSlug: input.publicSlug,
          updatedByUserId: input.actorUserId,
        })
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async unpublishAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    visibility: "private" | "org";
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUnpublishAgentToolset(db, {
          organizationId: input.organizationId,
          toolsetId: input.toolsetId,
          visibility: input.visibility,
          updatedByUserId: input.actorUserId,
        })
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async listPublicToolsetGallery(input: { actorUserId: string }) {
    const rows = await this.withPublicContext({ userId: input.actorUserId }, async (db) => dbListPublicAgentToolsets(db));
    return rows.map((r) => this.toToolsetRecord(r));
  }

  async getPublicToolsetBySlug(input: { actorUserId: string; publicSlug: string }) {
    const row = await this.withPublicContext(
      { userId: input.actorUserId },
      async (db) => dbGetPublicAgentToolsetBySlug(db, { publicSlug: input.publicSlug })
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async adoptPublicToolset(input: {
    organizationId: string;
    actorUserId: string;
    publicSlug: string;
    nameOverride?: string | null;
    descriptionOverride?: string | null;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbAdoptPublicAgentToolset(db, {
          organizationId: input.organizationId,
          publicSlug: input.publicSlug,
          nameOverride: input.nameOverride ?? null,
          descriptionOverride: input.descriptionOverride ?? null,
          actorUserId: input.actorUserId,
        })
    );
    return row ? this.toToolsetRecord(row) : null;
  }

  async createToolsetBuilderSession(input: { organizationId: string; actorUserId: string; llm: unknown; latestIntent?: string | null }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateToolsetBuilderSession(db, {
          organizationId: input.organizationId,
          createdByUserId: input.actorUserId,
          status: "ACTIVE",
          llm: input.llm,
          latestIntent: input.latestIntent ?? null,
          selectedComponentKeys: [],
          finalDraft: null,
        })
    );
    return this.toToolsetBuilderSessionRecord(row);
  }

  async appendToolsetBuilderTurn(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    role: "USER" | "ASSISTANT";
    messageText: string;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbAppendToolsetBuilderTurn(db, {
          sessionId: input.sessionId,
          role: input.role,
          messageText: input.messageText,
        })
    );
    return this.toToolsetBuilderTurnRecord(row);
  }

  async listToolsetBuilderTurns(input: { organizationId: string; actorUserId: string; sessionId: string; limit?: number }) {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListToolsetBuilderTurnsBySession(db, {
          sessionId: input.sessionId,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
    );
    return rows.map((r) => this.toToolsetBuilderTurnRecord(r));
  }

  async getToolsetBuilderSessionById(input: { organizationId: string; actorUserId: string; sessionId: string }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetToolsetBuilderSessionById(db, { organizationId: input.organizationId, sessionId: input.sessionId })
    );
    return row ? this.toToolsetBuilderSessionRecord(row) : null;
  }

  async updateToolsetBuilderSessionSelection(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    latestIntent?: string | null;
    selectedComponentKeys: string[];
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUpdateToolsetBuilderSessionSelection(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          ...(input.latestIntent !== undefined ? { latestIntent: input.latestIntent } : {}),
          selectedComponentKeys: input.selectedComponentKeys,
        })
    );
    return row ? this.toToolsetBuilderSessionRecord(row) : null;
  }

  async finalizeToolsetBuilderSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    selectedComponentKeys: string[];
    finalDraft: unknown;
  }) {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbFinalizeToolsetBuilderSession(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          selectedComponentKeys: input.selectedComponentKeys,
          finalDraft: input.finalDraft,
        })
    );
    return row ? this.toToolsetBuilderSessionRecord(row) : null;
  }

  async createAgentSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionKey?: string;
    scope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
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
    executorSelector?: { pool: "managed" | "byon"; labels?: string[]; group?: string; tag?: string; executorId?: string } | null;
  }): Promise<AgentSessionRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateAgentSession(db, {
          organizationId: input.organizationId,
          createdByUserId: input.actorUserId,
          ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
          ...(input.scope ? { scope: input.scope } : {}),
          ...(input.routedAgentId !== undefined ? { routedAgentId: input.routedAgentId } : {}),
          ...(input.bindingId !== undefined ? { bindingId: input.bindingId } : {}),
          title: input.title ?? "",
          status: "active",
          selectorTag: input.executorSelector?.tag ?? null,
          selectorGroup: input.executorSelector?.group ?? null,
          executorSelector: input.executorSelector ?? null,
          engineId: input.engineId,
          toolsetId: input.toolsetId ?? null,
          llmProvider: input.llm.provider,
          llmModel: input.llm.model,
          llmSecretId: input.llm.auth?.secretId ?? null,
          toolsAllow: input.tools.allow,
          limits: input.limits ?? {},
          promptSystem: input.prompt.system ?? null,
          promptInstructions: input.prompt.instructions,
          resetPolicySnapshot: input.resetPolicySnapshot ?? {},
        })
    );
    return this.toAgentSessionRecord(row);
  }

  async listAgentSessions(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { updatedAt: string; id: string } | null;
  }): Promise<{ sessions: AgentSessionRecord[]; nextCursor: { updatedAt: string; id: string } | null }> {
    const out = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListAgentSessions(db, {
          organizationId: input.organizationId,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        })
    );
    return {
      sessions: out.sessions.map((r) => this.toAgentSessionRecord(r)),
      nextCursor: out.nextCursor,
    };
  }

  async getAgentSessionById(input: { organizationId: string; actorUserId: string; sessionId: string }): Promise<AgentSessionRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetAgentSessionById(db, { organizationId: input.organizationId, sessionId: input.sessionId })
    );
    return row ? this.toAgentSessionRecord(row) : null;
  }

  async appendAgentSessionEvent(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    eventType: string;
    level: "info" | "warn" | "error";
    handoffFromAgentId?: string | null;
    handoffToAgentId?: string | null;
    idempotencyKey?: string | null;
    payload: unknown;
  }): Promise<AgentSessionEventRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbAppendAgentSessionEvent(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          eventType: input.eventType,
          level: input.level,
          ...(input.handoffFromAgentId !== undefined ? { handoffFromAgentId: input.handoffFromAgentId } : {}),
          ...(input.handoffToAgentId !== undefined ? { handoffToAgentId: input.handoffToAgentId } : {}),
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          payload: input.payload ?? null,
        })
    );
    return this.toAgentSessionEventRecord(row);
  }

  async listAgentSessionEvents(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    limit: number;
    cursor?: { seq: number } | null;
  }): Promise<{ events: AgentSessionEventRecord[]; nextCursor: { seq: number } | null }> {
    const out = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListAgentSessionEvents(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        })
    );
    return {
      events: out.events.map((r) => this.toAgentSessionEventRecord(r)),
      nextCursor: out.nextCursor,
    };
  }

  async setAgentSessionPinnedAgent(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    pinnedAgentId?: string | null;
    pinnedExecutorId?: string | null;
    pinnedExecutorPool?: "managed" | "byon" | null;
  }): Promise<AgentSessionRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbSetAgentSessionPinnedAgent(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          ...(input.pinnedAgentId !== undefined ? { pinnedAgentId: input.pinnedAgentId } : {}),
          ...(input.pinnedExecutorId !== undefined ? { pinnedExecutorId: input.pinnedExecutorId } : {}),
          ...(input.pinnedExecutorPool !== undefined ? { pinnedExecutorPool: input.pinnedExecutorPool } : {}),
        })
    );
    return row ? this.toAgentSessionRecord(row) : null;
  }

  async setAgentSessionRoute(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    routedAgentId: string | null;
    bindingId?: string | null;
    sessionKey?: string;
    scope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  }): Promise<AgentSessionRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbSetAgentSessionRoute(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          routedAgentId: input.routedAgentId,
          ...(input.bindingId !== undefined ? { bindingId: input.bindingId } : {}),
          ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
          ...(input.scope ? { scope: input.scope } : {}),
        })
    );
    return row ? this.toAgentSessionRecord(row) : null;
  }

  async createAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    agentId: string;
    priority: number;
    dimension: string;
    match: unknown;
    metadata?: unknown;
  }): Promise<AgentBindingRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateAgentBinding(db, {
          organizationId: input.organizationId,
          agentId: input.agentId,
          priority: input.priority,
          dimension: input.dimension,
          match: input.match,
          metadata: input.metadata ?? null,
          createdByUserId: input.actorUserId,
        })
    );
    return this.toAgentBindingRecord(row);
  }

  async listAgentBindings(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<AgentBindingRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbListAgentBindings(db, { organizationId: input.organizationId })
    );
    return rows.map((row) => this.toAgentBindingRecord(row));
  }

  async patchAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    bindingId: string;
    patch: {
      agentId?: string;
      priority?: number;
      dimension?: string;
      match?: unknown;
      metadata?: unknown;
    };
  }): Promise<AgentBindingRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbPatchAgentBinding(db, {
          organizationId: input.organizationId,
          bindingId: input.bindingId,
          patch: input.patch,
        })
    );
    return row ? this.toAgentBindingRecord(row) : null;
  }

  async deleteAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    bindingId: string;
  }): Promise<boolean> {
    return await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbDeleteAgentBinding(db, { organizationId: input.organizationId, bindingId: input.bindingId })
    );
  }

  async createAgentMemorySyncJob(input: {
    organizationId: string;
    actorUserId: string;
    sessionId?: string | null;
    sessionKey: string;
    provider: "builtin" | "qmd";
    status?: "queued" | "running" | "succeeded" | "failed";
    reason?: string | null;
    details?: unknown;
  }): Promise<AgentMemorySyncJobRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateAgentMemorySyncJob(db, {
          organizationId: input.organizationId,
          sessionId: input.sessionId ?? null,
          sessionKey: input.sessionKey,
          provider: input.provider,
          status: input.status ?? "queued",
          reason: input.reason ?? null,
          details: input.details ?? {},
          createdByUserId: input.actorUserId,
        })
    );
    return this.toAgentMemorySyncJobRecord(row);
  }

  async listAgentMemoryDocuments(input: {
    organizationId: string;
    actorUserId: string;
    sessionKey?: string;
    limit?: number;
  }): Promise<AgentMemoryDocumentRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListAgentMemoryDocuments(db, {
          organizationId: input.organizationId,
          ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
    );
    return rows.map((row) => this.toAgentMemoryDocumentRecord(row));
  }

  async getAgentMemoryDocumentById(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
  }): Promise<AgentMemoryDocumentRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbGetAgentMemoryDocumentById(db, {
          organizationId: input.organizationId,
          documentId: input.documentId,
        })
    );
    return row ? this.toAgentMemoryDocumentRecord(row) : null;
  }

  async listAgentMemoryChunksByDocument(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
    limit?: number;
  }): Promise<AgentMemoryChunkRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListAgentMemoryChunksByDocument(db, {
          organizationId: input.organizationId,
          documentId: input.documentId,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
    );
    return rows.map((row) => this.toAgentMemoryChunkRecord(row));
  }

  async listChannelAccounts(input: {
    organizationId: string;
    actorUserId: string;
    channelId?: string | null;
  }): Promise<ChannelAccountRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListChannelAccountsByOrg(db, {
          organizationId: input.organizationId,
          ...(input.channelId ? { channelId: input.channelId } : {}),
        })
    );
    return rows.map((r) => this.toChannelAccountRecord(r));
  }

  async createChannelAccount(input: {
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
  }): Promise<ChannelAccountRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateChannelAccount(db, {
          organizationId: input.organizationId,
          channelId: input.channelId,
          accountKey: input.accountKey,
          displayName: input.displayName ?? null,
          enabled: input.enabled ?? true,
          dmPolicy: input.dmPolicy ?? "pairing",
          groupPolicy: input.groupPolicy ?? "allowlist",
          requireMentionInGroup: input.requireMentionInGroup ?? true,
          webhookUrl: input.webhookUrl ?? null,
          metadata: input.metadata ?? {},
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        })
    );
    return this.toChannelAccountRecord(row);
  }

  async getChannelAccountById(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbGetChannelAccountById(db, { organizationId: input.organizationId, accountId: input.accountId })
    );
    return row ? this.toChannelAccountRecord(row) : null;
  }

  async updateChannelAccount(input: {
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
  }): Promise<ChannelAccountRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUpdateChannelAccount(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          patch: {
            ...(input.patch.displayName !== undefined ? { displayName: input.patch.displayName } : {}),
            ...(input.patch.enabled !== undefined ? { enabled: input.patch.enabled } : {}),
            ...(input.patch.dmPolicy !== undefined ? { dmPolicy: input.patch.dmPolicy } : {}),
            ...(input.patch.groupPolicy !== undefined ? { groupPolicy: input.patch.groupPolicy } : {}),
            ...(input.patch.requireMentionInGroup !== undefined
              ? { requireMentionInGroup: input.patch.requireMentionInGroup }
              : {}),
            ...(input.patch.webhookUrl !== undefined ? { webhookUrl: input.patch.webhookUrl } : {}),
            ...(input.patch.metadata !== undefined ? { metadata: input.patch.metadata } : {}),
            ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
            ...(input.patch.lastError !== undefined ? { lastError: input.patch.lastError } : {}),
            updatedByUserId: input.actorUserId,
          },
        })
    );
    return row ? this.toChannelAccountRecord(row) : null;
  }

  async deleteChannelAccount(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<boolean> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) => dbDeleteChannelAccount(db, { organizationId: input.organizationId, accountId: input.accountId })
    );
    return Boolean(row);
  }

  async createChannelAccountSecret(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    name: string;
    value: string;
  }): Promise<ChannelAccountSecretRecord> {
    const kek = parseKekFromEnv();
    const encrypted = encryptSecret({
      plaintext: input.value,
      kek,
    });
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbCreateChannelAccountSecret(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          name: input.name,
          kekId: encrypted.kekId,
          dekCiphertext: encrypted.dekCiphertext,
          dekIv: encrypted.dekIv,
          dekTag: encrypted.dekTag,
          secretCiphertext: encrypted.secretCiphertext,
          secretIv: encrypted.secretIv,
          secretTag: encrypted.secretTag,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        })
    );
    return this.toChannelAccountSecretRecord(row);
  }

  async listChannelAccountSecrets(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountSecretRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListChannelAccountSecrets(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
        })
    );
    return rows.map((r) => this.toChannelAccountSecretRecord(r));
  }

  async listChannelPairingRequests(input: {
    organizationId: string;
    actorUserId: string;
    accountId?: string | null;
    status?: string | null;
  }): Promise<ChannelPairingRequestRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListChannelPairingRequests(db, {
          organizationId: input.organizationId,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.status ? { status: input.status } : {}),
        })
    );
    return rows.map((r) => this.toChannelPairingRequestRecord(r));
  }

  async listChannelAllowlistEntries(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope?: string | null;
  }): Promise<ChannelAllowlistEntryRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListChannelAllowlistEntries(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          ...(input.scope ? { scope: input.scope } : {}),
        })
    );
    return rows.map((row) => this.toChannelAllowlistEntryRecord(row));
  }

  async putChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<ChannelAllowlistEntryRecord> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbPutChannelAllowlistEntry(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          scope: input.scope,
          subject: input.subject,
          createdByUserId: input.actorUserId,
        })
    );
    return this.toChannelAllowlistEntryRecord(row);
  }

  async deleteChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<boolean> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbDeleteChannelAllowlistEntry(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          scope: input.scope,
          subject: input.subject,
        })
    );
    return Boolean(row);
  }

  async updateChannelPairingRequestStatus(input: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    status: "approved" | "rejected";
  }): Promise<ChannelPairingRequestRecord | null> {
    const row = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbUpdateChannelPairingRequestStatus(db, {
          organizationId: input.organizationId,
          requestId: input.requestId,
          status: input.status,
          ...(input.status === "approved" ? { approvedByUserId: input.actorUserId } : {}),
        })
    );
    return row ? this.toChannelPairingRequestRecord(row) : null;
  }

  async listChannelEvents(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    limit?: number;
  }): Promise<ChannelEventRecord[]> {
    const rows = await this.withOrgContext(
      { userId: input.actorUserId, organizationId: input.organizationId },
      async (db) =>
        dbListChannelEvents(db, {
          organizationId: input.organizationId,
          accountId: input.accountId,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
    );
    return rows.map((r) => this.toChannelEventRecord(r));
  }
}
