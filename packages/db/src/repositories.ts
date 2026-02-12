import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { memberships, organizationInvitations, organizations, roles, users } from "./schema.js";

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

export async function createOrganizationWithOwner(
  db: Db,
  input: { name: string; slug: string; ownerUserId: string }
) {
  const [organization] = await db
    .insert(organizations)
    .values({ name: input.name, slug: input.slug })
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
  const token = crypto.randomUUID();
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
