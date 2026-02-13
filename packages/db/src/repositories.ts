import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  authSessions,
  agentPairingTokens,
  connectorSecrets,
  organizationAgents,
  memberships,
  organizationInvitations,
  organizations,
  roles,
  users,
  workflowRunEvents,
  workflowRuns,
  workflows,
} from "./schema.js";

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function ensureDefaultRoles(db: Db): Promise<void> {
  const existing = await db.select().from(roles);
  if (existing.length > 0) {
    return;
  }

  await db.insert(roles).values([
    { key: "owner", name: "Owner" },
    { key: "admin", name: "Admin" },
    { key: "member", name: "Member" },
  ]);
}

export async function createUser(db: Db, input: { email: string; passwordHash: string; displayName?: string | null }) {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create user");
  }
  return row;
}

export async function getUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

export async function getUserById(db: Db, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function createOrganizationWithOwner(
  db: Db,
  input: { id?: string; name: string; slug: string; ownerUserId: string }
) {
  const organizationId = input.id ?? crypto.randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ id: organizationId, name: input.name, slug: input.slug })
    .returning();

  if (!organization) {
    throw new Error("Failed to create organization");
  }

  const [membership] = await db
    .insert(memberships)
    .values({
      organizationId: organization.id,
      userId: input.ownerUserId,
      roleKey: "owner",
    })
    .returning();

  if (!membership) {
    throw new Error("Failed to create owner membership");
  }

  return { organization, membership };
}

export async function getMembership(db: Db, input: { organizationId: string; userId: string }) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, input.userId)));
  return row ?? null;
}

