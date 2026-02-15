import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  authSessions,
  agentPairingTokens,
  agentToolsets,
  connectorSecrets,
  organizationBillingAccounts,
  organizationCreditBalances,
  organizationCreditLedger,
  organizationAgents,
  memberships,
  organizationInvitations,
  organizations,
  roles,
  toolsetBuilderSessions,
  toolsetBuilderTurns,
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

export async function listOrganizationsForUser(db: Db, input: { userId: string }) {
  const rows = await db
    .select({
      organizationId: organizations.id,
      organizationSlug: organizations.slug,
      organizationName: organizations.name,
      organizationSettings: organizations.settings,
      organizationCreatedAt: organizations.createdAt,
      membershipId: memberships.id,
      membershipOrganizationId: memberships.organizationId,
      membershipUserId: memberships.userId,
      membershipRoleKey: memberships.roleKey,
      membershipCreatedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, input.userId))
    .orderBy(asc(organizations.createdAt), asc(organizations.id));

  return rows.map((row) => ({
    organization: {
      id: row.organizationId,
      slug: row.organizationSlug,
      name: row.organizationName,
      settings: row.organizationSettings,
      createdAt: row.organizationCreatedAt,
    },
    membership: {
      id: row.membershipId,
      organizationId: row.membershipOrganizationId,
      userId: row.membershipUserId,
      roleKey: row.membershipRoleKey,
      createdAt: row.membershipCreatedAt,
    },
  }));
}

export async function getOrganizationById(db: Db, input: { organizationId: string }) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, input.organizationId));
  return row ?? null;
}

export async function ensureOrganizationCreditBalanceRow(db: Db, input: { organizationId: string }) {
  const existing = await getOrganizationCreditBalance(db, input);
  if (existing) {
    return existing;
  }

  try {
    const [row] = await db
      .insert(organizationCreditBalances)
      .values({ organizationId: input.organizationId, balanceCredits: 0 })
      .returning();
    if (!row) {
      throw new Error("Failed to create organization credit balance row");
    }
    return row;
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    const retry = await getOrganizationCreditBalance(db, input);
    if (!retry) {
      throw new Error("Failed to load organization credit balance row after unique violation");
    }
    return retry;
  }
}

export async function getOrganizationCreditBalance(db: Db, input: { organizationId: string }) {
  const [row] = await db
    .select()
    .from(organizationCreditBalances)
    .where(eq(organizationCreditBalances.organizationId, input.organizationId));
  return row ?? null;
}

export async function tryDebitOrganizationCredits(
  db: Db,
  input: {
    organizationId: string;
    credits: number;
    reason: string;
    stripeEventId?: string | null;
    workflowRunId?: string | null;
    createdByUserId?: string | null;
    metadata?: unknown;
  }
): Promise<{ ok: true; balanceCredits: number } | { ok: false; balanceCredits: number }> {
  const credits = Math.max(0, Math.floor(input.credits));
  if (credits <= 0) {
    const balanceRow = await ensureOrganizationCreditBalanceRow(db, { organizationId: input.organizationId });
    return { ok: true, balanceCredits: balanceRow.balanceCredits };
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(organizationCreditBalances)
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .limit(1)
      .for("update");

    const current = locked ?? (await ensureOrganizationCreditBalanceRow(tx as any, { organizationId: input.organizationId }));
    const balance = current.balanceCredits;
    if (balance < credits) {
      return { ok: false, balanceCredits: balance };
    }

    await tx.insert(organizationCreditLedger).values({
      organizationId: input.organizationId,
      deltaCredits: -credits,
      reason: input.reason,
      stripeEventId: input.stripeEventId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      metadata: input.metadata as any,
    });

    const [updated] = await tx
      .update(organizationCreditBalances)
      .set({
        balanceCredits: balance - credits,
        updatedAt: new Date(),
      })
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .returning();

    return { ok: true, balanceCredits: updated?.balanceCredits ?? balance - credits };
  });
}

