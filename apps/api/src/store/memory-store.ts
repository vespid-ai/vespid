import crypto from "node:crypto";
import { encryptSecret, parseKekFromEnv } from "@vespid/shared";
import type {
  AppStore,
  AgentToolsetRecord,
  AgentPairingTokenRecord,
  ConnectorSecretRecord,
  InvitationAcceptResultRecord,
  InvitationRecord,
  MembershipRecord,
  OrganizationAgentRecord,
  OrganizationRecord,
  OrganizationSettings,
  SessionRecord,
  UserRecord,
  WorkflowRecord,
  WorkflowRunEventRecord,
  WorkflowRunRecord,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryAppStore implements AppStore {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
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
  private organizationAgents = new Map<
    string,
    (OrganizationAgentRecord & {
      tokenHash: string;
    })
  >();
  private organizationAgentIdByTokenHash = new Map<string, string>();
  private toolsets = new Map<string, AgentToolsetRecord>();

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
    const workflow: WorkflowRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      status: "draft",
      version: 1,
      dsl: input.dsl,
      createdByUserId: input.createdByUserId,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
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
    triggerType: "manual";
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