export async function createInvitation(
  db: Db,
  input: { organizationId: string; email: string; roleKey: "admin" | "member"; invitedByUserId: string; ttlHours?: number }
) {
  const ttlHours = input.ttlHours ?? 72;
  const token = `${input.organizationId}.${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [row] = await db
    .insert(organizationInvitations)
    .values({
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      roleKey: input.roleKey,
      invitedByUserId: input.invitedByUserId,
      token,
      expiresAt,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create invitation");
  }
  return row;
}

export async function getInvitationByToken(db: Db, token: string) {
  const [row] = await db.select().from(organizationInvitations).where(eq(organizationInvitations.token, token));
  return row ?? null;
}

export async function markInvitationAccepted(db: Db, invitationId: string) {
  const [row] = await db
    .update(organizationInvitations)
    .set({ status: "accepted" })
    .where(eq(organizationInvitations.id, invitationId))
    .returning();
  return row ?? null;
}

export async function createMembershipIfNotExists(
  db: Db,
  input: { organizationId: string; userId: string; roleKey: "owner" | "admin" | "member" }
) {
  const existing = await getMembership(db, { organizationId: input.organizationId, userId: input.userId });
  if (existing) {
    return existing;
  }

  const [row] = await db
    .insert(memberships)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      roleKey: input.roleKey,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create membership");
  }
  return row;
}

export async function createAuthSession(
  db: Db,
  input: {
    id?: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }
) {
  const [row] = await db
    .insert(authSessions)
    .values({
      id: input.id,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create auth session");
  }
  return row;
}

export async function getAuthSessionById(db: Db, id: string) {
  const [row] = await db.select().from(authSessions).where(eq(authSessions.id, id));
  return row ?? null;
}

export async function getAuthSessionByRefreshTokenHash(db: Db, refreshTokenHash: string) {
  const [row] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshTokenHash, refreshTokenHash));
  return row ?? null;
}

export async function touchAuthSession(db: Db, sessionId: string) {
  const [row] = await db
    .update(authSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(authSessions.id, sessionId))
    .returning();
  return row ?? null;
}

export async function rotateAuthSessionRefreshToken(
  db: Db,
  input: { sessionId: string; refreshTokenHash: string; expiresAt: Date }
) {
  const [row] = await db
    .update(authSessions)
    .set({
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      lastUsedAt: new Date(),
    })
    .where(eq(authSessions.id, input.sessionId))
    .returning();
  return row ?? null;
}

export async function revokeAuthSession(db: Db, sessionId: string) {
  const [row] = await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    .returning();
  return row ?? null;
}

export async function revokeAllUserAuthSessions(db: Db, userId: string) {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning();
  return rows;
}

export function isAuthSessionActive(input: { expiresAt: Date; revokedAt: Date | null; now?: Date }) {
  const now = input.now ?? new Date();
  return input.revokedAt === null && input.expiresAt.getTime() > now.getTime();
}

export async function updateMembershipRole(
  db: Db,
  input: { organizationId: string; memberUserId: string; roleKey: "owner" | "admin" | "member" }
) {
  const [row] = await db
    .update(memberships)
    .set({ roleKey: input.roleKey })
    .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, input.memberUserId)))
    .returning();
  return row ?? null;
}

export async function createWorkflow(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    dsl: unknown;
    createdByUserId: string;
  }
) {
  const [row] = await db
    .insert(workflows)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      status: "draft",
      version: 1,
      dsl: input.dsl,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create workflow");
  }
  return row;
}

export async function getWorkflowById(db: Db, input: { organizationId: string; workflowId: string }) {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.organizationId, input.organizationId), eq(workflows.id, input.workflowId)));
  return row ?? null;
}

export async function publishWorkflow(
  db: Db,
  input: { organizationId: string; workflowId: string }
) {
  const current = await getWorkflowById(db, input);
  if (!current) {
    return null;
  }

  const [row] = await db
    .update(workflows)
    .set({
      status: "published",
      version: current.version + 1,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(workflows.organizationId, input.organizationId), eq(workflows.id, input.workflowId)))
    .returning();
  return row ?? null;
}

export async function createWorkflowRun(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    triggerType: "manual";
    requestedByUserId: string;
    input?: unknown;
    maxAttempts?: number;
  }
) {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      triggerType: input.triggerType,
      status: "queued",
      requestedByUserId: input.requestedByUserId,
      input: input.input ?? null,
      maxAttempts: input.maxAttempts ?? 3,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create workflow run");
  }
  return row;
}

export async function getWorkflowRunById(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string }
) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId)
      )
    );
  return row ?? null;
}

export async function listWorkflowRuns(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
  }
) {
  const limit = Math.min(200, Math.max(1, input.limit));

  const baseWhere = and(eq(workflowRuns.organizationId, input.organizationId), eq(workflowRuns.workflowId, input.workflowId));
  const cursorWhere = input.cursor
    ? or(
        lt(workflowRuns.createdAt, input.cursor.createdAt),
        and(eq(workflowRuns.createdAt, input.cursor.createdAt), lt(workflowRuns.id, input.cursor.id))
      )
    : null;

  const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere;

  const rows = await db
    .select()
    .from(workflowRuns)
    .where(where)
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(limit);

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;

  return { rows, nextCursor };
}

export async function markWorkflowRunRunning(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string; attemptCount?: number }
) {
  const updates: {
    status: "running";
    startedAt: Date;
    error: null;
    nextAttemptAt: null;
    attemptCount?: number;
  } = {
    status: "running",
    startedAt: new Date(),
    error: null,
    nextAttemptAt: null,
  };
  if (typeof input.attemptCount === "number") {
    updates.attemptCount = input.attemptCount;
  }

  const [row] = await db
    .update(workflowRuns)
    .set(updates)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId)
      )
    )
    .returning();
  return row ?? null;
}

export async function appendWorkflowRunEvent(
  db: Db,
  input: {
    id?: string;
    organizationId: string;
    workflowId: string;
    runId: string;
    attemptCount: number;
    eventType: string;
    nodeId?: string | null;
    nodeType?: string | null;
    level: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }
) {
  const [row] = await db
    .insert(workflowRunEvents)
    .values({
      id: input.id,
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
    .returning();
  return row ?? null;
}

export async function listWorkflowRunEvents(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
  }
) {
  const limit = Math.min(500, Math.max(1, input.limit));

  const baseWhere = and(
    eq(workflowRunEvents.organizationId, input.organizationId),
    eq(workflowRunEvents.workflowId, input.workflowId),
    eq(workflowRunEvents.runId, input.runId)
  );

  const cursorWhere = input.cursor
    ? or(
        gt(workflowRunEvents.createdAt, input.cursor.createdAt),
        and(eq(workflowRunEvents.createdAt, input.cursor.createdAt), gt(workflowRunEvents.id, input.cursor.id))
      )
    : null;

  const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere;

  const rows = await db
    .select()
    .from(workflowRunEvents)
    .where(where)
    .orderBy(asc(workflowRunEvents.createdAt), asc(workflowRunEvents.id))
    .limit(limit);

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;

  return { rows, nextCursor };
}

export async function deleteQueuedWorkflowRun(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string }
) {
  const [row] = await db
    .delete(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId),
        eq(workflowRuns.status, "queued"),
        eq(workflowRuns.attemptCount, 0)
      )
    )
    .returning();
  return row ?? null;
}

export async function claimNextQueuedWorkflowRun(db: Db) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.status, "queued"),
          or(isNull(workflowRuns.nextAttemptAt), lte(workflowRuns.nextAttemptAt, sql`now()`))
        )
      )
      .orderBy(asc(workflowRuns.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) {
      return null;
    }

    const [claimed] = await tx
      .update(workflowRuns)
      .set({
        status: "running",
        attemptCount: sql`${workflowRuns.attemptCount} + 1`,
        startedAt: sql`coalesce(${workflowRuns.startedAt}, now())`,
        error: null,
      })
      .where(eq(workflowRuns.id, candidate.id))
      .returning();

    return claimed ?? null;
  });
}

export async function markWorkflowRunQueuedForRetry(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    error: string;
    nextAttemptAt?: Date | null;
  }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      status: "queued",
      error: input.error,
      nextAttemptAt: input.nextAttemptAt ?? null,
      finishedAt: null,
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId)
      )
    )
    .returning();
  return row ?? null;
}

export async function markWorkflowRunSucceeded(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string; output: unknown }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      status: "succeeded",
      output: input.output,
      error: null,
      nextAttemptAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId)
      )
    )
    .returning();
  return row ?? null;
}

export async function markWorkflowRunFailed(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string; error: string }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      status: "failed",
      error: input.error,
      nextAttemptAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId)
      )
    )
    .returning();
  return row ?? null;
}

export async function createConnectorSecret(
  db: Db,
  input: {
    id?: string;
    organizationId: string;
    connectorId: string;
    name: string;
    kekId: string;
    dekCiphertext: Buffer;
    dekIv: Buffer;
    dekTag: Buffer;
    secretCiphertext: Buffer;
    secretIv: Buffer;
    secretTag: Buffer;
    createdByUserId: string;
    updatedByUserId: string;
  }
) {
  try {
    const [row] = await db
      .insert(connectorSecrets)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        connectorId: input.connectorId,
        name: input.name,
        kekId: input.kekId,
        dekCiphertext: input.dekCiphertext,
        dekIv: input.dekIv,
        dekTag: input.dekTag,
        secretCiphertext: input.secretCiphertext,
        secretIv: input.secretIv,
        secretTag: input.secretTag,
        createdByUserId: input.createdByUserId,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create connector secret");
    }
    return row;
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new Error("SECRET_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function listConnectorSecrets(
  db: Db,
  input: { organizationId: string; connectorId?: string | null }
) {
  const where = input.connectorId
    ? and(eq(connectorSecrets.organizationId, input.organizationId), eq(connectorSecrets.connectorId, input.connectorId))
    : eq(connectorSecrets.organizationId, input.organizationId);

  const rows = await db
    .select({
      id: connectorSecrets.id,
      organizationId: connectorSecrets.organizationId,
      connectorId: connectorSecrets.connectorId,
      name: connectorSecrets.name,
      kekId: connectorSecrets.kekId,
      createdByUserId: connectorSecrets.createdByUserId,
      updatedByUserId: connectorSecrets.updatedByUserId,
      createdAt: connectorSecrets.createdAt,
      updatedAt: connectorSecrets.updatedAt,
    })
    .from(connectorSecrets)
    .where(where)
    .orderBy(asc(connectorSecrets.connectorId), asc(connectorSecrets.name));

  return rows;
}

export async function getConnectorSecretById(
  db: Db,
  input: { organizationId: string; secretId: string }
) {
  const [row] = await db
    .select()
    .from(connectorSecrets)
    .where(and(eq(connectorSecrets.organizationId, input.organizationId), eq(connectorSecrets.id, input.secretId)));
  return row ?? null;
}

export async function updateConnectorSecretValue(
  db: Db,
  input: {
    organizationId: string;
    secretId: string;
    kekId: string;
    dekCiphertext: Buffer;
    dekIv: Buffer;
    dekTag: Buffer;
    secretCiphertext: Buffer;
    secretIv: Buffer;
    secretTag: Buffer;
    updatedByUserId: string;
  }
) {
  const [row] = await db
    .update(connectorSecrets)
    .set({
      kekId: input.kekId,
      dekCiphertext: input.dekCiphertext,
      dekIv: input.dekIv,
      dekTag: input.dekTag,
      secretCiphertext: input.secretCiphertext,
      secretIv: input.secretIv,
      secretTag: input.secretTag,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(connectorSecrets.organizationId, input.organizationId), eq(connectorSecrets.id, input.secretId)))
    .returning();

  return row ?? null;
}

export async function deleteConnectorSecret(
  db: Db,
  input: { organizationId: string; secretId: string }
) {
  const [row] = await db
    .delete(connectorSecrets)
    .where(and(eq(connectorSecrets.organizationId, input.organizationId), eq(connectorSecrets.id, input.secretId)))
    .returning();
  return row ?? null;
}

export async function createAgentPairingToken(
  db: Db,
  input: { organizationId: string; tokenHash: string; expiresAt: Date; createdByUserId: string }
) {
  const [row] = await db
    .insert(agentPairingTokens)
    .values({
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create agent pairing token");
  }
  return row;
}

export async function getAgentPairingTokenByHash(db: Db, input: { organizationId: string; tokenHash: string }) {
  const [row] = await db
    .select()
    .from(agentPairingTokens)
    .where(and(eq(agentPairingTokens.organizationId, input.organizationId), eq(agentPairingTokens.tokenHash, input.tokenHash)));
  return row ?? null;
}

export async function consumeAgentPairingToken(
  db: Db,
  input: { organizationId: string; tokenHash: string }
) {
  const [row] = await db
    .update(agentPairingTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(agentPairingTokens.organizationId, input.organizationId),
        eq(agentPairingTokens.tokenHash, input.tokenHash),
        isNull(agentPairingTokens.usedAt),
        gt(agentPairingTokens.expiresAt, sql`now()`)
      )
    )
    .returning();
  return row ?? null;
}

export async function createOrganizationAgent(
  db: Db,
  input: {
    id?: string;
    organizationId: string;
    name: string;
    tokenHash: string;
    createdByUserId: string;
    capabilities?: unknown;
  }
) {
  const [row] = await db
    .insert(organizationAgents)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      tokenHash: input.tokenHash,
      revokedAt: null,
      lastSeenAt: new Date(),
      capabilities: (input.capabilities ?? null) as any,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create organization agent");
  }
  return row;
}

export async function getOrganizationAgentByTokenHash(
  db: Db,
  input: { organizationId: string; tokenHash: string }
) {
  const [row] = await db
    .select()
    .from(organizationAgents)
    .where(
      and(eq(organizationAgents.organizationId, input.organizationId), eq(organizationAgents.tokenHash, input.tokenHash))
    );
  return row ?? null;
}

export async function listOrganizationAgents(db: Db, input: { organizationId: string }) {
  const rows = await db
    .select()
    .from(organizationAgents)
    .where(eq(organizationAgents.organizationId, input.organizationId))
    .orderBy(desc(organizationAgents.createdAt));
  return rows;
}

export async function touchOrganizationAgentLastSeen(
  db: Db,
  input: { organizationId: string; agentId: string }
) {
  const [row] = await db
    .update(organizationAgents)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(organizationAgents.organizationId, input.organizationId), eq(organizationAgents.id, input.agentId)))
    .returning();
  return row ?? null;
}

export async function revokeOrganizationAgent(
  db: Db,
  input: { organizationId: string; agentId: string }
) {
  const [row] = await db
    .update(organizationAgents)
    .set({ revokedAt: new Date() })
    .where(and(eq(organizationAgents.organizationId, input.organizationId), eq(organizationAgents.id, input.agentId)))
    .returning();
  return row ?? null;
}
