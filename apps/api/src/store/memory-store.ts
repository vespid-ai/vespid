import crypto from "node:crypto";
import type {
  AppStore,
  InvitationRecord,
  MembershipRecord,
  OrganizationRecord,
  UserRecord,
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

  async getMembership(input: { organizationId: string; userId: string }): Promise<MembershipRecord | null> {
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
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: new Date(Date.now() + (input.ttlHours ?? 72) * 3600 * 1000).toISOString(),
      createdAt: nowIso(),
    };

    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async updateMembershipRole(input: {
    organizationId: string;
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
