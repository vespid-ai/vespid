import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  agentBindings,
  agentMemoryChunks,
  agentMemoryDocuments,
  agentMemorySyncJobs,
  authSessions,
  agentPairingTokens,
  agentResetPolicies,
  agentSessionEvents,
  agentSessions,
  agentToolsets,
  channelAccountSecrets,
  channelAccounts,
  channelAllowlistEntries,
  channelConversations,
  channelEvents,
  channelMessages,
  channelPairingRequests,
  connectorSecrets,
  executionWorkspaces,
  executorPairingTokens,
  managedExecutors,
  organizationAgents,
  organizationExecutors,
  memberships,
  organizationPolicyRules,
  organizationInvitations,
  platformAuditLogs,
  platformSettings,
  platformUserRoles,
  organizations,
  roles,
  supportTicketEvents,
  supportTickets,
  toolsetBuilderSessions,
  toolsetBuilderTurns,
  users,
  workflowRunEvents,
  workflowApprovalRequests,
  workflowRuns,
  workflowTriggerSubscriptions,
  workflows,
} from "./schema.js";

function readPgErrorCode(error: unknown): string | null {
  let cursor: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof cursor !== "object" || cursor === null) {
      return null;
    }
    const record = cursor as Record<string, unknown>;
    if (typeof record.code === "string") {
      return record.code;
    }
    cursor = record.cause ?? record.originalError ?? record.driverError ?? null;
  }
  return null;
}

