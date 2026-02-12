import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleKey: text("role_key").notNull().references(() => roles.key, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  membershipUnique: uniqueIndex("memberships_org_user_unique").on(table.organizationId, table.userId),
}));

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleKey: text("role_key").notNull().references(() => roles.key, { onDelete: "restrict" }),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  inviteOrgEmailUnique: uniqueIndex("invites_org_email_pending_unique").on(table.organizationId, table.email, table.status),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [memberships.roleKey],
    references: [roles.key],
  }),
}));

export const invitationsRelations = relations(organizationInvitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationInvitations.organizationId],
    references: [organizations.id],
  }),
  invitedByUser: one(users, {
    fields: [organizationInvitations.invitedByUserId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [organizationInvitations.roleKey],
    references: [roles.key],
  }),
}));

export type DbRole = typeof roles.$inferSelect;
export type DbUser = typeof users.$inferSelect;
export type DbOrganization = typeof organizations.$inferSelect;
export type DbMembership = typeof memberships.$inferSelect;
export type DbOrganizationInvitation = typeof organizationInvitations.$inferSelect;
