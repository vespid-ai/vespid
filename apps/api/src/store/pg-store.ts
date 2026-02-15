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
  listConnectorSecrets as dbListConnectorSecrets,
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
  ensureOrganizationCreditBalanceRow as dbEnsureOrganizationCreditBalanceRow,
  getOrganizationCreditBalance as dbGetOrganizationCreditBalance,
  grantOrganizationCredits as dbGrantOrganizationCredits,
  creditOrganizationFromStripeEvent as dbCreditOrganizationFromStripeEvent,
  getOrganizationBillingAccount as dbGetOrganizationBillingAccount,
  createOrganizationBillingAccount as dbCreateOrganizationBillingAccount,
} from "@vespid/db";
import crypto from "node:crypto";
import { decryptSecret, encryptSecret, parseKekFromEnv } from "@vespid/shared";
import type {
  AgentToolsetRecord,
  AppStore,
  OrganizationCreditsRecord,
  OrganizationSettings,
  ToolsetBuilderSessionRecord,
  ToolsetBuilderTurnRecord,
  UserOrgSummaryRecord,
} from "../types.js";

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

  async ensurePersonalOrganizationForUser(input: {
    actorUserId: string;
    trialCredits: number;
  }): Promise<{ defaultOrgId: string; created: boolean }> {
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

        await this.withOrgContext({ userId: input.actorUserId, organizationId }, async (db) => {
          await dbEnsureOrganizationCreditBalanceRow(db, { organizationId });
          if (input.trialCredits > 0) {
            await dbGrantOrganizationCredits(db, {
              organizationId,
              credits: input.trialCredits,
              reason: "trial_grant",
              createdByUserId: input.actorUserId,
              metadata: { kind: "personal_workspace_bootstrap" },
            });
          }
        });

        return { defaultOrgId: organizationId, created: true };
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error("Failed to create personal organization");
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
    await this.withOrgContext({ userId: input.ownerUserId, organizationId }, async (db) => {
      await dbEnsureOrganizationCreditBalanceRow(db, { organizationId });
    });
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

  async getOrganizationCredits(input: { organizationId: string; actorUserId?: string }): Promise<OrganizationCreditsRecord> {
    const row = await this.withOrgContext(
      input.actorUserId ? { userId: input.actorUserId, organizationId: input.organizationId } : { organizationId: input.organizationId },
      async (db) => {
        const existing = await dbGetOrganizationCreditBalance(db, { organizationId: input.organizationId });
        return existing ?? (await dbEnsureOrganizationCreditBalanceRow(db, { organizationId: input.organizationId }));
      }
    );

    return {
      organizationId: row.organizationId,
      balanceCredits: row.balanceCredits,
      updatedAt: toIso(row.updatedAt),
    };
  }

  async grantOrganizationCredits(input: {
    organizationId: string;
    actorUserId?: string;
    credits: number;
    reason: string;
    metadata?: unknown;
  }): Promise<OrganizationCreditsRecord> {
    await this.withOrgContext(
      input.actorUserId ? { userId: input.actorUserId, organizationId: input.organizationId } : { organizationId: input.organizationId },
      async (db) => {
        await dbEnsureOrganizationCreditBalanceRow(db, { organizationId: input.organizationId });
        await dbGrantOrganizationCredits(db, {
          organizationId: input.organizationId,
          credits: input.credits,
          reason: input.reason,
          createdByUserId: input.actorUserId ?? null,
          metadata: input.metadata,
        });
      }
    );

    return this.getOrganizationCredits({
      organizationId: input.organizationId,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    });
  }

  async creditOrganizationFromStripeEvent(input: {
    organizationId: string;
    stripeEventId: string;
    credits: number;
    metadata?: unknown;
  }): Promise<{ applied: boolean; balance: OrganizationCreditsRecord }> {
    const result = await this.withOrgContext({ organizationId: input.organizationId }, async (db) =>
      dbCreditOrganizationFromStripeEvent(db, {
        organizationId: input.organizationId,
        credits: input.credits,
        stripeEventId: input.stripeEventId,
        metadata: input.metadata,
      })
    );

    const balance = await this.getOrganizationCredits({ organizationId: input.organizationId });
    return { applied: result.applied, balance };
  }

  async getOrganizationBillingAccount(input: { organizationId: string; actorUserId?: string }): Promise<{ stripeCustomerId: string } | null> {
    const row = await this.withOrgContext(
      input.actorUserId ? { userId: input.actorUserId, organizationId: input.organizationId } : { organizationId: input.organizationId },
      async (db) => dbGetOrganizationBillingAccount(db, { organizationId: input.organizationId })
    );
    if (!row) {
      return null;
    }
    return { stripeCustomerId: row.stripeCustomerId };
  }

  async createOrganizationBillingAccount(input: {
    organizationId: string;
    actorUserId?: string;
    stripeCustomerId: string;
  }): Promise<{ stripeCustomerId: string }> {
    const row = await this.withOrgContext(
      input.actorUserId ? { userId: input.actorUserId, organizationId: input.organizationId } : { organizationId: input.organizationId },
      async (db) =>
        dbCreateOrganizationBillingAccount(db, { organizationId: input.organizationId, stripeCustomerId: input.stripeCustomerId })
    );
    return { stripeCustomerId: row.stripeCustomerId };
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
}
