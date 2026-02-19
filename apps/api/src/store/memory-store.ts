import crypto from "node:crypto";
import { decryptSecret, encryptSecret, parseKekFromEnv } from "@vespid/shared/secrets";
import type {
  AppStore,
  AgentToolsetRecord,
  AgentPairingTokenRecord,
  ExecutorPairingTokenRecord,
  ConnectorSecretRecord,
  InvitationAcceptResultRecord,
  InvitationRecord,
  MembershipRecord,
  OrganizationAgentRecord,
  OrganizationExecutorRecord,
  ManagedExecutorRecord,
  OrganizationRecord,
  OrganizationSettings,
  SessionRecord,
  UserOrgSummaryRecord,
  UserRecord,
  WorkflowRecord,
  WorkflowRunEventRecord,
  WorkflowRunRecord,
  ToolsetBuilderSessionRecord,
  ToolsetBuilderTurnRecord,
  AgentSessionRecord,
  AgentSessionEventRecord,
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
  AgentBindingRecord,
  AgentMemoryChunkRecord,
  AgentMemoryDocumentRecord,
  AgentMemorySyncJobRecord,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryAppStore implements AppStore {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private platformUserRoles = new Map<string, PlatformUserRoleRecord>();
  private platformSettings = new Map<string, PlatformSettingRecord>();
  private supportTickets = new Map<string, SupportTicketRecord>();
  private supportTicketEventsByTicketId = new Map<string, SupportTicketEventRecord[]>();
  private platformAuditLogs: PlatformAuditLogRecord[] = [];
  private organizations = new Map<string, OrganizationRecord>();
  private organizationSettings = new Map<string, OrganizationSettings>();
  private memberships = new Map<string, MembershipRecord>();
  private invitations = new Map<string, InvitationRecord>();
  private sessions = new Map<string, SessionRecord>();
  private workflows = new Map<string, WorkflowRecord>();
  private workflowRuns = new Map<string, WorkflowRunRecord>();
  private workflowRunEvents = new Map<string, WorkflowRunEventRecord>();
  private connectorSecrets = new Map<string, (ConnectorSecretRecord & {
    kekId: string;
    dekCiphertext: Buffer;
    dekIv: Buffer;
    dekTag: Buffer;
    secretCiphertext: Buffer;
    secretIv: Buffer;
    secretTag: Buffer;
  })>();
  private agentPairingTokensByHash = new Map<string, AgentPairingTokenRecord>();
  private executorPairingTokensByHash = new Map<string, ExecutorPairingTokenRecord>();
  private organizationAgents = new Map<
    string,
    (OrganizationAgentRecord & {
      tokenHash: string;
    })
  >();
  private organizationAgentIdByTokenHash = new Map<string, string>();
  private organizationExecutors = new Map<
    string,
    (OrganizationExecutorRecord & {
      tokenHash: string;
    })
  >();
  private managedExecutors = new Map<
    string,
    (ManagedExecutorRecord & {
      tokenHash: string;
    })
  >();
  private organizationExecutorIdByTokenHash = new Map<string, string>();
  private toolsets = new Map<string, AgentToolsetRecord>();
  private toolsetBuilderSessions = new Map<string, ToolsetBuilderSessionRecord>();
  private toolsetBuilderTurnsBySessionId = new Map<string, ToolsetBuilderTurnRecord[]>();
  private toolsetBuilderTurnSeq = 0;
  private agentSessions = new Map<string, AgentSessionRecord>();
  private agentSessionEventsBySessionId = new Map<string, AgentSessionEventRecord[]>();
  private agentSessionSeqBySessionId = new Map<string, number>();
  private agentBindings = new Map<string, AgentBindingRecord>();
  private agentMemoryDocuments = new Map<string, AgentMemoryDocumentRecord>();
  private agentMemoryChunksByDocumentId = new Map<string, AgentMemoryChunkRecord[]>();
  private agentMemorySyncJobs = new Map<string, AgentMemorySyncJobRecord>();
  private channelAccounts = new Map<string, ChannelAccountRecord>();
  private channelAccountSecrets = new Map<string, ChannelAccountSecretRecord & { value: string }>();
  private channelAllowlistEntries = new Map<string, ChannelAllowlistEntryRecord>();
  private channelPairingRequests = new Map<string, ChannelPairingRequestRecord>();
  private channelEvents = new Map<string, ChannelEventRecord[]>();

  constructor() {
    const now = nowIso();
    this.platformSettings.set("org_policy", {
      key: "org_policy",
      value: {
        free: { canManageOrg: false, maxOrgs: 1 },
        paid: { canManageOrg: true, maxOrgs: 5 },
        enterprise: { canManageOrg: true, maxOrgs: null },
      },
      updatedByUserId: null,
      updatedAt: now,
    });
    this.platformSettings.set("risk.policies", {
      key: "risk.policies",
      value: { allowSignup: true, rateLimitMode: "default" },
      updatedByUserId: null,
      updatedAt: now,
    });
    this.platformSettings.set("risk.incidents", {
      key: "risk.incidents",
      value: { items: [] },
      updatedByUserId: null,
      updatedAt: now,
    });
    this.platformSettings.set("observability.logs", {
      key: "observability.logs",
      value: { items: [] },
      updatedByUserId: null,
      updatedAt: now,
    });
    this.platformSettings.set("observability.metrics", {
      key: "observability.metrics",
      value: { items: [] },
      updatedByUserId: null,
      updatedAt: now,
    });
  }

  async ensureDefaultRoles(): Promise<void> {
    return;
  }

  async createUser(input: { email: string; passwordHash: string; displayName?: string | null }): Promise<UserRecord> {
    const normalizedEmail = input.email.toLowerCase();
    if (this.usersByEmail.has(normalizedEmail)) {
      throw new Error("EMAIL_EXISTS");
    }

    const user: UserRecord = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      displayName: input.displayName ?? null,
      createdAt: nowIso(),
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    return user;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.usersByEmail.get(email.toLowerCase());
    if (!id) {
      return null;
    }
    return this.users.get(id) ?? null;
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async listOrganizationsForUser(input: { actorUserId: string }): Promise<UserOrgSummaryRecord[]> {
    const results: UserOrgSummaryRecord[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.userId !== input.actorUserId) {
        continue;
      }
      const org = this.organizations.get(membership.organizationId);
      if (!org) {
        continue;
      }
      results.push({ organization: org, membership });
    }
    results.sort((a, b) => a.organization.createdAt.localeCompare(b.organization.createdAt));
    return results;
  }

  async ensurePersonalOrganizationForUser(input: { actorUserId: string }): Promise<{ defaultOrgId: string; created: boolean }> {
    const existing = await this.listOrganizationsForUser({ actorUserId: input.actorUserId });
    if (existing.length > 0) {
      return { defaultOrgId: existing[0]!.organization.id, created: false };
    }

    const created = await this.createOrganizationWithOwner({
      name: "Personal workspace",
      slug: `personal-${input.actorUserId.slice(0, 8)}`,
      ownerUserId: input.actorUserId,
    });
    return { defaultOrgId: created.organization.id, created: true };
  }

  async listPlatformUserRoles(input?: { roleKey?: string; userId?: string }): Promise<PlatformUserRoleRecord[]> {
    let rows = [...this.platformUserRoles.values()];
    if (input?.roleKey) {
      rows = rows.filter((row) => row.roleKey === input.roleKey);
    }
    if (input?.userId) {
      rows = rows.filter((row) => row.userId === input.userId);
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }

  async createPlatformUserRole(input: {
    userId: string;
    roleKey: string;
    grantedByUserId?: string | null;
  }): Promise<PlatformUserRoleRecord> {
    const key = `${input.userId}:${input.roleKey}`;
    const existing = this.platformUserRoles.get(key);
    if (existing) {
      return existing;
    }
    const row: PlatformUserRoleRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      roleKey: input.roleKey,
      grantedByUserId: input.grantedByUserId ?? null,
      createdAt: nowIso(),
    };
    this.platformUserRoles.set(key, row);
    return row;
  }

  async deletePlatformUserRole(input: { userId: string; roleKey: string }): Promise<boolean> {
    return this.platformUserRoles.delete(`${input.userId}:${input.roleKey}`);
  }

  async listPlatformSettings(): Promise<PlatformSettingRecord[]> {
    return [...this.platformSettings.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async getPlatformSetting(input: { key: string }): Promise<PlatformSettingRecord | null> {
    return this.platformSettings.get(input.key) ?? null;
  }

  async upsertPlatformSetting(input: {
    key: string;
    value: unknown;
    updatedByUserId?: string | null;
  }): Promise<PlatformSettingRecord> {
    const row: PlatformSettingRecord = {
      key: input.key,
      value: input.value ?? {},
      updatedByUserId: input.updatedByUserId ?? null,
      updatedAt: nowIso(),
    };
    this.platformSettings.set(input.key, row);
    return row;
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
    const row: SupportTicketRecord = {
      id: crypto.randomUUID(),
      requesterUserId: input.requesterUserId ?? null,
      organizationId: input.organizationId ?? null,
      category: input.category ?? "general",
      priority: input.priority ?? "normal",
      status: input.status ?? "open",
      subject: input.subject,
      content: input.content,
      assigneeUserId: input.assigneeUserId ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.supportTickets.set(row.id, row);
    return row;
  }

  async listSupportTickets(input?: { status?: string; limit?: number }): Promise<SupportTicketRecord[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(input?.limit ?? 100)));
    let rows = [...this.supportTickets.values()];
    if (input?.status) {
      rows = rows.filter((row) => row.status === input.status);
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows.slice(0, limit);
  }

  async getSupportTicketById(input: { ticketId: string }): Promise<SupportTicketRecord | null> {
    return this.supportTickets.get(input.ticketId) ?? null;
  }

  async patchSupportTicket(input: {
    ticketId: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
  }): Promise<SupportTicketRecord | null> {
    const existing = this.supportTickets.get(input.ticketId);
    if (!existing) {
      return null;
    }
    const next: SupportTicketRecord = {
      ...existing,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
      updatedAt: nowIso(),
    };
    this.supportTickets.set(next.id, next);
    return next;
  }

  async appendSupportTicketEvent(input: {
    ticketId: string;
    actorUserId?: string | null;
    eventType: string;
    payload?: unknown;
  }): Promise<SupportTicketEventRecord> {
    const row: SupportTicketEventRecord = {
      id: crypto.randomUUID(),
      ticketId: input.ticketId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      payload: input.payload ?? {},
      createdAt: nowIso(),
    };
    const list = this.supportTicketEventsByTicketId.get(input.ticketId) ?? [];
    this.supportTicketEventsByTicketId.set(input.ticketId, [row, ...list]);
    return row;
  }

  async listSupportTicketEvents(input: { ticketId: string; limit?: number }): Promise<SupportTicketEventRecord[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
    const list = this.supportTicketEventsByTicketId.get(input.ticketId) ?? [];
    return list.slice(0, limit);
  }

  async appendPlatformAuditLog(input: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: unknown;
  }): Promise<PlatformAuditLogRecord> {
    const row: PlatformAuditLogRecord = {
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
    };
    this.platformAuditLogs.unshift(row);
    return row;
  }

  async listPlatformAuditLogs(input?: { action?: string; limit?: number }): Promise<PlatformAuditLogRecord[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(input?.limit ?? 100)));
    let rows = [...this.platformAuditLogs];
    if (input?.action) {
      rows = rows.filter((row) => row.action === input.action);
    }
    return rows.slice(0, limit);
  }

  async createOrganizationWithOwner(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<{ organization: OrganizationRecord; membership: MembershipRecord }> {
    if (![...this.organizations.values()].every((org) => org.slug !== input.slug)) {
      throw new Error("ORG_SLUG_EXISTS");
    }

    const organization: OrganizationRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      createdAt: nowIso(),
    };
    this.organizations.set(organization.id, organization);
    this.organizationSettings.set(organization.id, {});

    const membership: MembershipRecord = {
      id: crypto.randomUUID(),
      organizationId: organization.id,
      userId: input.ownerUserId,
      roleKey: "owner",
      createdAt: nowIso(),
    };

    this.memberships.set(membership.id, membership);
    return { organization, membership };
  }

  async getOrganizationSettings(input: { organizationId: string; actorUserId: string }): Promise<OrganizationSettings> {
    if (!this.organizations.has(input.organizationId)) {
      throw new Error("ORGANIZATION_NOT_FOUND");
    }
    return this.organizationSettings.get(input.organizationId) ?? {};
  }

  async updateOrganizationSettings(input: {
    organizationId: string;
    actorUserId: string;
    settings: OrganizationSettings;
  }): Promise<OrganizationSettings> {
    if (!this.organizations.has(input.organizationId)) {
      throw new Error("ORGANIZATION_NOT_FOUND");
    }
    this.organizationSettings.set(input.organizationId, input.settings);
    return input.settings;
  }

  async getMembership(input: { organizationId: string; userId: string; actorUserId?: string }): Promise<MembershipRecord | null> {
    for (const membership of this.memberships.values()) {
      if (membership.organizationId === input.organizationId && membership.userId === input.userId) {
        return membership;
      }
    }
    return null;
  }

  async createInvitation(input: {
    organizationId: string;
    email: string;
    roleKey: "admin" | "member";
    invitedByUserId: string;
    ttlHours?: number;
  }): Promise<InvitationRecord> {
    const invitation: InvitationRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      roleKey: input.roleKey,
      invitedByUserId: input.invitedByUserId,
      token: `${input.organizationId}.${crypto.randomUUID()}`,
      status: "pending",
      expiresAt: new Date(Date.now() + (input.ttlHours ?? 72) * 3600 * 1000).toISOString(),
      createdAt: nowIso(),
    };

    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async getInvitationByToken(input: { organizationId: string; token: string; actorUserId: string }): Promise<InvitationRecord | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.organizationId === input.organizationId && invitation.token === input.token) {
        return invitation;
      }
    }
    return null;
  }

  async acceptInvitation(input: {
    organizationId: string;
    token: string;
    userId: string;
    email: string;
  }): Promise<InvitationAcceptResultRecord> {
    const invitation = await this.getInvitationByToken({
      organizationId: input.organizationId,
      token: input.token,
      actorUserId: input.userId,
    });

    if (!invitation) {
      throw new Error("INVITATION_NOT_FOUND");
    }

    if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new Error("INVITATION_EMAIL_MISMATCH");
    }

    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      throw new Error("INVITATION_EXPIRED");
    }

    const membership =
      (await this.getMembership({ organizationId: input.organizationId, userId: input.userId })) ??
      (await this.attachMembership({
        organizationId: input.organizationId,
        userId: input.userId,
        roleKey: invitation.roleKey,
      }));

    if (invitation.status === "pending") {
      this.invitations.set(invitation.id, { ...invitation, status: "accepted" });
    } else if (invitation.status !== "accepted") {
      throw new Error("INVITATION_NOT_PENDING");
    }

    return {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      membershipId: membership.id,
      accepted: true,
    };
  }

  async updateMembershipRole(input: {
    organizationId: string;
    actorUserId: string;
    memberUserId: string;
    roleKey: "owner" | "admin" | "member";
  }): Promise<MembershipRecord | null> {
    for (const [id, membership] of this.memberships.entries()) {
      if (membership.organizationId === input.organizationId && membership.userId === input.memberUserId) {
        const updated: MembershipRecord = { ...membership, roleKey: input.roleKey };
        this.memberships.set(id, updated);
        return updated;
      }
    }
    return null;
  }

  async createSession(input: {
    id?: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt.toISOString(),
      revokedAt: null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      createdAt: nowIso(),
      lastUsedAt: nowIso(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSessionById(input: { userId: string; sessionId: string }): Promise<SessionRecord | null> {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.userId !== input.userId) {
      return null;
    }
    return session;
  }

  async rotateSessionRefreshToken(input: {
    userId: string;
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord | null> {
    const session = await this.getSessionById(input);
    if (!session) {
      return null;
    }

    const updated: SessionRecord = {
      ...session,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt.toISOString(),
      lastUsedAt: nowIso(),
    };
    this.sessions.set(updated.id, updated);
    return updated;
  }

  async revokeSession(input: { userId: string; sessionId: string }): Promise<boolean> {
    const session = await this.getSessionById(input);
    if (!session || session.revokedAt) {
      return false;
    }
    this.sessions.set(session.id, { ...session, revokedAt: nowIso() });
    return true;
  }

  async revokeAllSessionsForUser(userId: string): Promise<number> {
    let revoked = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(id, { ...session, revokedAt: nowIso() });
        revoked += 1;
      }
    }
    return revoked;
  }

  async touchSession(input: { userId: string; sessionId: string }): Promise<void> {
    const session = await this.getSessionById(input);
    if (!session) {
      return;
    }
    this.sessions.set(session.id, { ...session, lastUsedAt: nowIso() });
  }

  async createWorkflow(input: {
    organizationId: string;
    name: string;
    dsl: unknown;
    createdByUserId: string;
  }): Promise<WorkflowRecord> {
    const now = nowIso();
    const workflowId = crypto.randomUUID();
    const workflow: WorkflowRecord = {
      id: workflowId,
      organizationId: input.organizationId,
      familyId: workflowId,
      revision: 1,
      sourceWorkflowId: null,
      name: input.name,
      status: "draft",
      version: 1,
      dsl: input.dsl,
      editorState: null,
      createdByUserId: input.createdByUserId,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  async createWorkflowDraftFromWorkflow(input: {
    organizationId: string;
    sourceWorkflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null> {
    const source = this.workflows.get(input.sourceWorkflowId);
    if (!source || source.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();

    const familyId = source.familyId ?? source.id;
    let maxRevision = 0;
    for (const wf of this.workflows.values()) {
      if (wf.organizationId === input.organizationId && wf.familyId === familyId) {
        maxRevision = Math.max(maxRevision, wf.revision ?? 0);
      }
    }

    const draftId = crypto.randomUUID();
    const draft: WorkflowRecord = {
      id: draftId,
      organizationId: input.organizationId,
      familyId,
      revision: maxRevision + 1,
      sourceWorkflowId: source.id,
      name: source.name,
      status: "draft",
      version: 1,
      dsl: source.dsl,
      editorState: source.editorState ?? null,
      createdByUserId: input.actorUserId,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.workflows.set(draft.id, draft);
    return draft;
  }

  async listWorkflows(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ workflows: WorkflowRecord[]; nextCursor: { createdAt: string; id: string } | null }> {
    const limit = Math.min(200, Math.max(1, input.limit));
    const cursorCreatedAt = input.cursor?.createdAt ? new Date(input.cursor.createdAt).getTime() : null;
    const cursorId = input.cursor?.id ?? null;

    const workflows = [...this.workflows.values()]
      .filter((wf) => wf.organizationId === input.organizationId)
      .filter((wf) => {
        if (!cursorCreatedAt || !cursorId) {
          return true;
        }
        const createdAtMs = new Date(wf.createdAt).getTime();
        return createdAtMs < cursorCreatedAt || (createdAtMs === cursorCreatedAt && wf.id < cursorId);
      })
      .sort((a, b) => {
        const aMs = new Date(a.createdAt).getTime();
        const bMs = new Date(b.createdAt).getTime();
        if (aMs !== bMs) {
          return bMs - aMs;
        }
        return b.id.localeCompare(a.id);
      })
      .slice(0, limit);

    const last = workflows.length > 0 ? workflows[workflows.length - 1] : null;
    const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
    return { workflows, nextCursor };
  }

  async listWorkflowRevisions(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
  }): Promise<{ workflows: WorkflowRecord[] }> {
    const existing = this.workflows.get(input.workflowId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return { workflows: [] };
    }
    const familyId = existing.familyId ?? existing.id;
    const limit = Math.min(200, Math.max(1, input.limit));
    const workflows = [...this.workflows.values()]
      .filter((wf) => wf.organizationId === input.organizationId && (wf.familyId ?? wf.id) === familyId)
      .sort((a, b) => {
        const ar = typeof a.revision === "number" ? a.revision : 0;
        const br = typeof b.revision === "number" ? b.revision : 0;
        if (ar !== br) {
          return br - ar;
        }
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      })
      .slice(0, limit);
    return { workflows };
  }

  async getWorkflowById(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null> {
    const workflow = this.workflows.get(input.workflowId);
    if (!workflow || workflow.organizationId !== input.organizationId) {
      return null;
    }
    return workflow;
  }

  async updateWorkflowDraft(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    name?: string | null;
    dsl?: unknown;
    editorState?: unknown;
  }): Promise<WorkflowRecord | null> {
    const existing = await this.getWorkflowById(input);
    if (!existing) {
      return null;
    }
    if (existing.status !== "draft") {
      return null;
    }

    const updated: WorkflowRecord = {
      ...existing,
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(input.dsl !== undefined ? { dsl: input.dsl } : {}),
      ...(input.editorState !== undefined ? { editorState: input.editorState } : {}),
      version: existing.version + 1,
      updatedAt: nowIso(),
    };
    this.workflows.set(updated.id, updated);
    return updated;
  }

  async publishWorkflow(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
  }): Promise<WorkflowRecord | null> {
    const workflow = await this.getWorkflowById(input);
    if (!workflow) {
      return null;
    }
    const updated: WorkflowRecord = {
      ...workflow,
      status: "published",
      version: workflow.version + 1,
      publishedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.workflows.set(updated.id, updated);
    return updated;
  }

  async createWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    triggerType: "manual" | "channel";
    requestedByUserId: string;
    input?: unknown;
    maxAttempts?: number;
  }): Promise<WorkflowRunRecord> {
    const run: WorkflowRunRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      triggerType: input.triggerType,
      status: "queued",
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextAttemptAt: null,
      requestedByUserId: input.requestedByUserId,
      input: input.input ?? null,
      output: null,
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    };
    this.workflowRuns.set(run.id, run);
    return run;
  }

  async listWorkflowRuns(input: {
    organizationId: string;
    workflowId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ runs: WorkflowRunRecord[]; nextCursor: { createdAt: string; id: string } | null }> {
    const limit = Math.min(200, Math.max(1, input.limit));
    const cursorCreatedAt = input.cursor?.createdAt ? new Date(input.cursor.createdAt).getTime() : null;
    const cursorId = input.cursor?.id ?? null;

    const runs = [...this.workflowRuns.values()]
      .filter((run) => run.organizationId === input.organizationId && run.workflowId === input.workflowId)
      .filter((run) => {
        if (!cursorCreatedAt || !cursorId) {
          return true;
        }
        const createdAt = new Date(run.createdAt).getTime();
        if (createdAt < cursorCreatedAt) {
          return true;
        }
        if (createdAt === cursorCreatedAt && run.id < cursorId) {
          return true;
        }
        return false;
      })
      .sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (diff !== 0) {
          return diff;
        }
        return b.id.localeCompare(a.id);
      })
      .slice(0, limit);

    const last = runs.length > 0 ? runs[runs.length - 1] : null;
    const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
    return { runs, nextCursor };
  }

  async getWorkflowRunById(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
  }): Promise<WorkflowRunRecord | null> {
    const run = this.workflowRuns.get(input.runId);
    if (!run || run.organizationId !== input.organizationId || run.workflowId !== input.workflowId) {
      return null;
    }
    return run;
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
  }): Promise<WorkflowRunEventRecord> {
    const event: WorkflowRunEventRecord = {
      id: crypto.randomUUID(),
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
      createdAt: nowIso(),
    };
    this.workflowRunEvents.set(event.id, event);
    return event;
  }

  async listWorkflowRunEvents(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    limit: number;
    cursor?: { createdAt: string; id: string } | null;
  }): Promise<{ events: WorkflowRunEventRecord[]; nextCursor: { createdAt: string; id: string } | null }> {
    const limit = Math.min(500, Math.max(1, input.limit));
    const cursorCreatedAt = input.cursor?.createdAt ? new Date(input.cursor.createdAt).getTime() : null;
    const cursorId = input.cursor?.id ?? null;

    const events = [...this.workflowRunEvents.values()]
      .filter(
        (event) =>
          event.organizationId === input.organizationId &&
          event.workflowId === input.workflowId &&
          event.runId === input.runId
      )
      .filter((event) => {
        if (!cursorCreatedAt || !cursorId) {
          return true;
        }
        const createdAt = new Date(event.createdAt).getTime();
        if (createdAt > cursorCreatedAt) {
          return true;
        }
        if (createdAt === cursorCreatedAt && event.id > cursorId) {
          return true;
        }
        return false;
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (diff !== 0) {
          return diff;
        }
        return a.id.localeCompare(b.id);
      })
      .slice(0, limit);

    const last = events.length > 0 ? events[events.length - 1] : null;
    const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
    return { events, nextCursor };
  }

  async deleteQueuedWorkflowRun(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
  }): Promise<boolean> {
    const run = await this.getWorkflowRunById(input);
    if (!run) {
      return false;
    }
    if (run.status !== "queued" || run.attemptCount !== 0) {
      return false;
    }
    return this.workflowRuns.delete(run.id);
  }

  async markWorkflowRunRunning(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    attemptCount?: number;
  }): Promise<WorkflowRunRecord | null> {
    const run = await this.getWorkflowRunById(input);
    if (!run) {
      return null;
    }
    const updated: WorkflowRunRecord = {
      ...run,
      status: "running",
      attemptCount: input.attemptCount ?? run.attemptCount,
      nextAttemptAt: null,
      startedAt: nowIso(),
    };
    this.workflowRuns.set(updated.id, updated);
    return updated;
  }

  async markWorkflowRunQueuedForRetry(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }): Promise<WorkflowRunRecord | null> {
    const run = await this.getWorkflowRunById(input);
    if (!run) {
      return null;
    }
    const updated: WorkflowRunRecord = {
      ...run,
      status: "queued",
      error: input.error,
      nextAttemptAt: null,
      finishedAt: null,
    };
    this.workflowRuns.set(updated.id, updated);
    return updated;
  }

  async markWorkflowRunSucceeded(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    output: unknown;
  }): Promise<WorkflowRunRecord | null> {
    const run = await this.getWorkflowRunById(input);
    if (!run) {
      return null;
    }
    const updated: WorkflowRunRecord = {
      ...run,
      status: "succeeded",
      output: input.output,
      error: null,
      finishedAt: nowIso(),
    };
    this.workflowRuns.set(updated.id, updated);
    return updated;
  }

  async markWorkflowRunFailed(input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    actorUserId: string;
    error: string;
  }): Promise<WorkflowRunRecord | null> {
    const run = await this.getWorkflowRunById(input);
    if (!run) {
      return null;
    }
    const updated: WorkflowRunRecord = {
      ...run,
      status: "failed",
      error: input.error,
      finishedAt: nowIso(),
    };
    this.workflowRuns.set(updated.id, updated);
    return updated;
  }

  async listConnectorSecrets(input: {
    organizationId: string;
    actorUserId: string;
    connectorId?: string | null;
  }): Promise<ConnectorSecretRecord[]> {
    const rows: ConnectorSecretRecord[] = [];
    for (const secret of this.connectorSecrets.values()) {
      if (secret.organizationId !== input.organizationId) {
        continue;
      }
      if (input.connectorId && secret.connectorId !== input.connectorId) {
        continue;
      }
      rows.push({
        id: secret.id,
        organizationId: secret.organizationId,
        connectorId: secret.connectorId,
        name: secret.name,
        createdByUserId: secret.createdByUserId,
        updatedByUserId: secret.updatedByUserId,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      });
    }
    rows.sort((a, b) => `${a.connectorId}:${a.name}`.localeCompare(`${b.connectorId}:${b.name}`));
    return rows;
  }

  async createConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    connectorId: string;
    name: string;
    value: string;
  }): Promise<ConnectorSecretRecord> {
    for (const secret of this.connectorSecrets.values()) {
      if (
        secret.organizationId === input.organizationId &&
        secret.connectorId === input.connectorId &&
        secret.name === input.name
      ) {
        throw new Error("SECRET_ALREADY_EXISTS");
      }
    }

    const kek = parseKekFromEnv();
    const encrypted = encryptSecret({ plaintext: input.value, kek });
    const now = nowIso();

    const record: ConnectorSecretRecord & {
      kekId: string;
      dekCiphertext: Buffer;
      dekIv: Buffer;
      dekTag: Buffer;
      secretCiphertext: Buffer;
      secretIv: Buffer;
      secretTag: Buffer;
    } = {
      id: crypto.randomUUID(),
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
      createdAt: now,
      updatedAt: now,
    };

    this.connectorSecrets.set(record.id, record);
    return {
      id: record.id,
      organizationId: record.organizationId,
      connectorId: record.connectorId,
      name: record.name,
      createdByUserId: record.createdByUserId,
      updatedByUserId: record.updatedByUserId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async loadConnectorSecretValue(input: { organizationId: string; actorUserId: string; secretId: string }): Promise<string> {
    const secret = this.connectorSecrets.get(input.secretId);
    if (!secret || secret.organizationId !== input.organizationId) {
      throw new Error("SECRET_NOT_FOUND");
    }

    const kek = parseKekFromEnv();
    return decryptSecret({
      encrypted: {
        kekId: secret.kekId,
        dekCiphertext: secret.dekCiphertext,
        dekIv: secret.dekIv,
        dekTag: secret.dekTag,
        secretCiphertext: secret.secretCiphertext,
        secretIv: secret.secretIv,
        secretTag: secret.secretTag,
      },
      resolveKek(kekId) {
        return kekId === kek.kekId ? kek.kekKeyBytes : null;
      },
    });
  }

  async rotateConnectorSecret(input: {
    organizationId: string;
    actorUserId: string;
    secretId: string;
    value: string;
  }): Promise<ConnectorSecretRecord | null> {
    const existing = this.connectorSecrets.get(input.secretId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return null;
    }

    const kek = parseKekFromEnv();
    const encrypted = encryptSecret({ plaintext: input.value, kek });
    const updated = {
      ...existing,
      kekId: encrypted.kekId,
      dekCiphertext: encrypted.dekCiphertext,
      dekIv: encrypted.dekIv,
      dekTag: encrypted.dekTag,
      secretCiphertext: encrypted.secretCiphertext,
      secretIv: encrypted.secretIv,
      secretTag: encrypted.secretTag,
      updatedByUserId: input.actorUserId,
      updatedAt: nowIso(),
    };
    this.connectorSecrets.set(updated.id, updated);
    return {
      id: updated.id,
      organizationId: updated.organizationId,
      connectorId: updated.connectorId,
      name: updated.name,
      createdByUserId: updated.createdByUserId,
      updatedByUserId: updated.updatedByUserId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteConnectorSecret(input: { organizationId: string; actorUserId: string; secretId: string }): Promise<boolean> {
    const existing = this.connectorSecrets.get(input.secretId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return false;
    }
    this.connectorSecrets.delete(input.secretId);
    return true;
  }

  async createAgentPairingToken(input: {
    organizationId: string;
    actorUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AgentPairingTokenRecord> {
    const token: AgentPairingTokenRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      usedAt: null,
      createdByUserId: input.actorUserId,
      createdAt: nowIso(),
    };
    this.agentPairingTokensByHash.set(token.tokenHash, token);
    return token;
  }

  async getAgentPairingTokenByHash(input: {
    organizationId: string;
    actorUserId?: string;
    tokenHash: string;
  }): Promise<AgentPairingTokenRecord | null> {
    const token = this.agentPairingTokensByHash.get(input.tokenHash);
    if (!token || token.organizationId !== input.organizationId) {
      return null;
    }
    return token;
  }

  async consumeAgentPairingToken(input: { organizationId: string; tokenHash: string }): Promise<AgentPairingTokenRecord | null> {
    const token = this.agentPairingTokensByHash.get(input.tokenHash);
    if (!token || token.organizationId !== input.organizationId) {
      return null;
    }
    if (token.usedAt) {
      return null;
    }
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    const updated: AgentPairingTokenRecord = {
      ...token,
      usedAt: nowIso(),
    };
    this.agentPairingTokensByHash.set(updated.tokenHash, updated);
    return updated;
  }

  async createOrganizationAgent(input: {
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }): Promise<OrganizationAgentRecord> {
    const agentId = crypto.randomUUID();
    const agent: OrganizationAgentRecord = {
      id: agentId,
      organizationId: input.organizationId,
      name: input.name,
      revokedAt: null,
      lastSeenAt: null,
      capabilities: input.capabilities ?? null,
      tags: [],
      createdByUserId: input.createdByUserId,
      createdAt: nowIso(),
    };
    this.organizationAgents.set(agent.id, { ...agent, tokenHash: input.tokenHash });
    this.organizationAgentIdByTokenHash.set(input.tokenHash, agent.id);
    return agent;
  }

  async listOrganizationAgents(input: { organizationId: string; actorUserId: string }): Promise<OrganizationAgentRecord[]> {
    return [...this.organizationAgents.values()]
      .filter((agent) => agent.organizationId === input.organizationId)
      .map((agent) => ({
        id: agent.id,
        organizationId: agent.organizationId,
        name: agent.name,
        revokedAt: agent.revokedAt,
        lastSeenAt: agent.lastSeenAt,
        capabilities: agent.capabilities,
        tags: agent.tags ?? [],
        createdByUserId: agent.createdByUserId,
        createdAt: agent.createdAt,
      }));
  }

  async setOrganizationAgentTags(input: {
    organizationId: string;
    actorUserId: string;
    agentId: string;
    tags: string[];
  }): Promise<OrganizationAgentRecord | null> {
    const existing = this.organizationAgents.get(input.agentId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return null;
    }
    const updated: OrganizationAgentRecord = {
      id: existing.id,
      organizationId: existing.organizationId,
      name: existing.name,
      revokedAt: existing.revokedAt,
      lastSeenAt: existing.lastSeenAt,
      capabilities: existing.capabilities,
      tags: input.tags,
      createdByUserId: existing.createdByUserId,
      createdAt: existing.createdAt,
    };
    this.organizationAgents.set(updated.id, { ...updated, tokenHash: (existing as any).tokenHash });
    return updated;
  }

  async revokeOrganizationAgent(input: { organizationId: string; actorUserId: string; agentId: string }): Promise<boolean> {
    const existing = this.organizationAgents.get(input.agentId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return false;
    }
    if (existing.revokedAt) {
      return true;
    }
    const updated = { ...existing, revokedAt: nowIso() };
    this.organizationAgents.set(updated.id, updated);
    return true;
  }

  async createExecutorPairingToken(input: {
    organizationId: string;
    actorUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<ExecutorPairingTokenRecord> {
    const token: ExecutorPairingTokenRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      usedAt: null,
      createdByUserId: input.actorUserId,
      createdAt: nowIso(),
    };
    this.executorPairingTokensByHash.set(token.tokenHash, token);
    return token;
  }

  async getExecutorPairingTokenByHash(input: {
    organizationId: string;
    actorUserId?: string;
    tokenHash: string;
  }): Promise<ExecutorPairingTokenRecord | null> {
    const token = this.executorPairingTokensByHash.get(input.tokenHash);
    if (!token || token.organizationId !== input.organizationId) {
      return null;
    }
    return token;
  }

  async consumeExecutorPairingToken(input: {
    organizationId: string;
    tokenHash: string;
  }): Promise<ExecutorPairingTokenRecord | null> {
    const token = this.executorPairingTokensByHash.get(input.tokenHash);
    if (!token || token.organizationId !== input.organizationId) {
      return null;
    }
    if (token.usedAt) {
      return null;
    }
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    const updated: ExecutorPairingTokenRecord = { ...token, usedAt: nowIso() };
    this.executorPairingTokensByHash.set(updated.tokenHash, updated);
    return updated;
  }

  async createOrganizationExecutor(input: {
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }): Promise<OrganizationExecutorRecord> {
    const executorId = crypto.randomUUID();
    const executor: OrganizationExecutorRecord = {
      id: executorId,
      organizationId: input.organizationId,
      name: input.name,
      revokedAt: null,
      lastSeenAt: null,
      capabilities: input.capabilities ?? null,
      labels: [],
      createdByUserId: input.createdByUserId,
      createdAt: nowIso(),
    };
    this.organizationExecutors.set(executor.id, { ...executor, tokenHash: input.tokenHash });
    this.organizationExecutorIdByTokenHash.set(input.tokenHash, executor.id);
    return executor;
  }

  async listOrganizationExecutors(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<OrganizationExecutorRecord[]> {
    return [...this.organizationExecutors.values()]
      .filter((executor) => executor.organizationId === input.organizationId)
      .map((executor) => ({
        id: executor.id,
        organizationId: executor.organizationId,
        name: executor.name,
        revokedAt: executor.revokedAt,
        lastSeenAt: executor.lastSeenAt,
        capabilities: executor.capabilities,
        labels: executor.labels ?? [],
        createdByUserId: executor.createdByUserId,
        createdAt: executor.createdAt,
      }));
  }

  async setOrganizationExecutorLabels(input: {
    organizationId: string;
    actorUserId: string;
    executorId: string;
    labels: string[];
  }): Promise<OrganizationExecutorRecord | null> {
    const existing = this.organizationExecutors.get(input.executorId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return null;
    }
    const updated: OrganizationExecutorRecord = {
      id: existing.id,
      organizationId: existing.organizationId,
      name: existing.name,
      revokedAt: existing.revokedAt,
      lastSeenAt: existing.lastSeenAt,
      capabilities: existing.capabilities,
      labels: input.labels,
      createdByUserId: existing.createdByUserId,
      createdAt: existing.createdAt,
    };
    this.organizationExecutors.set(updated.id, { ...updated, tokenHash: (existing as any).tokenHash });
    return updated;
  }

  async revokeOrganizationExecutor(input: {
    organizationId: string;
    actorUserId: string;
    executorId: string;
  }): Promise<boolean> {
    const existing = this.organizationExecutors.get(input.executorId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return false;
    }
    if (existing.revokedAt) {
      return true;
    }
    const updated = { ...existing, revokedAt: nowIso() };
    this.organizationExecutors.set(updated.id, updated);
    return true;
  }

  async deleteOrganizationExecutor(input: {
    organizationId: string;
    actorUserId: string;
    executorId: string;
  }): Promise<boolean> {
    const existing = this.organizationExecutors.get(input.executorId);
    if (!existing || existing.organizationId !== input.organizationId) {
      return false;
    }
    if (!existing.revokedAt) {
      return false;
    }
    this.organizationExecutors.delete(input.executorId);
    return true;
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
    const id = crypto.randomUUID();
    const record: ManagedExecutorRecord = {
      id,
      name: input.name,
      revokedAt: null,
      lastSeenAt: null,
      maxInFlight: Math.max(1, Math.floor(input.maxInFlight ?? 50)),
      enabled: input.enabled ?? true,
      drain: input.drain ?? false,
      runtimeClass: input.runtimeClass ?? "container",
      region: input.region ?? null,
      capabilities: input.capabilities ?? null,
      labels: input.labels ?? [],
      createdAt: nowIso(),
    };
    this.managedExecutors.set(id, {
      ...record,
      tokenHash: input.tokenHash,
    });
    return record;
  }

  async revokeManagedExecutor(input: { executorId: string }): Promise<boolean> {
    const existing = this.managedExecutors.get(input.executorId) ?? null;
    if (!existing) {
      return false;
    }
    if (existing.revokedAt) {
      return true;
    }
    this.managedExecutors.set(input.executorId, { ...existing, revokedAt: nowIso() });
    return true;
  }

  async listAgentToolsetsByOrg(input: { organizationId: string; actorUserId: string }): Promise<AgentToolsetRecord[]> {
    return [...this.toolsets.values()]
      .filter((t) => t.organizationId === input.organizationId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async createAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org";
    mcpServers: unknown;
    agentSkills: unknown;
  }): Promise<AgentToolsetRecord> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const toolset: AgentToolsetRecord = {
      id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      publicSlug: null,
      publishedAt: null,
      mcpServers: Array.isArray(input.mcpServers) ? (input.mcpServers as any) : [],
      agentSkills: Array.isArray(input.agentSkills) ? (input.agentSkills as any) : [],
      adoptedFrom: null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.toolsets.set(id, toolset);
    return toolset;
  }

  async getAgentToolsetById(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
  }): Promise<AgentToolsetRecord | null> {
    const row = this.toolsets.get(input.toolsetId) ?? null;
    if (!row || row.organizationId !== input.organizationId) return null;
    return row;
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
  }): Promise<AgentToolsetRecord | null> {
    const existing = this.toolsets.get(input.toolsetId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) return null;
    const next: AgentToolsetRecord = {
      ...existing,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      mcpServers: Array.isArray(input.mcpServers) ? (input.mcpServers as any) : [],
      agentSkills: Array.isArray(input.agentSkills) ? (input.agentSkills as any) : [],
      updatedByUserId: input.actorUserId,
      updatedAt: nowIso(),
    };
    this.toolsets.set(existing.id, next);
    return next;
  }

  async deleteAgentToolset(input: { organizationId: string; actorUserId: string; toolsetId: string }): Promise<boolean> {
    const existing = this.toolsets.get(input.toolsetId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) return false;
    this.toolsets.delete(existing.id);
    return true;
  }

  async publishAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    publicSlug: string;
  }): Promise<AgentToolsetRecord | null> {
    const existing = this.toolsets.get(input.toolsetId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) return null;

    for (const t of this.toolsets.values()) {
      if (t.id !== existing.id && t.visibility === "public" && t.publicSlug === input.publicSlug) {
        throw new Error("PUBLIC_SLUG_CONFLICT");
      }
    }

    const now = nowIso();
    const next: AgentToolsetRecord = {
      ...existing,
      visibility: "public",
      publicSlug: input.publicSlug,
      publishedAt: now,
      updatedByUserId: input.actorUserId,
      updatedAt: now,
    };
    this.toolsets.set(existing.id, next);
    return next;
  }

  async unpublishAgentToolset(input: {
    organizationId: string;
    actorUserId: string;
    toolsetId: string;
    visibility: "private" | "org";
  }): Promise<AgentToolsetRecord | null> {
    const existing = this.toolsets.get(input.toolsetId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) return null;
    const now = nowIso();
    const next: AgentToolsetRecord = {
      ...existing,
      visibility: input.visibility,
      publicSlug: null,
      publishedAt: null,
      updatedByUserId: input.actorUserId,
      updatedAt: now,
    };
    this.toolsets.set(existing.id, next);
    return next;
  }

  async listPublicToolsetGallery(input: { actorUserId: string }): Promise<AgentToolsetRecord[]> {
    return [...this.toolsets.values()]
      .filter((t) => t.visibility === "public" && typeof t.publicSlug === "string" && t.publicSlug.length > 0)
      .sort((a, b) => ((a.publishedAt ?? "") < (b.publishedAt ?? "") ? 1 : -1));
  }

  async getPublicToolsetBySlug(input: { actorUserId: string; publicSlug: string }): Promise<AgentToolsetRecord | null> {
    for (const t of this.toolsets.values()) {
      if (t.visibility === "public" && t.publicSlug === input.publicSlug) {
        return t;
      }
    }
    return null;
  }

  async adoptPublicToolset(input: {
    organizationId: string;
    actorUserId: string;
    publicSlug: string;
    nameOverride?: string | null;
    descriptionOverride?: string | null;
  }): Promise<AgentToolsetRecord | null> {
    const source = await this.getPublicToolsetBySlug({ actorUserId: input.actorUserId, publicSlug: input.publicSlug });
    if (!source) return null;

    const id = crypto.randomUUID();
    const now = nowIso();
    const toolset: AgentToolsetRecord = {
      id,
      organizationId: input.organizationId,
      name: input.nameOverride && input.nameOverride.trim().length > 0 ? input.nameOverride : source.name,
      description:
        input.descriptionOverride !== undefined && input.descriptionOverride !== null ? input.descriptionOverride : source.description ?? null,
      visibility: "org",
      publicSlug: null,
      publishedAt: null,
      mcpServers: source.mcpServers,
      agentSkills: source.agentSkills,
      adoptedFrom: { toolsetId: source.id, publicSlug: source.publicSlug },
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.toolsets.set(id, toolset);
    return toolset;
  }

  async createToolsetBuilderSession(input: { organizationId: string; actorUserId: string; llm: unknown; latestIntent?: string | null }) {
    const id = crypto.randomUUID();
    const now = nowIso();
    const record: ToolsetBuilderSessionRecord = {
      id,
      organizationId: input.organizationId,
      createdByUserId: input.actorUserId,
      status: "ACTIVE",
      llm: input.llm,
      latestIntent: input.latestIntent ?? null,
      selectedComponentKeys: [],
      finalDraft: null,
      createdAt: now,
      updatedAt: now,
    };
    this.toolsetBuilderSessions.set(id, record);
    this.toolsetBuilderTurnsBySessionId.set(id, []);
    return record;
  }

  async appendToolsetBuilderTurn(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    role: "USER" | "ASSISTANT";
    messageText: string;
  }) {
    const session = this.toolsetBuilderSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      throw new Error("TOOLSET_BUILDER_SESSION_NOT_FOUND");
    }

    this.toolsetBuilderTurnSeq += 1;
    const turn: ToolsetBuilderTurnRecord = {
      id: this.toolsetBuilderTurnSeq,
      sessionId: input.sessionId,
      role: input.role,
      messageText: input.messageText,
      createdAt: nowIso(),
    };
    const list = this.toolsetBuilderTurnsBySessionId.get(input.sessionId) ?? [];
    list.push(turn);
    this.toolsetBuilderTurnsBySessionId.set(input.sessionId, list);
    return turn;
  }

  async listToolsetBuilderTurns(input: { organizationId: string; actorUserId: string; sessionId: string; limit?: number }) {
    const session = this.toolsetBuilderSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      throw new Error("TOOLSET_BUILDER_SESSION_NOT_FOUND");
    }
    const list = this.toolsetBuilderTurnsBySessionId.get(input.sessionId) ?? [];
    const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 100;
    return list.slice(Math.max(0, list.length - limit));
  }

  async getToolsetBuilderSessionById(input: { organizationId: string; actorUserId: string; sessionId: string }) {
    const session = this.toolsetBuilderSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    return session;
  }

  async updateToolsetBuilderSessionSelection(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    latestIntent?: string | null;
    selectedComponentKeys: string[];
  }) {
    const existing = this.toolsetBuilderSessions.get(input.sessionId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) {
      return null;
    }
    const next: ToolsetBuilderSessionRecord = {
      ...existing,
      ...(input.latestIntent !== undefined ? { latestIntent: input.latestIntent } : {}),
      selectedComponentKeys: input.selectedComponentKeys,
      updatedAt: nowIso(),
    };
    this.toolsetBuilderSessions.set(existing.id, next);
    return next;
  }

  async finalizeToolsetBuilderSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    selectedComponentKeys: string[];
    finalDraft: unknown;
  }) {
    const existing = this.toolsetBuilderSessions.get(input.sessionId) ?? null;
    if (!existing || existing.organizationId !== input.organizationId) {
      return null;
    }
    const next: ToolsetBuilderSessionRecord = {
      ...existing,
      status: "FINALIZED",
      selectedComponentKeys: input.selectedComponentKeys,
      finalDraft: input.finalDraft,
      updatedAt: nowIso(),
    };
    this.toolsetBuilderSessions.set(existing.id, next);
    return next;
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
    runtime?: unknown;
    resetPolicySnapshot?: unknown;
    executorSelector?: { pool: "managed" | "byon"; labels?: string[]; group?: string; tag?: string; executorId?: string } | null;
  }): Promise<AgentSessionRecord> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const session: AgentSessionRecord = {
      id,
      organizationId: input.organizationId,
      createdByUserId: input.actorUserId,
      sessionKey: input.sessionKey ?? `session:${id}`,
      scope: input.scope ?? "main",
      title: input.title ?? "",
      status: "active",
      pinnedExecutorId: null,
      pinnedExecutorPool: null,
      pinnedAgentId: null,
      routedAgentId: input.routedAgentId ?? null,
      bindingId: input.bindingId ?? null,
      executionMode: "pinned-node-host",
      executorSelector: input.executorSelector ?? null,
      selectorTag: input.executorSelector?.tag ?? null,
      selectorGroup: input.executorSelector?.group ?? null,
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
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    this.agentSessions.set(id, session);
    this.agentSessionEventsBySessionId.set(id, []);
    this.agentSessionSeqBySessionId.set(id, 0);
    return session;
  }

  async listAgentSessions(input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    status?: "active" | "archived" | "all";
    cursor?: { updatedAt: string; id: string } | null;
  }): Promise<{ sessions: AgentSessionRecord[]; nextCursor: { updatedAt: string; id: string } | null }> {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
    const cursor = input.cursor ?? null;
    const status = input.status ?? "active";

    let sessions = [...this.agentSessions.values()].filter((s) => s.organizationId === input.organizationId);
    if (status !== "all") {
      sessions = sessions.filter((s) => s.status === status);
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

    if (cursor) {
      sessions = sessions.filter((s) => s.updatedAt < cursor.updatedAt || (s.updatedAt === cursor.updatedAt && s.id < cursor.id));
    }

    const page = sessions.slice(0, limit);
    const hasMore = sessions.length > limit;
    const nextCursor = hasMore && page.length > 0 ? { updatedAt: page[page.length - 1]!.updatedAt, id: page[page.length - 1]!.id } : null;
    return { sessions: page, nextCursor };
  }

  async archiveAgentSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
  }): Promise<AgentSessionRecord | null> {
    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();
    const patched: AgentSessionRecord = {
      ...session,
      status: "archived",
      updatedAt: now,
      lastActivityAt: now,
    };
    this.agentSessions.set(session.id, patched);
    return patched;
  }

  async restoreAgentSession(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
  }): Promise<AgentSessionRecord | null> {
    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();
    const patched: AgentSessionRecord = {
      ...session,
      status: "active",
      updatedAt: now,
      lastActivityAt: now,
    };
    this.agentSessions.set(session.id, patched);
    return patched;
  }

  async getAgentSessionById(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
  }): Promise<AgentSessionRecord | null> {
    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    return session;
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
    payload?: unknown;
  }): Promise<AgentSessionEventRecord> {
    const session = this.agentSessions.get(input.sessionId);
    if (!session || session.organizationId !== input.organizationId) {
      throw new Error("AGENT_SESSION_NOT_FOUND");
    }

    if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
      const existing = (this.agentSessionEventsBySessionId.get(input.sessionId) ?? []).find(
        (event) => event.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        return existing;
      }
    }

    const seq = this.agentSessionSeqBySessionId.get(input.sessionId) ?? 0;
    this.agentSessionSeqBySessionId.set(input.sessionId, seq + 1);

    const event: AgentSessionEventRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      seq,
      eventType: input.eventType,
      level: input.level,
      handoffFromAgentId: input.handoffFromAgentId ?? null,
      handoffToAgentId: input.handoffToAgentId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      payload: input.payload ?? null,
      createdAt: nowIso(),
    };
    const list = this.agentSessionEventsBySessionId.get(input.sessionId) ?? [];
    list.push(event);
    this.agentSessionEventsBySessionId.set(input.sessionId, list);

    const now = nowIso();
    this.agentSessions.set(input.sessionId, { ...session, updatedAt: now, lastActivityAt: now });

    return event;
  }

  async listAgentSessionEvents(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    limit: number;
    cursor?: { seq: number } | null;
  }): Promise<{ events: AgentSessionEventRecord[]; nextCursor: { seq: number } | null }> {
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
    const cursor = input.cursor ?? null;

    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return { events: [], nextCursor: null };
    }

    const list = this.agentSessionEventsBySessionId.get(input.sessionId) ?? [];
    const filtered = cursor ? list.filter((e) => e.seq > cursor.seq) : list;
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor = hasMore && page.length > 0 ? { seq: page[page.length - 1]!.seq } : null;
    return { events: page, nextCursor };
  }

  async setAgentSessionPinnedAgent(input: {
    organizationId: string;
    actorUserId: string;
    sessionId: string;
    pinnedAgentId?: string | null;
    pinnedExecutorId?: string | null;
    pinnedExecutorPool?: "managed" | "byon" | null;
  }): Promise<AgentSessionRecord | null> {
    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();
    const next = {
      ...session,
      ...(input.pinnedAgentId !== undefined ? { pinnedAgentId: input.pinnedAgentId } : {}),
      ...(input.pinnedExecutorId !== undefined ? { pinnedExecutorId: input.pinnedExecutorId } : {}),
      ...(input.pinnedExecutorPool !== undefined ? { pinnedExecutorPool: input.pinnedExecutorPool } : {}),
      updatedAt: now,
      lastActivityAt: now,
    };
    this.agentSessions.set(input.sessionId, next);
    return next;
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
    const session = this.agentSessions.get(input.sessionId) ?? null;
    if (!session || session.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();
    const next: AgentSessionRecord = {
      ...session,
      routedAgentId: input.routedAgentId,
      ...(input.bindingId !== undefined ? { bindingId: input.bindingId } : {}),
      ...(typeof input.sessionKey === "string" ? { sessionKey: input.sessionKey } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      updatedAt: now,
      lastActivityAt: now,
    };
    this.agentSessions.set(input.sessionId, next);
    return next;
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
    const now = nowIso();
    const row: AgentBindingRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      priority: Math.floor(input.priority),
      dimension: input.dimension,
      match: input.match ?? {},
      metadata: input.metadata ?? null,
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.agentBindings.set(row.id, row);
    return row;
  }

  async listAgentBindings(input: {
    organizationId: string;
    actorUserId: string;
  }): Promise<AgentBindingRecord[]> {
    return [...this.agentBindings.values()]
      .filter((row) => row.organizationId === input.organizationId)
      .sort((a, b) => a.dimension.localeCompare(b.dimension) || b.priority - a.priority || a.id.localeCompare(b.id));
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
    const current = this.agentBindings.get(input.bindingId) ?? null;
    if (!current || current.organizationId !== input.organizationId) {
      return null;
    }
    const next: AgentBindingRecord = {
      ...current,
      ...(input.patch.agentId !== undefined ? { agentId: input.patch.agentId } : {}),
      ...(input.patch.priority !== undefined ? { priority: Math.floor(input.patch.priority) } : {}),
      ...(input.patch.dimension !== undefined ? { dimension: input.patch.dimension } : {}),
      ...(input.patch.match !== undefined ? { match: input.patch.match } : {}),
      ...(input.patch.metadata !== undefined ? { metadata: input.patch.metadata } : {}),
      updatedAt: nowIso(),
    };
    this.agentBindings.set(next.id, next);
    return next;
  }

  async deleteAgentBinding(input: {
    organizationId: string;
    actorUserId: string;
    bindingId: string;
  }): Promise<boolean> {
    const current = this.agentBindings.get(input.bindingId) ?? null;
    if (!current || current.organizationId !== input.organizationId) {
      return false;
    }
    this.agentBindings.delete(input.bindingId);
    return true;
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
    const now = nowIso();
    const row: AgentMemorySyncJobRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      sessionId: input.sessionId ?? null,
      sessionKey: input.sessionKey,
      provider: input.provider,
      status: input.status ?? "queued",
      reason: input.reason ?? null,
      details: input.details ?? {},
      startedAt: input.status === "running" ? now : null,
      finishedAt: input.status === "succeeded" || input.status === "failed" ? now : null,
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.agentMemorySyncJobs.set(row.id, row);
    return row;
  }

  async listAgentMemoryDocuments(input: {
    organizationId: string;
    actorUserId: string;
    sessionKey?: string;
    limit?: number;
  }): Promise<AgentMemoryDocumentRecord[]> {
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 200)));
    return [...this.agentMemoryDocuments.values()]
      .filter((row) => row.organizationId === input.organizationId)
      .filter((row) => !input.sessionKey || row.sessionKey === input.sessionKey)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async getAgentMemoryDocumentById(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
  }): Promise<AgentMemoryDocumentRecord | null> {
    const row = this.agentMemoryDocuments.get(input.documentId) ?? null;
    if (!row || row.organizationId !== input.organizationId) {
      return null;
    }
    return row;
  }

  async listAgentMemoryChunksByDocument(input: {
    organizationId: string;
    actorUserId: string;
    documentId: string;
    limit?: number;
  }): Promise<AgentMemoryChunkRecord[]> {
    const limit = Math.max(1, Math.min(2000, Math.floor(input.limit ?? 400)));
    return (this.agentMemoryChunksByDocumentId.get(input.documentId) ?? [])
      .filter((row) => row.organizationId === input.organizationId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, limit);
  }

  async listChannelAccounts(input: {
    organizationId: string;
    actorUserId: string;
    channelId?: string | null;
  }): Promise<ChannelAccountRecord[]> {
    return [...this.channelAccounts.values()]
      .filter((row) => row.organizationId === input.organizationId)
      .filter((row) => !input.channelId || row.channelId === input.channelId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
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
    const duplicate = [...this.channelAccounts.values()].some(
      (row) =>
        row.organizationId === input.organizationId &&
        row.channelId === input.channelId &&
        row.accountKey.toLowerCase() === input.accountKey.toLowerCase()
    );
    if (duplicate) {
      throw new Error("CHANNEL_ACCOUNT_EXISTS");
    }
    const now = nowIso();
    const row: ChannelAccountRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      channelId: input.channelId,
      accountKey: input.accountKey,
      displayName: input.displayName ?? null,
      enabled: input.enabled ?? true,
      status: "stopped",
      dmPolicy: input.dmPolicy ?? "pairing",
      groupPolicy: input.groupPolicy ?? "allowlist",
      requireMentionInGroup: input.requireMentionInGroup ?? true,
      webhookUrl: input.webhookUrl ?? null,
      metadata: input.metadata ?? {},
      lastError: null,
      lastSeenAt: null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.channelAccounts.set(row.id, row);
    return row;
  }

  async getChannelAccountById(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountRecord | null> {
    const row = this.channelAccounts.get(input.accountId) ?? null;
    if (!row || row.organizationId !== input.organizationId) {
      return null;
    }
    return row;
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
    const current = await this.getChannelAccountById(input);
    if (!current) {
      return null;
    }
    const updated: ChannelAccountRecord = {
      ...current,
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
      updatedAt: nowIso(),
    };
    this.channelAccounts.set(updated.id, updated);
    return updated;
  }

  async deleteChannelAccount(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<boolean> {
    const row = await this.getChannelAccountById(input);
    if (!row) {
      return false;
    }
    for (const [id, secret] of this.channelAccountSecrets.entries()) {
      if (secret.accountId === row.id) {
        this.channelAccountSecrets.delete(id);
      }
    }
    for (const [id, entry] of this.channelAllowlistEntries.entries()) {
      if (entry.accountId === row.id) {
        this.channelAllowlistEntries.delete(id);
      }
    }
    this.channelEvents.delete(row.id);
    return this.channelAccounts.delete(row.id);
  }

  async createChannelAccountSecret(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    name: string;
    value: string;
  }): Promise<ChannelAccountSecretRecord> {
    const account = await this.getChannelAccountById({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      accountId: input.accountId,
    });
    if (!account) {
      throw new Error("CHANNEL_ACCOUNT_NOT_FOUND");
    }
    const exists = [...this.channelAccountSecrets.values()].some(
      (row) => row.organizationId === input.organizationId && row.accountId === input.accountId && row.name === input.name
    );
    if (exists) {
      throw new Error("CHANNEL_SECRET_EXISTS");
    }
    const now = nowIso();
    const row: ChannelAccountSecretRecord & { value: string } = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      accountId: input.accountId,
      name: input.name,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
      value: input.value,
    };
    this.channelAccountSecrets.set(row.id, row);
    return {
      id: row.id,
      organizationId: row.organizationId,
      accountId: row.accountId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listChannelAccountSecrets(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
  }): Promise<ChannelAccountSecretRecord[]> {
    return [...this.channelAccountSecrets.values()]
      .filter((row) => row.organizationId === input.organizationId && row.accountId === input.accountId)
      .map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        accountId: row.accountId,
        name: row.name,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listChannelPairingRequests(input: {
    organizationId: string;
    actorUserId: string;
    accountId?: string | null;
    status?: string | null;
  }): Promise<ChannelPairingRequestRecord[]> {
    return [...this.channelPairingRequests.values()]
      .filter((row) => row.organizationId === input.organizationId)
      .filter((row) => !input.accountId || row.accountId === input.accountId)
      .filter((row) => !input.status || row.status === input.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listChannelAllowlistEntries(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope?: string | null;
  }): Promise<ChannelAllowlistEntryRecord[]> {
    const account = await this.getChannelAccountById({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      accountId: input.accountId,
    });
    if (!account) {
      return [];
    }
    return [...this.channelAllowlistEntries.values()]
      .filter((row) => row.organizationId === input.organizationId && row.accountId === input.accountId)
      .filter((row) => !input.scope || row.scope === input.scope)
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.subject.localeCompare(b.subject));
  }

  async putChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<ChannelAllowlistEntryRecord> {
    const account = await this.getChannelAccountById({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      accountId: input.accountId,
    });
    if (!account) {
      throw new Error("CHANNEL_ACCOUNT_NOT_FOUND");
    }
    const existing = [...this.channelAllowlistEntries.values()].find(
      (row) =>
        row.organizationId === input.organizationId &&
        row.accountId === input.accountId &&
        row.scope === input.scope &&
        row.subject === input.subject
    );
    if (existing) {
      return existing;
    }
    const row: ChannelAllowlistEntryRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      accountId: input.accountId,
      scope: input.scope,
      subject: input.subject,
      createdByUserId: input.actorUserId,
      createdAt: nowIso(),
    };
    this.channelAllowlistEntries.set(row.id, row);
    return row;
  }

  async deleteChannelAllowlistEntry(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    scope: string;
    subject: string;
  }): Promise<boolean> {
    const account = await this.getChannelAccountById({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      accountId: input.accountId,
    });
    if (!account) {
      return false;
    }
    for (const [id, row] of this.channelAllowlistEntries.entries()) {
      if (
        row.organizationId === input.organizationId &&
        row.accountId === input.accountId &&
        row.scope === input.scope &&
        row.subject === input.subject
      ) {
        this.channelAllowlistEntries.delete(id);
        return true;
      }
    }
    return false;
  }

  async updateChannelPairingRequestStatus(input: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    status: "approved" | "rejected";
  }): Promise<ChannelPairingRequestRecord | null> {
    const row = this.channelPairingRequests.get(input.requestId) ?? null;
    if (!row || row.organizationId !== input.organizationId) {
      return null;
    }
    const now = nowIso();
    const updated: ChannelPairingRequestRecord = {
      ...row,
      status: input.status,
      approvedByUserId: input.status === "approved" ? input.actorUserId : row.approvedByUserId,
      approvedAt: input.status === "approved" ? now : row.approvedAt,
      rejectedAt: input.status === "rejected" ? now : row.rejectedAt,
    };
    this.channelPairingRequests.set(updated.id, updated);
    return updated;
  }

  async listChannelEvents(input: {
    organizationId: string;
    actorUserId: string;
    accountId: string;
    limit?: number;
  }): Promise<ChannelEventRecord[]> {
    const account = await this.getChannelAccountById({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      accountId: input.accountId,
    });
    if (!account) {
      return [];
    }
    const list = this.channelEvents.get(account.id) ?? [];
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async attachMembership(input: {
    organizationId: string;
    userId: string;
    roleKey: "owner" | "admin" | "member";
  }): Promise<MembershipRecord> {
    const membership: MembershipRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      roleKey: input.roleKey,
      createdAt: nowIso(),
    };
    this.memberships.set(membership.id, membership);
    return membership;
  }
}
