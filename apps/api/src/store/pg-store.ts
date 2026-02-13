import {
  createAuthSession,
  createDb,
  createPool,
  createInvitation,
  createOrganizationWithOwner,
  createMembershipIfNotExists,
  createUser,
  ensureDefaultRoles,
  getAuthSessionById,
  getInvitationByToken,
  getMembership,
  getUserById,
  getUserByEmail,
  markInvitationAccepted,
  revokeAllUserAuthSessions,
  revokeAuthSession,
  rotateAuthSessionRefreshToken,
  touchAuthSession,
  updateMembershipRole,
  withTenantContext,
  createWorkflow as dbCreateWorkflow,
  getWorkflowById as dbGetWorkflowById,
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
} from "@vespid/db";
import crypto from "node:crypto";
import type { AppStore } from "../types.js";

function toIso(value: Date): string {
  return value.toISOString();
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
    input: { userId: string; organizationId: string },
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
    triggerType: "manual";
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
      triggerType: row.triggerType as "manual",
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
        triggerType: row.triggerType as "manual",
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
      triggerType: row.triggerType as "manual",
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
      triggerType: row.triggerType as "manual",
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
      triggerType: row.triggerType as "manual",
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
      triggerType: row.triggerType as "manual",
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
      triggerType: row.triggerType as "manual",
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
}
