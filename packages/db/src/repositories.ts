import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  authSessions,
  memberships,
  organizationInvitations,
  organizations,
  roles,
  users,
  workflowRuns,
  workflows,
} from "./schema.js";

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

export async function markWorkflowRunRunning(
  db: Db,
  input: { organizationId: string; workflowId: string; runId: string }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      status: "running",
      startedAt: new Date(),
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
