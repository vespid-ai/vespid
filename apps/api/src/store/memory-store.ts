import crypto from "node:crypto";
import type {
  AppStore,
  InvitationAcceptResultRecord,
  InvitationRecord,
  MembershipRecord,
  OrganizationRecord,
  SessionRecord,
  UserRecord,
  WorkflowRecord,
  WorkflowRunRecord,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryAppStore implements AppStore {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private organizations = new Map<string, OrganizationRecord>();
  private memberships = new Map<string, MembershipRecord>();
  private invitations = new Map<string, InvitationRecord>();
  private sessions = new Map<string, SessionRecord>();
  private workflows = new Map<string, WorkflowRecord>();
  private workflowRuns = new Map<string, WorkflowRunRecord>();

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