export async function creditOrganizationFromStripeEvent(
  db: Db,
  input: {
    organizationId: string;
    credits: number;
    stripeEventId: string;
    metadata?: unknown;
  }
): Promise<{ applied: true; balanceCredits: number } | { applied: false; balanceCredits: number }> {
  const credits = Math.max(0, Math.floor(input.credits));
  if (credits <= 0) {
    const balanceRow = await ensureOrganizationCreditBalanceRow(db, { organizationId: input.organizationId });
    return { applied: true, balanceCredits: balanceRow.balanceCredits };
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(organizationCreditBalances)
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .limit(1)
      .for("update");
    const current = locked ?? (await ensureOrganizationCreditBalanceRow(tx as any, { organizationId: input.organizationId }));

    try {
      await tx.insert(organizationCreditLedger).values({
        organizationId: input.organizationId,
        deltaCredits: credits,
        reason: "stripe_topup",
        stripeEventId: input.stripeEventId,
        metadata: input.metadata as any,
      });
    } catch (error) {
      if (!isPgUniqueViolation(error)) {
        throw error;
      }
      // Already processed.
      return { applied: false, balanceCredits: current.balanceCredits };
    }

    const [updated] = await tx
      .update(organizationCreditBalances)
      .set({
        balanceCredits: current.balanceCredits + credits,
        updatedAt: new Date(),
      })
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .returning();

    return { applied: true, balanceCredits: updated?.balanceCredits ?? current.balanceCredits + credits };
  });
}

export async function grantOrganizationCredits(
  db: Db,
  input: {
    organizationId: string;
    credits: number;
    reason: string;
    createdByUserId?: string | null;
    metadata?: unknown;
  }
): Promise<{ balanceCredits: number }> {
  const credits = Math.max(0, Math.floor(input.credits));
  if (credits <= 0) {
    const balanceRow = await ensureOrganizationCreditBalanceRow(db, { organizationId: input.organizationId });
    return { balanceCredits: balanceRow.balanceCredits };
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(organizationCreditBalances)
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .limit(1)
      .for("update");
    const current = locked ?? (await ensureOrganizationCreditBalanceRow(tx as any, { organizationId: input.organizationId }));

    await tx.insert(organizationCreditLedger).values({
      organizationId: input.organizationId,
      deltaCredits: credits,
      reason: input.reason,
      createdByUserId: input.createdByUserId ?? null,
      metadata: input.metadata as any,
    });

    const [updated] = await tx
      .update(organizationCreditBalances)
      .set({
        balanceCredits: current.balanceCredits + credits,
        updatedAt: new Date(),
      })
      .where(eq(organizationCreditBalances.organizationId, input.organizationId))
      .returning();
    return { balanceCredits: updated?.balanceCredits ?? current.balanceCredits + credits };
  });
}

export async function listOrganizationCreditLedger(
  db: Db,
  input: {
    organizationId: string;
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
  }
): Promise<{ entries: typeof organizationCreditLedger.$inferSelect[]; nextCursor: { createdAt: Date; id: string } | null }> {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit))) : 50;

  const where = and(
    eq(organizationCreditLedger.organizationId, input.organizationId),
    input.cursor
      ? or(
          lt(organizationCreditLedger.createdAt, input.cursor.createdAt),
          and(eq(organizationCreditLedger.createdAt, input.cursor.createdAt), lt(organizationCreditLedger.id, input.cursor.id))
        )
      : undefined
  );

  const rows = await db
    .select()
    .from(organizationCreditLedger)
    .where(where)
    .orderBy(desc(organizationCreditLedger.createdAt), desc(organizationCreditLedger.id))
    .limit(limit + 1);

  const slice = rows.slice(0, limit);
  const tail = rows.length > limit ? slice[slice.length - 1] ?? null : null;

  return {
    entries: slice,
    nextCursor: tail ? { createdAt: tail.createdAt, id: tail.id } : null,
  };
}

export async function getOrganizationBillingAccount(db: Db, input: { organizationId: string }) {
  const [row] = await db
    .select()
    .from(organizationBillingAccounts)
    .where(eq(organizationBillingAccounts.organizationId, input.organizationId));
  return row ?? null;
}