function isPgUniqueViolation(error: unknown): boolean {
  return readPgErrorCode(error) === "23505";
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

export type WorkflowTriggerSubscriptionInput =
  | {
      triggerType: "cron";
      cronExpr: string;
      enabled?: boolean;
    }
  | {
      triggerType: "heartbeat";
      heartbeatIntervalSec: number;
      heartbeatJitterSec: number;
      heartbeatMaxSkewSec: number;
      enabled?: boolean;
    }
  | {
      triggerType: "webhook";
      webhookTokenHash: string;
      enabled?: boolean;
    };

export async function replaceWorkflowTriggerSubscriptions(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    requestedByUserId: string;
    workflowRevision: number;
    subscriptions: WorkflowTriggerSubscriptionInput[];
  }
) {
  await db
    .delete(workflowTriggerSubscriptions)
    .where(
      and(
        eq(workflowTriggerSubscriptions.organizationId, input.organizationId),
        eq(workflowTriggerSubscriptions.workflowId, input.workflowId)
      )
    );

  if (input.subscriptions.length === 0) {
    return [];
  }

  const now = new Date();
  const rows = input.subscriptions.map((subscription) => {
    if (subscription.triggerType === "cron") {
      return {
        organizationId: input.organizationId,
        workflowId: input.workflowId,
        requestedByUserId: input.requestedByUserId,
        workflowRevision: input.workflowRevision,
        triggerType: "cron",
        enabled: subscription.enabled ?? true,
        cronExpr: subscription.cronExpr,
        heartbeatIntervalSec: null,
        heartbeatJitterSec: null,
        heartbeatMaxSkewSec: null,
        webhookTokenHash: null,
        nextFireAt: null,
        lastTriggeredAt: null,
        lastTriggerKey: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    if (subscription.triggerType === "heartbeat") {
      return {
        organizationId: input.organizationId,
        workflowId: input.workflowId,
        requestedByUserId: input.requestedByUserId,
        workflowRevision: input.workflowRevision,
        triggerType: "heartbeat",
        enabled: subscription.enabled ?? true,
        cronExpr: null,
        heartbeatIntervalSec: subscription.heartbeatIntervalSec,
        heartbeatJitterSec: subscription.heartbeatJitterSec,
        heartbeatMaxSkewSec: subscription.heartbeatMaxSkewSec,
        webhookTokenHash: null,
        nextFireAt: null,
        lastTriggeredAt: null,
        lastTriggerKey: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    return {
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      requestedByUserId: input.requestedByUserId,
      workflowRevision: input.workflowRevision,
      triggerType: "webhook",
      enabled: subscription.enabled ?? true,
      cronExpr: null,
      heartbeatIntervalSec: null,
      heartbeatJitterSec: null,
      heartbeatMaxSkewSec: null,
      webhookTokenHash: subscription.webhookTokenHash,
      nextFireAt: null,
      lastTriggeredAt: null,
      lastTriggerKey: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  return db.insert(workflowTriggerSubscriptions).values(rows as any).returning();
}

export async function listWorkflowTriggerSubscriptions(
  db: Db,
  input: {
    organizationId: string;
    workflowId?: string;
    limit?: number;
  }
) {
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const where = input.workflowId
    ? and(
        eq(workflowTriggerSubscriptions.organizationId, input.organizationId),
        eq(workflowTriggerSubscriptions.workflowId, input.workflowId)
      )
    : eq(workflowTriggerSubscriptions.organizationId, input.organizationId);
  const rows = await db
    .select()
    .from(workflowTriggerSubscriptions)
    .where(where)
    .orderBy(desc(workflowTriggerSubscriptions.updatedAt), desc(workflowTriggerSubscriptions.id))
    .limit(limit);
  return rows;
}

export async function getWorkflowTriggerSubscriptionById(
  db: Db,
  input: {
    organizationId: string;
    subscriptionId: string;
  }
) {
  const [row] = await db
    .select()
    .from(workflowTriggerSubscriptions)
    .where(
      and(
        eq(workflowTriggerSubscriptions.organizationId, input.organizationId),
        eq(workflowTriggerSubscriptions.id, input.subscriptionId)
      )
    );
  return row ?? null;
}

export async function getWorkflowTriggerSubscriptionByWebhookTokenHash(
  db: Db,
  input: {
    webhookTokenHash: string;
  }
) {
  const [row] = await db
    .select()
    .from(workflowTriggerSubscriptions)
    .where(
      and(
        eq(workflowTriggerSubscriptions.triggerType, "webhook"),
        eq(workflowTriggerSubscriptions.webhookTokenHash, input.webhookTokenHash)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function updateWorkflowTriggerSubscriptionEnabled(
  db: Db,
  input: {
    organizationId: string;
    subscriptionId: string;
    enabled: boolean;
  }
) {
  const [row] = await db
    .update(workflowTriggerSubscriptions)
    .set({
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowTriggerSubscriptions.organizationId, input.organizationId),
        eq(workflowTriggerSubscriptions.id, input.subscriptionId)
      )
    )
    .returning();
  return row ?? null;
}

export async function listDueWorkflowTriggerSubscriptions(
  db: Db,
  input: {
    now: Date;
    limit: number;
  }
) {
  const limit = Math.min(500, Math.max(1, input.limit));
  const rows = await db
    .select({
      subscription: workflowTriggerSubscriptions,
      workflow: workflows,
    })
    .from(workflowTriggerSubscriptions)
    .innerJoin(
      workflows,
      and(
        eq(workflows.id, workflowTriggerSubscriptions.workflowId),
        eq(workflows.organizationId, workflowTriggerSubscriptions.organizationId)
      )
    )
    .where(
      and(
        eq(workflowTriggerSubscriptions.enabled, true),
        eq(workflows.status, "published"),
        or(
          eq(workflowTriggerSubscriptions.triggerType, "cron"),
          eq(workflowTriggerSubscriptions.triggerType, "heartbeat")
        ),
        or(isNull(workflowTriggerSubscriptions.nextFireAt), lte(workflowTriggerSubscriptions.nextFireAt, input.now))
      )
    )
    .orderBy(asc(workflowTriggerSubscriptions.nextFireAt), asc(workflowTriggerSubscriptions.id))
    .limit(limit);
  return rows;
}

export async function updateWorkflowTriggerSubscriptionSchedule(
  db: Db,
  input: {
    subscriptionId: string;
    nextFireAt?: Date | null;
    lastTriggeredAt?: Date | null;
    lastTriggerKey?: string | null;
    lastError?: string | null;
  }
) {
  const [row] = await db
    .update(workflowTriggerSubscriptions)
    .set({
      ...(input.nextFireAt !== undefined ? { nextFireAt: input.nextFireAt } : {}),
      ...(input.lastTriggeredAt !== undefined ? { lastTriggeredAt: input.lastTriggeredAt } : {}),
      ...(input.lastTriggerKey !== undefined ? { lastTriggerKey: input.lastTriggerKey } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      updatedAt: new Date(),
    })
    .where(eq(workflowTriggerSubscriptions.id, input.subscriptionId))
    .returning();
  return row ?? null;
}

export async function listOrganizationPolicyRules(
  db: Db,
  input: {
    organizationId: string;
    enabledOnly?: boolean;
  }
) {
  const where = input.enabledOnly
    ? and(eq(organizationPolicyRules.organizationId, input.organizationId), eq(organizationPolicyRules.enabled, true))
    : eq(organizationPolicyRules.organizationId, input.organizationId);
  const rows = await db
    .select()
    .from(organizationPolicyRules)
    .where(where)
    .orderBy(asc(organizationPolicyRules.priority), asc(organizationPolicyRules.createdAt), asc(organizationPolicyRules.id));
  return rows;
}

export async function createWorkflowApprovalRequest(
  db: Db,
  input: {
    organizationId: string;
    workflowId: string;
    runId: string;
    nodeId: string;
    nodeType: string;
    requestKind?: string;
    reason?: string | null;
    context?: unknown;
    requestedByUserId: string;
    expiresAt: Date;
  }
) {
  const [row] = await db
    .insert(workflowApprovalRequests)
    .values({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      runId: input.runId,
      nodeId: input.nodeId,
      nodeType: input.nodeType,
      requestKind: input.requestKind ?? "policy",
      status: "pending",
      reason: input.reason ?? null,
      context: input.context ?? {},
      requestedByUserId: input.requestedByUserId,
      expiresAt: input.expiresAt,
    })
    .returning();
  return row ?? null;
}

export async function listWorkflowApprovalRequests(
  db: Db,
  input: {
    organizationId: string;
    status?: "pending" | "approved" | "rejected" | "expired";
    limit: number;
    cursor?: { createdAt: Date; id: string } | null;
  }
) {
  const limit = Math.min(500, Math.max(1, input.limit));
  const baseWhere = input.status
    ? and(eq(workflowApprovalRequests.organizationId, input.organizationId), eq(workflowApprovalRequests.status, input.status))
    : eq(workflowApprovalRequests.organizationId, input.organizationId);
  const cursorWhere = input.cursor
    ? or(
        lt(workflowApprovalRequests.createdAt, input.cursor.createdAt),
        and(
          eq(workflowApprovalRequests.createdAt, input.cursor.createdAt),
          lt(workflowApprovalRequests.id, input.cursor.id)
        )
      )
    : null;
  const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere;

  const rows = await db
    .select()
    .from(workflowApprovalRequests)
    .where(where)
    .orderBy(desc(workflowApprovalRequests.createdAt), desc(workflowApprovalRequests.id))
    .limit(limit);

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
  return { rows, nextCursor };
}

export async function getWorkflowApprovalRequestById(
  db: Db,
  input: {
    organizationId: string;
    approvalRequestId: string;
  }
) {
  const [row] = await db
    .select()
    .from(workflowApprovalRequests)
    .where(
      and(
        eq(workflowApprovalRequests.organizationId, input.organizationId),
        eq(workflowApprovalRequests.id, input.approvalRequestId)
      )
    );
  return row ?? null;
}

export async function hasApprovedWorkflowApprovalForRunNode(
  db: Db,
  input: {
    organizationId: string;
    runId: string;
    nodeId: string;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const rows = await db
    .select({ id: workflowApprovalRequests.id })
    .from(workflowApprovalRequests)
    .where(
      and(
        eq(workflowApprovalRequests.organizationId, input.organizationId),
        eq(workflowApprovalRequests.runId, input.runId),
        eq(workflowApprovalRequests.nodeId, input.nodeId),
        eq(workflowApprovalRequests.status, "approved"),
        gt(workflowApprovalRequests.expiresAt, now)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function decideWorkflowApprovalRequest(
  db: Db,
  input: {
    organizationId: string;
    approvalRequestId: string;
    status: "approved" | "rejected" | "expired";
    decidedByUserId?: string | null;
    decisionNote?: string | null;
  }
) {
  const [row] = await db
    .update(workflowApprovalRequests)
    .set({
      status: input.status,
      decidedByUserId: input.decidedByUserId ?? null,
      decisionNote: input.decisionNote ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowApprovalRequests.organizationId, input.organizationId),
        eq(workflowApprovalRequests.id, input.approvalRequestId),
        eq(workflowApprovalRequests.status, "pending")
      )
    )
    .returning();
  return row ?? null;
}

export async function getWorkflowRunByBlockedRequestId(
  db: Db,
  input: {
    organizationId: string;
    blockedRequestId: string;
  }
) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.blockedRequestId, input.blockedRequestId),
        eq(workflowRuns.status, "running")
      )
    )
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(1);
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
    triggerType: "manual" | "channel" | "cron" | "webhook" | "heartbeat";
    requestedByUserId: string;
    input?: unknown;
    maxAttempts?: number;
    triggerKey?: string | null;
    triggeredAt?: Date | null;
    triggerSource?: string | null;
  }
) {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      triggerType: input.triggerType,
      triggerKey: input.triggerKey ?? null,
      triggeredAt: input.triggeredAt ?? null,
      triggerSource: input.triggerSource ?? null,
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

export async function createExecutionWorkspace(
  db: Db,
  input: {
    id?: string;
    organizationId: string;
    ownerType: "session" | "workflow_run" | "adhoc";
    ownerId: string;
    currentVersion?: number;
    currentObjectKey: string;
    currentEtag?: string | null;
  }
) {
  const [row] = await db
    .insert(executionWorkspaces)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      currentVersion: input.currentVersion ?? 0,
      currentObjectKey: input.currentObjectKey,
      currentEtag: input.currentEtag ?? null,
      lockToken: null,
      lockExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create execution workspace");
  }
  return row;
}

export async function getExecutionWorkspaceByOwner(
  db: Db,
  input: { organizationId: string; ownerType: "session" | "workflow_run" | "adhoc"; ownerId: string }
) {
  const [row] = await db
    .select()
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.organizationId, input.organizationId),
        eq(executionWorkspaces.ownerType, input.ownerType),
        eq(executionWorkspaces.ownerId, input.ownerId)
      )
    );
  return row ?? null;
}

export async function tryLockExecutionWorkspace(
  db: Db,
  input: { organizationId: string; workspaceId: string; lockToken: string; lockTtlSec: number }
) {
  const expiresAt = new Date(Date.now() + Math.max(1, input.lockTtlSec) * 1000);
  const [row] = await db
    .update(executionWorkspaces)
    .set({ lockToken: input.lockToken, lockExpiresAt: expiresAt, updatedAt: new Date() })
    .where(
      and(
        eq(executionWorkspaces.organizationId, input.organizationId),
        eq(executionWorkspaces.id, input.workspaceId),
        or(isNull(executionWorkspaces.lockExpiresAt), lt(executionWorkspaces.lockExpiresAt, sql`now()`))
      )
    )
    .returning();
  return row ?? null;
}

export async function commitExecutionWorkspaceVersion(
  db: Db,
  input: {
    organizationId: string;
    workspaceId: string;
    expectedCurrentVersion: number;
    nextObjectKey: string;
    nextEtag?: string | null;
  }
) {
  const [row] = await db
    .update(executionWorkspaces)
    .set({
      currentVersion: input.expectedCurrentVersion + 1,
      currentObjectKey: input.nextObjectKey,
      currentEtag: input.nextEtag ?? null,
      lockToken: null,
      lockExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionWorkspaces.organizationId, input.organizationId),
        eq(executionWorkspaces.id, input.workspaceId),
        eq(executionWorkspaces.currentVersion, input.expectedCurrentVersion)
      )
    )
    .returning();
  return row ?? null;
}

export async function createExecutorPairingToken(
  db: Db,
  input: { organizationId: string; tokenHash: string; expiresAt: Date; createdByUserId: string }
) {
  const [row] = await db
    .insert(executorPairingTokens)
    .values({
      organizationId: input.organizationId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create executor pairing token");
  }
  return row;
}

export async function getExecutorPairingTokenByHash(db: Db, input: { organizationId: string; tokenHash: string }) {
  const [row] = await db
    .select()
    .from(executorPairingTokens)
    .where(
      and(eq(executorPairingTokens.organizationId, input.organizationId), eq(executorPairingTokens.tokenHash, input.tokenHash))
    );
  return row ?? null;
}

export async function consumeExecutorPairingToken(db: Db, input: { organizationId: string; tokenHash: string }) {
  const [row] = await db
    .update(executorPairingTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(executorPairingTokens.organizationId, input.organizationId),
        eq(executorPairingTokens.tokenHash, input.tokenHash),
        isNull(executorPairingTokens.usedAt),
        gt(executorPairingTokens.expiresAt, sql`now()`)
      )
    )
    .returning();
  return row ?? null;
}

export async function createOrganizationExecutor(
  db: Db,
  input: { id?: string; organizationId: string; name: string; tokenHash: string; createdByUserId: string; capabilities?: unknown }
) {
  const [row] = await db
    .insert(organizationExecutors)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      tokenHash: input.tokenHash,
      revokedAt: null,
      lastSeenAt: new Date(),
      capabilities: (input.capabilities ?? null) as any,
      labels: [],
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create organization executor");
  }
  return row;
}

export async function getOrganizationExecutorByTokenHash(db: Db, input: { organizationId: string; tokenHash: string }) {
  const [row] = await db
    .select()
    .from(organizationExecutors)
    .where(and(eq(organizationExecutors.organizationId, input.organizationId), eq(organizationExecutors.tokenHash, input.tokenHash)));
  return row ?? null;
}

export async function listOrganizationExecutors(db: Db, input: { organizationId: string }) {
  const rows = await db
    .select()
    .from(organizationExecutors)
    .where(eq(organizationExecutors.organizationId, input.organizationId))
    .orderBy(desc(organizationExecutors.createdAt));
  return rows;
}

export async function setOrganizationExecutorLabels(db: Db, input: { organizationId: string; executorId: string; labels: string[] }) {
  const [row] = await db
    .update(organizationExecutors)
    .set({ labels: input.labels })
    .where(and(eq(organizationExecutors.organizationId, input.organizationId), eq(organizationExecutors.id, input.executorId)))
    .returning();
  return row ?? null;
}

export async function touchOrganizationExecutorLastSeen(db: Db, input: { organizationId: string; executorId: string }) {
  const [row] = await db
    .update(organizationExecutors)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(organizationExecutors.organizationId, input.organizationId), eq(organizationExecutors.id, input.executorId)))
    .returning();
  return row ?? null;
}

export async function revokeOrganizationExecutor(db: Db, input: { organizationId: string; executorId: string }) {
  const [row] = await db
    .update(organizationExecutors)
    .set({ revokedAt: new Date() })
    .where(and(eq(organizationExecutors.organizationId, input.organizationId), eq(organizationExecutors.id, input.executorId)))
    .returning();
  return row ?? null;
}

export async function deleteOrganizationExecutor(db: Db, input: { organizationId: string; executorId: string }) {
  const [row] = await db
    .delete(organizationExecutors)
    .where(
      and(
        eq(organizationExecutors.organizationId, input.organizationId),
        eq(organizationExecutors.id, input.executorId),
        isNotNull(organizationExecutors.revokedAt)
      )
    )
    .returning();
  return row ?? null;
}

export async function getManagedExecutorByTokenHash(db: Db, input: { tokenHash: string }) {
  const [row] = await db.select().from(managedExecutors).where(eq(managedExecutors.tokenHash, input.tokenHash));
  return row ?? null;
}

export async function createManagedExecutor(
  db: Db,
  input: {
    id?: string;
    name: string;
    tokenHash: string;
    maxInFlight?: number;
    labels?: string[];
    capabilities?: unknown;
    enabled?: boolean;
    drain?: boolean;
    runtimeClass?: string;
    region?: string | null;
  }
) {
  const [row] = await db
    .insert(managedExecutors)
    .values({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      tokenHash: input.tokenHash,
      maxInFlight: Math.max(1, Math.floor(input.maxInFlight ?? 50)),
      labels: input.labels ?? [],
      capabilities: (input.capabilities ?? null) as any,
      enabled: input.enabled ?? true,
      drain: input.drain ?? false,
      runtimeClass: input.runtimeClass ?? "container",
      region: input.region ?? null,
      revokedAt: null,
      lastSeenAt: null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create managed executor");
  }
  return row;
}

export async function listManagedExecutors(db: Db) {
  const rows = await db.select().from(managedExecutors).orderBy(desc(managedExecutors.createdAt));
  return rows;
}

export async function touchManagedExecutorLastSeen(db: Db, input: { executorId: string }) {
  const [row] = await db
    .update(managedExecutors)
    .set({ lastSeenAt: new Date() })
    .where(eq(managedExecutors.id, input.executorId))
    .returning();
  return row ?? null;
}

export async function revokeManagedExecutor(db: Db, input: { executorId: string }) {
  const [row] = await db
    .update(managedExecutors)
    .set({ revokedAt: new Date() })
    .where(eq(managedExecutors.id, input.executorId))
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

export async function createAgentSession(
  db: Db,
  input: {
    organizationId: string;
    createdByUserId: string;
    sessionKey?: string;
    scope?: string;
    title?: string | null;
    status?: "active" | "archived";
    routedAgentId?: string | null;
    bindingId?: string | null;
    selectorTag?: string | null;
    selectorGroup?: string | null;
    executorSelector?: unknown;
    engineId: string;
    toolsetId?: string | null;
    llmProvider: string;
    llmModel: string;
    llmSecretId?: string | null;
    toolsAllow: unknown;
    limits: unknown;
    runtime?: unknown;
    promptSystem?: string | null;
    promptInstructions: string;
    resetPolicySnapshot?: unknown;
  }
) {
  const sessionKey = input.sessionKey ?? `session:${crypto.randomUUID()}`;
  const [row] = await db
    .insert(agentSessions)
    .values({
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      sessionKey,
      scope: input.scope ?? "main",
      title: input.title ?? "",
      status: input.status ?? "active",
      routedAgentId: input.routedAgentId ?? null,
      bindingId: input.bindingId ?? null,
      selectorTag: input.selectorTag ?? ((input.executorSelector as any)?.tag ?? null),
      selectorGroup: input.selectorGroup ?? ((input.executorSelector as any)?.group ?? null),
      executorSelector: (input.executorSelector ?? null) as any,
      engineId: input.engineId,
      toolsetId: input.toolsetId ?? null,
      llmProvider: input.llmProvider,
      llmModel: input.llmModel,
      llmSecretId: input.llmSecretId ?? null,
      toolsAllow: input.toolsAllow as any,
      limits: input.limits as any,
      runtime: (input.runtime ?? {}) as any,
      promptSystem: input.promptSystem ?? null,
      promptInstructions: input.promptInstructions,
      resetPolicySnapshot: (input.resetPolicySnapshot ?? {}) as any,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [agentSessions.organizationId, agentSessions.sessionKey],
    })
    .returning();
  if (row) {
    return row;
  }
  const [existing] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.sessionKey, sessionKey)))
    .limit(1);
  if (!existing) {
    throw new Error("Failed to create agent session");
  }
  return existing;
}

