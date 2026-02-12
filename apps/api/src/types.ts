export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: string;
};

export type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
};

export type MembershipRecord = {
  id: string;
  organizationId: string;
  userId: string;
  roleKey: "owner" | "admin" | "member";
  createdAt: string;
};

export type InvitationRecord = {
  id: string;
  organizationId: string;
  email: string;
  roleKey: "admin" | "member";
  invitedByUserId: string;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

export interface AppStore {
  ensureDefaultRoles(): Promise<void>;
  createUser(input: { email: string; passwordHash: string; displayName?: string | null }): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createOrganizationWithOwner(input: { name: string; slug: string; ownerUserId: string }): Promise<{
    organization: OrganizationRecord;
    membership: MembershipRecord;
  }>;
  getMembership(input: { organizationId: string; userId: string }): Promise<MembershipRecord | null>;
  createInvitation(input: {
    organizationId: string;
    email: string;
    roleKey: "admin" | "member";
    invitedByUserId: string;
    ttlHours?: number;
  }): Promise<InvitationRecord>;
  updateMembershipRole(input: {
    organizationId: string;
    memberUserId: string;
    roleKey: "owner" | "admin" | "member";
  }): Promise<MembershipRecord | null>;
}
