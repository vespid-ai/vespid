import {
  createDb,
  createPool,
  createInvitation,
  createOrganizationWithOwner,
  createUser,
  ensureDefaultRoles,
  getMembership,
  getUserByEmail,
  updateMembershipRole,
} from "@vespid/db";
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

  async createOrganizationWithOwner(input: { name: string; slug: string; ownerUserId: string }) {
    const { organization, membership } = await createOrganizationWithOwner(this.db(), input);
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

  async getMembership(input: { organizationId: string; userId: string }) {
    const row = await getMembership(this.db(), input);
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
    const row = await createInvitation(this.db(), input);
    return {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      roleKey: row.roleKey as "admin" | "member",
      invitedByUserId: row.invitedByUserId,
      token: row.token,
      status: row.status,
      expiresAt: toIso(row.expiresAt),
      createdAt: toIso(row.createdAt),
    };
  }

  async updateMembershipRole(input: {
    organizationId: string;
    memberUserId: string;
    roleKey: "owner" | "admin" | "member";
  }) {
    const row = await updateMembershipRole(this.db(), input);
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
}