export async function getAgentSessionById(db: Db, input: { organizationId: string; sessionId: string }) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)));
  return row ?? null;
}

export async function listAgentSessions(
  db: Db,
  input: {
    organizationId: string;
    limit: number;
    status?: "active" | "archived" | "all";
    cursor?: { updatedAt: string; id: string } | null;
  }
) {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
  const cursor = input.cursor ?? null;
  const status = input.status ?? "active";

  const statusFilter = status === "all" ? null : eq(agentSessions.status, status);
  const baseWhere = statusFilter
    ? and(eq(agentSessions.organizationId, input.organizationId), statusFilter)
    : eq(agentSessions.organizationId, input.organizationId);

  const where = cursor
    ? and(
        baseWhere,
        or(
          lt(agentSessions.updatedAt, new Date(cursor.updatedAt)),
          and(eq(agentSessions.updatedAt, new Date(cursor.updatedAt)), lt(agentSessions.id, cursor.id))
        )
      )
    : baseWhere;

  const rows = await db
    .select()
    .from(agentSessions)
    .where(where)
    .orderBy(desc(agentSessions.updatedAt), desc(agentSessions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && sessions.length > 0
      ? { updatedAt: sessions[sessions.length - 1]!.updatedAt.toISOString(), id: sessions[sessions.length - 1]!.id }
      : null;

  return { sessions, nextCursor };
}

export async function archiveAgentSession(
  db: Db,
  input: { organizationId: string; sessionId: string }
) {
  const [row] = await db
    .update(agentSessions)
    .set({ status: "archived", updatedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function restoreAgentSession(
  db: Db,
  input: { organizationId: string; sessionId: string }
) {
  const [row] = await db
    .update(agentSessions)
    .set({ status: "active", updatedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function setAgentSessionPinnedAgent(
  db: Db,
  input: {
    organizationId: string;
    sessionId: string;
    pinnedAgentId?: string | null;
    pinnedExecutorId?: string | null;
    pinnedExecutorPool?: "managed" | "byon" | null;
  }
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.pinnedAgentId !== undefined) {
    patch.pinnedAgentId = input.pinnedAgentId;
  }
  if (input.pinnedExecutorId !== undefined) {
    patch.pinnedExecutorId = input.pinnedExecutorId;
  }
  if (input.pinnedExecutorPool !== undefined) {
    patch.pinnedExecutorPool = input.pinnedExecutorPool;
  }
  const [row] = await db
    .update(agentSessions)
    .set(patch as any)
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function setAgentSessionRoute(
  db: Db,
  input: {
    organizationId: string;
    sessionId: string;
    routedAgentId: string | null;
    bindingId?: string | null;
    sessionKey?: string;
    scope?: string;
  }
) {
  const [row] = await db
    .update(agentSessions)
    .set({
      routedAgentId: input.routedAgentId,
      ...(input.bindingId !== undefined ? { bindingId: input.bindingId } : {}),
      ...(typeof input.sessionKey === "string" ? { sessionKey: input.sessionKey } : {}),
      ...(typeof input.scope === "string" ? { scope: input.scope } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function setAgentSessionResetPolicySnapshot(
  db: Db,
  input: { organizationId: string; sessionId: string; resetPolicySnapshot: unknown }
) {
  const [row] = await db
    .update(agentSessions)
    .set({ resetPolicySnapshot: input.resetPolicySnapshot as any, updatedAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function touchAgentSessionActivity(db: Db, input: { organizationId: string; sessionId: string }) {
  const [row] = await db
    .update(agentSessions)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function setAgentSessionRuntime(
  db: Db,
  input: { organizationId: string; sessionId: string; runtime: unknown }
) {
  const [row] = await db
    .update(agentSessions)
    .set({ runtime: input.runtime as any, updatedAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function setAgentSessionWorkspaceId(
  db: Db,
  input: { organizationId: string; sessionId: string; workspaceId: string | null }
) {
  const [row] = await db
    .update(agentSessions)
    .set({ workspaceId: input.workspaceId, updatedAt: new Date() })
    .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
    .returning();
  return row ?? null;
}

export async function appendAgentSessionEvent(
  db: Db,
  input: {
    organizationId: string;
    sessionId: string;
    eventType: string;
    level?: "info" | "warn" | "error";
    handoffFromAgentId?: string | null;
    handoffToAgentId?: string | null;
    idempotencyKey?: string | null;
    payload?: unknown;
  }
) {
  return await db.transaction(async (tx) => {
    if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
      const [existing] = await tx
        .select()
        .from(agentSessionEvents)
        .where(
          and(
            eq(agentSessionEvents.organizationId, input.organizationId),
            eq(agentSessionEvents.sessionId, input.sessionId),
            eq(agentSessionEvents.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (existing) {
        return existing;
      }
    }

    // Serialize seq allocation per session.
    const [locked] = await tx
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)))
      .for("update");
    if (!locked) {
      throw new Error("AGENT_SESSION_NOT_FOUND");
    }

    const [last] = await tx
      .select({ seq: agentSessionEvents.seq })
      .from(agentSessionEvents)
      .where(and(eq(agentSessionEvents.organizationId, input.organizationId), eq(agentSessionEvents.sessionId, input.sessionId)))
      .orderBy(desc(agentSessionEvents.seq))
      .limit(1);

    const nextSeq = typeof last?.seq === "number" ? last.seq + 1 : 0;

    const [row] = await tx
      .insert(agentSessionEvents)
      .values({
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        seq: nextSeq,
        eventType: input.eventType,
        level: input.level ?? "info",
        handoffFromAgentId: input.handoffFromAgentId ?? null,
        handoffToAgentId: input.handoffToAgentId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        payload: input.payload as any,
      })
      .returning();
    if (!row) {
      throw new Error("Failed to append agent session event");
    }

    await tx
      .update(agentSessions)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentSessions.organizationId, input.organizationId), eq(agentSessions.id, input.sessionId)));

    return row;
  });
}

export async function listAgentSessionEvents(
  db: Db,
  input: { organizationId: string; sessionId: string; limit: number; cursor?: { seq: number } | null }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
  const cursor = input.cursor ?? null;

  const where = cursor
    ? and(
        eq(agentSessionEvents.organizationId, input.organizationId),
        eq(agentSessionEvents.sessionId, input.sessionId),
        gt(agentSessionEvents.seq, cursor.seq)
      )
    : and(eq(agentSessionEvents.organizationId, input.organizationId), eq(agentSessionEvents.sessionId, input.sessionId));

  const rows = await db
    .select()
    .from(agentSessionEvents)
    .where(where)
    .orderBy(asc(agentSessionEvents.seq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && events.length > 0 ? { seq: events[events.length - 1]!.seq } : null;

  return { events, nextCursor };
}

export async function listAgentSessionEventsTail(
  db: Db,
  input: { organizationId: string; sessionId: string; limit: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
  const rows = await db
    .select()
    .from(agentSessionEvents)
    .where(and(eq(agentSessionEvents.organizationId, input.organizationId), eq(agentSessionEvents.sessionId, input.sessionId)))
    .orderBy(desc(agentSessionEvents.seq))
    .limit(limit);
  // Return ascending (seq) for client playback.
  return [...rows].reverse();
}

export async function createAgentBinding(
  db: Db,
  input: {
    organizationId: string;
    agentId: string;
    priority: number;
    dimension: string;
    match: unknown;
    metadata?: unknown;
    createdByUserId: string;
  }
) {
  const [row] = await db
    .insert(agentBindings)
    .values({
      organizationId: input.organizationId,
      agentId: input.agentId,
      priority: input.priority,
      dimension: input.dimension,
      match: input.match as any,
      metadata: (input.metadata ?? null) as any,
      createdByUserId: input.createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create agent binding");
  }
  return row;
}

export async function listAgentBindings(db: Db, input: { organizationId: string }) {
  return await db
    .select()
    .from(agentBindings)
    .where(eq(agentBindings.organizationId, input.organizationId))
    .orderBy(asc(agentBindings.dimension), desc(agentBindings.priority), asc(agentBindings.id));
}

export async function getAgentBindingById(db: Db, input: { organizationId: string; bindingId: string }) {
  const [row] = await db
    .select()
    .from(agentBindings)
    .where(and(eq(agentBindings.organizationId, input.organizationId), eq(agentBindings.id, input.bindingId)));
  return row ?? null;
}

export async function patchAgentBinding(
  db: Db,
  input: {
    organizationId: string;
    bindingId: string;
    patch: {
      agentId?: string;
      priority?: number;
      dimension?: string;
      match?: unknown;
      metadata?: unknown;
    };
  }
) {
  const [row] = await db
    .update(agentBindings)
    .set({
      ...(input.patch.agentId !== undefined ? { agentId: input.patch.agentId } : {}),
      ...(input.patch.priority !== undefined ? { priority: input.patch.priority } : {}),
      ...(input.patch.dimension !== undefined ? { dimension: input.patch.dimension } : {}),
      ...(input.patch.match !== undefined ? { match: input.patch.match as any } : {}),
      ...(input.patch.metadata !== undefined ? { metadata: input.patch.metadata as any } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(agentBindings.organizationId, input.organizationId), eq(agentBindings.id, input.bindingId)))
    .returning();
  return row ?? null;
}

export async function deleteAgentBinding(db: Db, input: { organizationId: string; bindingId: string }) {
  const [row] = await db
    .delete(agentBindings)
    .where(and(eq(agentBindings.organizationId, input.organizationId), eq(agentBindings.id, input.bindingId)))
    .returning({ id: agentBindings.id });
  return Boolean(row);
}

export async function upsertAgentResetPolicy(
  db: Db,
  input: {
    organizationId: string;
    policyId?: string;
    agentId?: string | null;
    name: string;
    policy: unknown;
    active?: boolean;
    createdByUserId: string;
  }
) {
  if (input.policyId) {
    const [updated] = await db
      .update(agentResetPolicies)
      .set({
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        name: input.name,
        policy: input.policy as any,
        active: input.active ?? true,
        updatedAt: new Date(),
      })
      .where(and(eq(agentResetPolicies.organizationId, input.organizationId), eq(agentResetPolicies.id, input.policyId)))
      .returning();
    return updated ?? null;
  }

  const [created] = await db
    .insert(agentResetPolicies)
    .values({
      organizationId: input.organizationId,
      agentId: input.agentId ?? null,
      name: input.name,
      policy: input.policy as any,
      active: input.active ?? true,
      createdByUserId: input.createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return created ?? null;
}

export async function listAgentResetPolicies(db: Db, input: { organizationId: string; activeOnly?: boolean }) {
  const where = input.activeOnly
    ? and(eq(agentResetPolicies.organizationId, input.organizationId), eq(agentResetPolicies.active, true))
    : eq(agentResetPolicies.organizationId, input.organizationId);
  return await db
    .select()
    .from(agentResetPolicies)
    .where(where)
    .orderBy(desc(agentResetPolicies.updatedAt), desc(agentResetPolicies.id));
}

export async function createAgentMemoryDocument(
  db: Db,
  input: {
    organizationId: string;
    sessionId?: string | null;
    sessionKey: string;
    provider: "builtin" | "qmd";
    docPath: string;
    contentHash: string;
    lineCount: number;
    metadata?: unknown;
  }
) {
  const [row] = await db
    .insert(agentMemoryDocuments)
    .values({
      organizationId: input.organizationId,
      sessionId: input.sessionId ?? null,
      sessionKey: input.sessionKey,
      provider: input.provider,
      docPath: input.docPath,
      contentHash: input.contentHash,
      lineCount: input.lineCount,
      metadata: (input.metadata ?? {}) as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create agent memory document");
  }
  return row;
}

export async function replaceAgentMemoryChunks(
  db: Db,
  input: {
    organizationId: string;
    documentId: string;
    chunks: Array<{ chunkIndex: number; text: string; tokenCount?: number; embedding?: unknown; metadata?: unknown }>;
  }
) {
  await db
    .delete(agentMemoryChunks)
    .where(and(eq(agentMemoryChunks.organizationId, input.organizationId), eq(agentMemoryChunks.documentId, input.documentId)));

  if (input.chunks.length === 0) {
    return [];
  }

  return await db
    .insert(agentMemoryChunks)
    .values(
      input.chunks.map((chunk) => ({
        organizationId: input.organizationId,
        documentId: input.documentId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount ?? 0,
        embedding: (chunk.embedding ?? null) as any,
        metadata: (chunk.metadata ?? {}) as any,
      }))
    )
    .returning();
}

export async function createAgentMemorySyncJob(
  db: Db,
  input: {
    organizationId: string;
    sessionId?: string | null;
    sessionKey: string;
    provider: "builtin" | "qmd";
    status?: "queued" | "running" | "succeeded" | "failed";
    reason?: string | null;
    details?: unknown;
    createdByUserId?: string | null;
  }
) {
  const [row] = await db
    .insert(agentMemorySyncJobs)
    .values({
      organizationId: input.organizationId,
      sessionId: input.sessionId ?? null,
      sessionKey: input.sessionKey,
      provider: input.provider,
      status: input.status ?? "queued",
      reason: input.reason ?? null,
      details: (input.details ?? {}) as any,
      ...(input.status === "running" ? { startedAt: new Date() } : {}),
      ...(input.status === "succeeded" || input.status === "failed" ? { finishedAt: new Date() } : {}),
      createdByUserId: input.createdByUserId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create agent memory sync job");
  }
  return row;
}

export async function listAgentMemoryDocuments(
  db: Db,
  input: {
    organizationId: string;
    sessionKey?: string;
    limit?: number;
  }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 200)));
  const where = input.sessionKey
    ? and(eq(agentMemoryDocuments.organizationId, input.organizationId), eq(agentMemoryDocuments.sessionKey, input.sessionKey))
    : eq(agentMemoryDocuments.organizationId, input.organizationId);
  return await db
    .select()
    .from(agentMemoryDocuments)
    .where(where)
    .orderBy(desc(agentMemoryDocuments.updatedAt), desc(agentMemoryDocuments.id))
    .limit(limit);
}

export async function getAgentMemoryDocumentById(db: Db, input: { organizationId: string; documentId: string }) {
  const [row] = await db
    .select()
    .from(agentMemoryDocuments)
    .where(and(eq(agentMemoryDocuments.organizationId, input.organizationId), eq(agentMemoryDocuments.id, input.documentId)));
  return row ?? null;
}

export async function listAgentMemoryChunksByDocument(
  db: Db,
  input: { organizationId: string; documentId: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(1000, Math.floor(input.limit ?? 400)));
  return await db
    .select()
    .from(agentMemoryChunks)
    .where(and(eq(agentMemoryChunks.organizationId, input.organizationId), eq(agentMemoryChunks.documentId, input.documentId)))
    .orderBy(asc(agentMemoryChunks.chunkIndex))
    .limit(limit);
}

export async function createChannelAccount(
  db: Db,
  input: {
    organizationId: string;
    channelId: string;
    accountKey: string;
    displayName?: string | null;
    enabled?: boolean;
    dmPolicy?: string;
    groupPolicy?: string;
    requireMentionInGroup?: boolean;
    webhookUrl?: string | null;
    metadata?: unknown;
    createdByUserId: string;
    updatedByUserId: string;
  }
) {
  const [row] = await db
    .insert(channelAccounts)
    .values({
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
      metadata: (input.metadata ?? {}) as any,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create channel account");
  }
  return row;
}

export async function listChannelAccountsByOrg(
  db: Db,
  input: { organizationId: string; channelId?: string | null; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 200)));
  return await db
    .select()
    .from(channelAccounts)
    .where(
      input.channelId
        ? and(eq(channelAccounts.organizationId, input.organizationId), eq(channelAccounts.channelId, input.channelId))
        : eq(channelAccounts.organizationId, input.organizationId)
    )
    .orderBy(desc(channelAccounts.updatedAt), desc(channelAccounts.id))
    .limit(limit);
}

export async function getChannelAccountById(
  db: Db,
  input: { organizationId: string; accountId: string }
) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, input.organizationId), eq(channelAccounts.id, input.accountId)));
  return row ?? null;
}

export async function getChannelAccountByChannelAndKey(
  db: Db,
  input: { organizationId: string; channelId: string; accountKey: string }
) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.organizationId, input.organizationId),
        eq(channelAccounts.channelId, input.channelId),
        eq(channelAccounts.accountKey, input.accountKey)
      )
    );
  return row ?? null;
}

// Internal-runtime lookup used by gateway ingress where org context is derived
// from account mapping and must not be trusted from external payloads.
export async function getChannelAccountByChannelAndKeyGlobal(
  db: Db,
  input: { channelId: string; accountKey: string }
) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.channelId, input.channelId), eq(channelAccounts.accountKey, input.accountKey)))
    .limit(1);
  return row ?? null;
}

export async function updateChannelAccount(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
    patch: {
      displayName?: string | null;
      enabled?: boolean;
      dmPolicy?: string;
      groupPolicy?: string;
      requireMentionInGroup?: boolean;
      webhookUrl?: string | null;
      metadata?: unknown;
      status?: string;
      lastError?: string | null;
      lastSeenAt?: Date | null;
      updatedByUserId?: string;
    };
  }
) {
  const [row] = await db
    .update(channelAccounts)
    .set({
      ...(input.patch.displayName !== undefined ? { displayName: input.patch.displayName } : {}),
      ...(input.patch.enabled !== undefined ? { enabled: input.patch.enabled } : {}),
      ...(input.patch.dmPolicy !== undefined ? { dmPolicy: input.patch.dmPolicy } : {}),
      ...(input.patch.groupPolicy !== undefined ? { groupPolicy: input.patch.groupPolicy } : {}),
      ...(input.patch.requireMentionInGroup !== undefined
        ? { requireMentionInGroup: input.patch.requireMentionInGroup }
        : {}),
      ...(input.patch.webhookUrl !== undefined ? { webhookUrl: input.patch.webhookUrl } : {}),
      ...(input.patch.metadata !== undefined ? { metadata: input.patch.metadata as any } : {}),
      ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
      ...(input.patch.lastError !== undefined ? { lastError: input.patch.lastError } : {}),
      ...(input.patch.lastSeenAt !== undefined ? { lastSeenAt: input.patch.lastSeenAt } : {}),
      ...(input.patch.updatedByUserId !== undefined ? { updatedByUserId: input.patch.updatedByUserId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(channelAccounts.organizationId, input.organizationId), eq(channelAccounts.id, input.accountId)))
    .returning();
  return row ?? null;
}

export async function deleteChannelAccount(
  db: Db,
  input: { organizationId: string; accountId: string }
) {
  const [row] = await db
    .delete(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, input.organizationId), eq(channelAccounts.id, input.accountId)))
    .returning();
  return row ?? null;
}

export async function createChannelAccountSecret(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
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
  const [row] = await db
    .insert(channelAccountSecrets)
    .values({
      organizationId: input.organizationId,
      accountId: input.accountId,
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
    throw new Error("Failed to create channel account secret");
  }
  return row;
}

export async function listChannelAccountSecrets(
  db: Db,
  input: { organizationId: string; accountId: string }
) {
  return await db
    .select()
    .from(channelAccountSecrets)
    .where(and(eq(channelAccountSecrets.organizationId, input.organizationId), eq(channelAccountSecrets.accountId, input.accountId)))
    .orderBy(asc(channelAccountSecrets.name));
}

export async function getChannelAccountSecretById(
  db: Db,
  input: { organizationId: string; accountId: string; secretId: string }
) {
  const [row] = await db
    .select()
    .from(channelAccountSecrets)
    .where(
      and(
        eq(channelAccountSecrets.organizationId, input.organizationId),
        eq(channelAccountSecrets.accountId, input.accountId),
        eq(channelAccountSecrets.id, input.secretId)
      )
    );
  return row ?? null;
}

export async function listChannelAllowlistEntries(
  db: Db,
  input: { organizationId: string; accountId: string; scope?: string | null }
) {
  return await db
    .select()
    .from(channelAllowlistEntries)
    .where(
      input.scope
        ? and(
            eq(channelAllowlistEntries.organizationId, input.organizationId),
            eq(channelAllowlistEntries.accountId, input.accountId),
            eq(channelAllowlistEntries.scope, input.scope)
          )
        : and(eq(channelAllowlistEntries.organizationId, input.organizationId), eq(channelAllowlistEntries.accountId, input.accountId))
    )
    .orderBy(asc(channelAllowlistEntries.scope), asc(channelAllowlistEntries.subject));
}

export async function putChannelAllowlistEntry(
  db: Db,
  input: { organizationId: string; accountId: string; scope: string; subject: string; createdByUserId: string }
) {
  try {
    const [row] = await db
      .insert(channelAllowlistEntries)
      .values({
        organizationId: input.organizationId,
        accountId: input.accountId,
        scope: input.scope,
        subject: input.subject,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!row) {
      throw new Error("Failed to upsert channel allowlist");
    }
    return row;
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    const [existing] = await db
      .select()
      .from(channelAllowlistEntries)
      .where(
        and(
          eq(channelAllowlistEntries.organizationId, input.organizationId),
          eq(channelAllowlistEntries.accountId, input.accountId),
          eq(channelAllowlistEntries.scope, input.scope),
          eq(channelAllowlistEntries.subject, input.subject)
        )
      );
    if (!existing) {
      throw new Error("Failed to read existing channel allowlist entry");
    }
    return existing;
  }
}

export async function deleteChannelAllowlistEntry(
  db: Db,
  input: { organizationId: string; accountId: string; scope: string; subject: string }
) {
  const [row] = await db
    .delete(channelAllowlistEntries)
    .where(
      and(
        eq(channelAllowlistEntries.organizationId, input.organizationId),
        eq(channelAllowlistEntries.accountId, input.accountId),
        eq(channelAllowlistEntries.scope, input.scope),
        eq(channelAllowlistEntries.subject, input.subject)
      )
    )
    .returning();
  return row ?? null;
}

export async function createChannelPairingRequest(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
    scope: string;
    requesterId: string;
    requesterDisplayName?: string | null;
    code: string;
    expiresAt: Date;
  }
) {
  const [row] = await db
    .insert(channelPairingRequests)
    .values({
      organizationId: input.organizationId,
      accountId: input.accountId,
      scope: input.scope,
      requesterId: input.requesterId,
      requesterDisplayName: input.requesterDisplayName ?? null,
      code: input.code,
      status: "pending",
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create channel pairing request");
  }
  return row;
}

export async function listChannelPairingRequests(
  db: Db,
  input: { organizationId: string; accountId?: string | null; status?: string | null; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  let where = eq(channelPairingRequests.organizationId, input.organizationId);
  if (input.accountId) {
    where = and(where, eq(channelPairingRequests.accountId, input.accountId)) as any;
  }
  if (input.status) {
    where = and(where, eq(channelPairingRequests.status, input.status)) as any;
  }

  return await db
    .select()
    .from(channelPairingRequests)
    .where(where)
    .orderBy(desc(channelPairingRequests.createdAt))
    .limit(limit);
}

export async function updateChannelPairingRequestStatus(
  db: Db,
  input: {
    organizationId: string;
    requestId: string;
    status: "approved" | "rejected";
    approvedByUserId?: string | null;
  }
) {
  const [row] = await db
    .update(channelPairingRequests)
    .set({
      status: input.status,
      ...(input.status === "approved"
        ? { approvedByUserId: input.approvedByUserId ?? null, approvedAt: new Date(), rejectedAt: null }
        : { rejectedAt: new Date(), approvedAt: null }),
    })
    .where(and(eq(channelPairingRequests.organizationId, input.organizationId), eq(channelPairingRequests.id, input.requestId)))
    .returning();
  return row ?? null;
}

export async function getChannelConversation(
  db: Db,
  input: { organizationId: string; accountId: string; conversationId: string }
) {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.organizationId, input.organizationId),
        eq(channelConversations.accountId, input.accountId),
        eq(channelConversations.conversationId, input.conversationId)
      )
    );
  return row ?? null;
}

export async function upsertChannelConversation(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
    conversationId: string;
    sessionId?: string | null;
    workflowRouting?: unknown;
    security?: unknown;
    lastInboundAt?: Date | null;
    lastOutboundAt?: Date | null;
  }
) {
  const existing = await getChannelConversation(db, input);
  if (!existing) {
    const [created] = await db
      .insert(channelConversations)
      .values({
        organizationId: input.organizationId,
        accountId: input.accountId,
        conversationId: input.conversationId,
        sessionId: input.sessionId ?? null,
        workflowRouting: (input.workflowRouting ?? {}) as any,
        security: (input.security ?? {}) as any,
        lastInboundAt: input.lastInboundAt ?? null,
        lastOutboundAt: input.lastOutboundAt ?? null,
        updatedAt: new Date(),
      })
      .returning();
    if (!created) {
      throw new Error("Failed to create channel conversation");
    }
    return created;
  }

  const [updated] = await db
    .update(channelConversations)
    .set({
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.workflowRouting !== undefined ? { workflowRouting: input.workflowRouting as any } : {}),
      ...(input.security !== undefined ? { security: input.security as any } : {}),
      ...(input.lastInboundAt !== undefined ? { lastInboundAt: input.lastInboundAt } : {}),
      ...(input.lastOutboundAt !== undefined ? { lastOutboundAt: input.lastOutboundAt } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(channelConversations.organizationId, input.organizationId), eq(channelConversations.id, existing.id)))
    .returning();
  if (!updated) {
    throw new Error("Failed to update channel conversation");
  }
  return updated;
}

export async function createChannelMessage(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
    conversationId: string;
    direction: "inbound" | "outbound";
    providerMessageId: string;
    sessionEventSeq?: number | null;
    status?: string;
    attemptCount?: number;
    payload?: unknown;
    error?: string | null;
  }
) {
  try {
    const [row] = await db
      .insert(channelMessages)
      .values({
        organizationId: input.organizationId,
        accountId: input.accountId,
        conversationId: input.conversationId,
        direction: input.direction,
        providerMessageId: input.providerMessageId,
        sessionEventSeq: input.sessionEventSeq ?? null,
        status: input.status ?? "accepted",
        attemptCount: input.attemptCount ?? 0,
        payload: input.payload as any,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .returning();
    if (!row) {
      throw new Error("Failed to create channel message");
    }
    return row;
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    const [existing] = await db
      .select()
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.organizationId, input.organizationId),
          eq(channelMessages.accountId, input.accountId),
          eq(channelMessages.direction, input.direction),
          eq(channelMessages.providerMessageId, input.providerMessageId)
        )
      );
    if (!existing) {
      throw new Error("Failed to read existing channel message");
    }
    return existing;
  }
}

export async function appendChannelEvent(
  db: Db,
  input: {
    organizationId: string;
    accountId: string;
    conversationId?: string | null;
    eventType: string;
    level?: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }
) {
  const [row] = await db
    .insert(channelEvents)
    .values({
      organizationId: input.organizationId,
      accountId: input.accountId,
      conversationId: input.conversationId ?? null,
      eventType: input.eventType,
      level: input.level ?? "info",
      message: input.message ?? null,
      payload: input.payload as any,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to append channel event");
  }
  return row;
}

export async function listChannelEvents(
  db: Db,
  input: { organizationId: string; accountId: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  return await db
    .select()
    .from(channelEvents)
    .where(and(eq(channelEvents.organizationId, input.organizationId), eq(channelEvents.accountId, input.accountId)))
    .orderBy(desc(channelEvents.createdAt))
    .limit(limit);
}

export async function listPlatformUserRoles(
  db: Db,
  input?: { roleKey?: string; userId?: string }
) {
  const where: any[] = [];
  if (input?.roleKey) {
    where.push(eq(platformUserRoles.roleKey, input.roleKey));
  }
  if (input?.userId) {
    where.push(eq(platformUserRoles.userId, input.userId));
  }
  const condition = where.length > 0 ? and(...where) : undefined;
  const query = db.select().from(platformUserRoles).orderBy(desc(platformUserRoles.createdAt));
  return condition ? await query.where(condition) : await query;
}

export async function createPlatformUserRole(
  db: Db,
  input: { userId: string; roleKey: string; grantedByUserId?: string | null }
) {
  const [row] = await db
    .insert(platformUserRoles)
    .values({
      userId: input.userId,
      roleKey: input.roleKey,
      grantedByUserId: input.grantedByUserId ?? null,
    })
    .onConflictDoNothing({
      target: [platformUserRoles.userId, platformUserRoles.roleKey],
    })
    .returning();
  if (row) {
    return row;
  }
  const [existing] = await db
    .select()
    .from(platformUserRoles)
    .where(and(eq(platformUserRoles.userId, input.userId), eq(platformUserRoles.roleKey, input.roleKey)));
  if (!existing) {
    throw new Error("Failed to read existing platform user role");
  }
  return existing;
}

export async function deletePlatformUserRole(
  db: Db,
  input: { userId: string; roleKey: string }
) {
  const [deleted] = await db
    .delete(platformUserRoles)
    .where(and(eq(platformUserRoles.userId, input.userId), eq(platformUserRoles.roleKey, input.roleKey)))
    .returning({ id: platformUserRoles.id });
  return Boolean(deleted);
}

export async function upsertPlatformSetting(
  db: Db,
  input: { key: string; value: unknown; updatedByUserId?: string | null }
) {
  const [row] = await db
    .insert(platformSettings)
    .values({
      key: input.key,
      value: (input.value ?? {}) as any,
      updatedByUserId: input.updatedByUserId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: (input.value ?? {}) as any,
        updatedByUserId: input.updatedByUserId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    throw new Error("Failed to upsert platform setting");
  }
  return row;
}

export async function getPlatformSetting(
  db: Db,
  input: { key: string }
) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, input.key));
  return row ?? null;
}

export async function listPlatformSettings(db: Db) {
  return await db.select().from(platformSettings).orderBy(asc(platformSettings.key));
}

export async function createSupportTicket(
  db: Db,
  input: {
    requesterUserId?: string | null;
    organizationId?: string | null;
    category?: string;
    priority?: string;
    status?: string;
    subject: string;
    content: string;
    assigneeUserId?: string | null;
  }
) {
  const [row] = await db
    .insert(supportTickets)
    .values({
      requesterUserId: input.requesterUserId ?? null,
      organizationId: input.organizationId ?? null,
      category: input.category ?? "general",
      priority: input.priority ?? "normal",
      status: input.status ?? "open",
      subject: input.subject,
      content: input.content,
      assigneeUserId: input.assigneeUserId ?? null,
      updatedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create support ticket");
  }
  return row;
}

export async function listSupportTickets(
  db: Db,
  input?: { status?: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input?.limit ?? 100)));
  const query = db.select().from(supportTickets).orderBy(desc(supportTickets.updatedAt)).limit(limit);
  if (input?.status) {
    return await query.where(eq(supportTickets.status, input.status));
  }
  return await query;
}

export async function getSupportTicketById(
  db: Db,
  input: { ticketId: string }
) {
  const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId));
  return row ?? null;
}

export async function patchSupportTicket(
  db: Db,
  input: {
    ticketId: string;
    status?: string;
    priority?: string;
    assigneeUserId?: string | null;
  }
) {
  const [row] = await db
    .update(supportTickets)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, input.ticketId))
    .returning();
  return row ?? null;
}

export async function appendSupportTicketEvent(
  db: Db,
  input: {
    ticketId: string;
    actorUserId?: string | null;
    eventType: string;
    payload?: unknown;
  }
) {
  const [row] = await db
    .insert(supportTicketEvents)
    .values({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      payload: (input.payload ?? {}) as any,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to append support ticket event");
  }
  return row;
}

export async function listSupportTicketEvents(
  db: Db,
  input: { ticketId: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  return await db
    .select()
    .from(supportTicketEvents)
    .where(eq(supportTicketEvents.ticketId, input.ticketId))
    .orderBy(desc(supportTicketEvents.createdAt))
    .limit(limit);
}

export async function appendPlatformAuditLog(
  db: Db,
  input: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: unknown;
  }
) {
  const [row] = await db
    .insert(platformAuditLogs)
    .values({
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? {}) as any,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to append platform audit log");
  }
  return row;
}

export async function listPlatformAuditLogs(
  db: Db,
  input?: { action?: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Math.floor(input?.limit ?? 100)));
  const query = db.select().from(platformAuditLogs).orderBy(desc(platformAuditLogs.createdAt)).limit(limit);
  if (input?.action) {
    return await query.where(eq(platformAuditLogs.action, input.action));
  }
  return await query;
}