export async function createOrganizationBillingAccount(
  db: Db,
  input: { organizationId: string; stripeCustomerId: string }
) {
  const existing = await getOrganizationBillingAccount(db, { organizationId: input.organizationId });
  if (existing) {
    return existing;
  }

  try {
    const [row] = await db
      .insert(organizationBillingAccounts)
      .values({ organizationId: input.organizationId, stripeCustomerId: input.stripeCustomerId })
      .returning();
    if (!row) {
      throw new Error("Failed to create billing account");
    }
    return row;
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    const retry = await getOrganizationBillingAccount(db, { organizationId: input.organizationId });
    if (!retry) {
      throw new Error("Failed to load billing account after unique violation");
    }
    return retry;
  }
}

export async function updateOrganizationSettings(
  db: Db,
  input: { organizationId: string; settings: unknown }
) {
  const [row] = await db
    .update(organizations)
    .set({
      settings: input.settings as any,
    })
    .where(eq(organizations.id, input.organizationId))
    .returning();
  return row ?? null;
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
  const workflowId = crypto.randomUUID();
  const [row] = await db
    .insert(workflows)
    .values({
      id: workflowId,
      organizationId: input.organizationId,
      familyId: workflowId,
      revision: 1,
      sourceWorkflowId: null,
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

export async function createWorkflowDraftFromWorkflow(
  db: Db,
  input: {
    organizationId: string;
    sourceWorkflowId: string;
    createdByUserId: string;
  }
) {
  const source = await getWorkflowById(db, {
    organizationId: input.organizationId,
    workflowId: input.sourceWorkflowId,
  });
  if (!source) {
    return null;
  }

  const familyId = (source as any).familyId as string | undefined;
  if (!familyId) {
    throw new Error("WORKFLOW_FAMILY_ID_MISSING");
  }

  // Avoid revision collisions under concurrent draft creation by retrying on unique violations.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await db
      .select({ maxRevision: sql<number | null>`max(${workflows.revision})` })
      .from(workflows)
      .where(and(eq(workflows.organizationId, input.organizationId), eq(workflows.familyId, familyId)));
    const maxRevision = rows[0]?.maxRevision ?? null;

    const nextRevision = (maxRevision ?? 0) + 1;
    const newWorkflowId = crypto.randomUUID();

    try {
      const [row] = await db
        .insert(workflows)
        .values({
          id: newWorkflowId,
          organizationId: input.organizationId,
          familyId,
          revision: nextRevision,
          sourceWorkflowId: source.id,
          name: source.name,
          status: "draft",
          version: 1,
          dsl: source.dsl,
          editorState: (source as any).editorState ?? null,
          createdByUserId: input.createdByUserId,
          publishedAt: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create workflow draft from workflow");
      }
      return row;
    } catch (error) {
      if (!isPgUniqueViolation(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Failed to create workflow draft from workflow after retries");
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

export async function updateWorkflowDraft(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    name?: string | null;
    dsl?: unknown;
    editorState?: unknown;
  }
) {
  const [row] = await db
    .update(workflows)
    .set({
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(input.dsl !== undefined ? { dsl: input.dsl } : {}),
      ...(input.editorState !== undefined ? { editorState: input.editorState as any } : {}),
      version: sql`${workflows.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflows.organizationId, input.organizationId),
        eq(workflows.id, input.workflowId),
        eq(workflows.status, "draft")
      )
    )
    .returning();
  return row ?? null;
}

export async function listWorkflows(
  db: Db,
  input: {
    organizationId: string;
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
  }
) {
  const limit = Math.min(200, Math.max(1, input.limit));

  const baseWhere = eq(workflows.organizationId, input.organizationId);
  const cursorWhere = input.cursor
    ? or(
        lt(workflows.createdAt, input.cursor.createdAt),
        and(eq(workflows.createdAt, input.cursor.createdAt), lt(workflows.id, input.cursor.id))
      )
    : null;

  const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere;

  const rows = await db
    .select()
    .from(workflows)
    .where(where)
    .orderBy(desc(workflows.createdAt), desc(workflows.id))
    .limit(limit);

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
  return { rows, nextCursor };
}

export async function listWorkflowRevisions(
  db: Db,
  input: {
    organizationId: string;
    familyId: string;
    limit: number;
  }
) {
  const limit = Math.min(200, Math.max(1, input.limit));
  const rows = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.organizationId, input.organizationId), eq(workflows.familyId, input.familyId)))
    .orderBy(desc(workflows.revision), desc(workflows.createdAt), desc(workflows.id))
    .limit(limit);
  return rows;
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
    output: null;
    cursorNodeIndex: number;
    blockedRequestId: null;
    blockedNodeId: null;
    blockedNodeType: null;
    blockedKind: null;
    blockedAt: null;
    blockedTimeoutAt: null;
    attemptCount?: number;
  } = {
    status: "running",
    startedAt: new Date(),
    error: null,
    nextAttemptAt: null,
    output: null,
    cursorNodeIndex: 0,
    blockedRequestId: null,
    blockedNodeId: null,
    blockedNodeType: null,
    blockedKind: null,
    blockedAt: null,
    blockedTimeoutAt: null,
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

export async function markWorkflowRunBlocked(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    cursorNodeIndex: number;
    blockedRequestId: string;
    blockedNodeId: string;
    blockedNodeType: string;
    blockedKind: string;
    blockedTimeoutAt: Date;
    output?: unknown;
  }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      cursorNodeIndex: input.cursorNodeIndex,
      blockedRequestId: input.blockedRequestId,
      blockedNodeId: input.blockedNodeId,
      blockedNodeType: input.blockedNodeType,
      blockedKind: input.blockedKind,
      blockedAt: new Date(),
      blockedTimeoutAt: input.blockedTimeoutAt,
      ...(input.output !== undefined ? { output: input.output } : {}),
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

export async function clearWorkflowRunBlockAndAdvanceCursor(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    expectedRequestId: string;
    nextCursorNodeIndex: number;
    output?: unknown;
  }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      cursorNodeIndex: input.nextCursorNodeIndex,
      blockedRequestId: null,
      blockedNodeId: null,
      blockedNodeType: null,
      blockedKind: null,
      blockedAt: null,
      blockedTimeoutAt: null,
      ...(input.output !== undefined ? { output: input.output } : {}),
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId),
        eq(workflowRuns.blockedRequestId, input.expectedRequestId)
      )
    )
    .returning();
  return row ?? null;
}

export async function clearWorkflowRunBlock(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    expectedRequestId: string;
    output?: unknown;
  }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      blockedRequestId: null,
      blockedNodeId: null,
      blockedNodeType: null,
      blockedKind: null,
      blockedAt: null,
      blockedTimeoutAt: null,
      ...(input.output !== undefined ? { output: input.output } : {}),
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.id, input.runId),
        eq(workflowRuns.blockedRequestId, input.expectedRequestId)
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

export async function updateWorkflowRunProgress(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    cursorNodeIndex: number;
    output: unknown;
  }
) {
  const [row] = await db
    .update(workflowRuns)
    .set({
      cursorNodeIndex: input.cursorNodeIndex,
      output: input.output,
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
      cursorNodeIndex: 0,
      blockedRequestId: null,
      blockedNodeId: null,
      blockedNodeType: null,
      blockedKind: null,
      blockedAt: null,
      blockedTimeoutAt: null,
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
      blockedRequestId: null,
      blockedNodeId: null,
      blockedNodeType: null,
      blockedKind: null,
      blockedAt: null,
      blockedTimeoutAt: null,
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

export async function setOrganizationAgentTags(
  db: Db,
  input: { organizationId: string; agentId: string; tags: string[] }
) {
  const [row] = await db
    .update(organizationAgents)
    .set({ tags: input.tags })
    .where(and(eq(organizationAgents.organizationId, input.organizationId), eq(organizationAgents.id, input.agentId)))
    .returning();
  return row ?? null;
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

export async function createAgentToolset(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org" | "public";
    publicSlug?: string | null;
    publishedAt?: Date | null;
    mcpServers: unknown;
    agentSkills: unknown;
    adoptedFrom?: unknown;
    createdByUserId: string;
    updatedByUserId: string;
  }
) {
  const [row] = await db
    .insert(agentToolsets)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      publicSlug: input.publicSlug ?? null,
      publishedAt: input.publishedAt ?? null,
      mcpServers: input.mcpServers as any,
      agentSkills: input.agentSkills as any,
      adoptedFrom: (input.adoptedFrom ?? null) as any,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.updatedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create toolset");
  }
  return row;
}

export async function listAgentToolsetsByOrg(db: Db, input: { organizationId: string }) {
  return await db
    .select()
    .from(agentToolsets)
    .where(eq(agentToolsets.organizationId, input.organizationId))
    .orderBy(desc(agentToolsets.updatedAt));
}

export async function getAgentToolsetById(db: Db, input: { organizationId: string; toolsetId: string }) {
  const [row] = await db
    .select()
    .from(agentToolsets)
    .where(and(eq(agentToolsets.organizationId, input.organizationId), eq(agentToolsets.id, input.toolsetId)));
  return row ?? null;
}

export async function updateAgentToolset(
  db: Db,
  input: {
    organizationId: string;
    toolsetId: string;
    name: string;
    description?: string | null;
    visibility: "private" | "org" | "public";
    publicSlug?: string | null;
    publishedAt?: Date | null;
    mcpServers: unknown;
    agentSkills: unknown;
    adoptedFrom?: unknown;
    updatedByUserId: string;
  }
) {
  const [row] = await db
    .update(agentToolsets)
    .set({
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      publicSlug: input.publicSlug ?? null,
      publishedAt: input.publishedAt ?? null,
      mcpServers: input.mcpServers as any,
      agentSkills: input.agentSkills as any,
      adoptedFrom: (input.adoptedFrom ?? null) as any,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(agentToolsets.organizationId, input.organizationId), eq(agentToolsets.id, input.toolsetId)))
    .returning();
  return row ?? null;
}

export async function deleteAgentToolset(db: Db, input: { organizationId: string; toolsetId: string }) {
  const [row] = await db
    .delete(agentToolsets)
    .where(and(eq(agentToolsets.organizationId, input.organizationId), eq(agentToolsets.id, input.toolsetId)))
    .returning();
  return row ?? null;
}

export async function publishAgentToolset(
  db: Db,
  input: { organizationId: string; toolsetId: string; publicSlug: string; updatedByUserId: string }
) {
  try {
    const [row] = await db
      .update(agentToolsets)
      .set({
        visibility: "public",
        publicSlug: input.publicSlug,
        publishedAt: new Date(),
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(agentToolsets.organizationId, input.organizationId), eq(agentToolsets.id, input.toolsetId)))
      .returning();
    return row ?? null;
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new Error("PUBLIC_SLUG_CONFLICT");
    }
    throw err;
  }
}

export async function unpublishAgentToolset(
  db: Db,
  input: { organizationId: string; toolsetId: string; visibility: "private" | "org"; updatedByUserId: string }
) {
  const [row] = await db
    .update(agentToolsets)
    .set({
      visibility: input.visibility,
      publicSlug: null,
      publishedAt: null,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(agentToolsets.organizationId, input.organizationId), eq(agentToolsets.id, input.toolsetId)))
    .returning();
  return row ?? null;
}

export async function listPublicAgentToolsets(db: Db) {
  return await db
    .select()
    .from(agentToolsets)
    .where(eq(agentToolsets.visibility, "public"))
    .orderBy(desc(agentToolsets.publishedAt));
}

export async function getPublicAgentToolsetBySlug(db: Db, input: { publicSlug: string }) {
  const [row] = await db
    .select()
    .from(agentToolsets)
    .where(and(eq(agentToolsets.visibility, "public"), eq(agentToolsets.publicSlug, input.publicSlug)));
  return row ?? null;
}

export async function adoptPublicAgentToolset(
  db: Db,
  input: {
    organizationId: string;
    publicSlug: string;
    nameOverride?: string | null;
    descriptionOverride?: string | null;
    actorUserId: string;
  }
) {
  const source = await getPublicAgentToolsetBySlug(db, { publicSlug: input.publicSlug });
  if (!source) {
    return null;
  }

  const adoptedFrom = {
    toolsetId: source.id,
    publicSlug: source.publicSlug ?? null,
  };

  const [row] = await db
    .insert(agentToolsets)
    .values({
      organizationId: input.organizationId,
      name: input.nameOverride && input.nameOverride.trim().length > 0 ? input.nameOverride : source.name,
      description:
        input.descriptionOverride !== undefined && input.descriptionOverride !== null ? input.descriptionOverride : (source.description ?? null),
      visibility: "org",
      publicSlug: null,
      publishedAt: null,
      mcpServers: source.mcpServers as any,
      agentSkills: source.agentSkills as any,
      adoptedFrom: adoptedFrom as any,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row ?? null;
}

export async function createToolsetBuilderSession(
  db: Db,
  input: {
    organizationId: string;
    createdByUserId: string;
    status: "ACTIVE" | "FINALIZED" | "ARCHIVED";
    llm: unknown;
    latestIntent?: string | null;
    selectedComponentKeys?: unknown;
    finalDraft?: unknown;
  }
) {
  const [row] = await db
    .insert(toolsetBuilderSessions)
    .values({
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      status: input.status,
      llm: input.llm as any,
      latestIntent: input.latestIntent ?? null,
      selectedComponentKeys: (input.selectedComponentKeys ?? []) as any,
      finalDraft: (input.finalDraft ?? null) as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create toolset builder session");
  }
  return row;
}

export async function getToolsetBuilderSessionById(db: Db, input: { organizationId: string; sessionId: string }) {
  const [row] = await db
    .select()
    .from(toolsetBuilderSessions)
    .where(and(eq(toolsetBuilderSessions.organizationId, input.organizationId), eq(toolsetBuilderSessions.id, input.sessionId)));
  return row ?? null;
}

export async function updateToolsetBuilderSessionSelection(
  db: Db,
  input: { organizationId: string; sessionId: string; latestIntent?: string | null; selectedComponentKeys: unknown }
) {
  const [row] = await db
    .update(toolsetBuilderSessions)
    .set({
      ...(input.latestIntent !== undefined ? { latestIntent: input.latestIntent } : {}),
      selectedComponentKeys: input.selectedComponentKeys as any,
      updatedAt: new Date(),
    })
    .where(and(eq(toolsetBuilderSessions.organizationId, input.organizationId), eq(toolsetBuilderSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function finalizeToolsetBuilderSession(
  db: Db,
  input: { organizationId: string; sessionId: string; selectedComponentKeys: unknown; finalDraft: unknown }
) {
  const [row] = await db
    .update(toolsetBuilderSessions)
    .set({
      status: "FINALIZED",
      selectedComponentKeys: input.selectedComponentKeys as any,
      finalDraft: input.finalDraft as any,
      updatedAt: new Date(),
    })
    .where(and(eq(toolsetBuilderSessions.organizationId, input.organizationId), eq(toolsetBuilderSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function appendToolsetBuilderTurn(
  db: Db,
  input: { sessionId: string; role: "USER" | "ASSISTANT"; messageText: string }
) {
  const [row] = await db
    .insert(toolsetBuilderTurns)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      messageText: input.messageText,
      createdAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to append toolset builder turn");
  }
  return row;
}

export async function listToolsetBuilderTurnsBySession(
  db: Db,
  input: { sessionId: string; limit?: number }
) {
  const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 100;
  return await db
    .select()
    .from(toolsetBuilderTurns)
    .where(eq(toolsetBuilderTurns.sessionId, input.sessionId))
    .orderBy(asc(toolsetBuilderTurns.createdAt), asc(toolsetBuilderTurns.id))
    .limit(limit);
}
