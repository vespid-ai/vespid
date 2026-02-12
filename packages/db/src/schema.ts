import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
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

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  authSessionsUserIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
  authSessionsRefreshHashUnique: uniqueIndex("auth_sessions_refresh_token_hash_unique").on(table.refreshTokenHash),
}));

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  dsl: jsonb("dsl").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowsOrgIdIdx: index("workflows_org_id_idx").on(table.organizationId),
  workflowsOrgStatusIdx: index("workflows_org_status_idx").on(table.organizationId, table.status),
}));

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  status: text("status").notNull().default("queued"),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => ({
  workflowRunsOrgIdIdx: index("workflow_runs_org_id_idx").on(table.organizationId),
  workflowRunsWorkflowIdIdx: index("workflow_runs_workflow_id_idx").on(table.workflowId),
  workflowRunsStatusIdx: index("workflow_runs_status_idx").on(table.status),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  sessions: many(authSessions),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
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

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [workflows.createdByUserId],
    references: [users.id],
  }),
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowRuns.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id],
  }),
  requestedByUser: one(users, {
    fields: [workflowRuns.requestedByUserId],
    references: [users.id],
  }),
}));

export type DbRole = typeof roles.$inferSelect;
export type DbUser = typeof users.$inferSelect;
export type DbOrganization = typeof organizations.$inferSelect;
export type DbMembership = typeof memberships.$inferSelect;
export type DbOrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type DbAuthSession = typeof authSessions.$inferSelect;
export type DbWorkflow = typeof workflows.$inferSelect;
export type DbWorkflowRun = typeof workflowRuns.$inferSelect;
