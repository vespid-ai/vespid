import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Drizzle pg-core doesn't expose a bytea helper in all versions; define a small custom type.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
  },
});

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
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
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
  // Groups versions of the same conceptual workflow. (family_id = id for the first revision)
  familyId: uuid("family_id").notNull(),
  // Monotonic per (organization_id, family_id). Each revision is its own row.
  revision: integer("revision").notNull(),
  // Optional pointer to the workflow row this draft was cloned from.
  sourceWorkflowId: uuid("source_workflow_id"),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  dsl: jsonb("dsl").notNull(),
  // UI-only metadata (node positions, viewport, etc). Never used for execution.
  editorState: jsonb("editor_state"),
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
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  cursorNodeIndex: integer("cursor_node_index").notNull().default(0),
  blockedRequestId: text("blocked_request_id"),
  blockedNodeId: text("blocked_node_id"),
  blockedNodeType: text("blocked_node_type"),
  blockedKind: text("blocked_kind"),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  blockedTimeoutAt: timestamp("blocked_timeout_at", { withTimezone: true }),
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
  workflowRunsOrgStatusBlockedIdx: index("workflow_runs_org_status_blocked_idx").on(
    table.organizationId,
    table.status,
    table.blockedRequestId
  ),
}));

export const workflowRunEvents = pgTable("workflow_run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  attemptCount: integer("attempt_count").notNull().default(0),
  eventType: text("event_type").notNull(),
  nodeId: text("node_id"),
  nodeType: text("node_type"),
  level: text("level").notNull().default("info"),
  message: text("message"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowRunEventsOrgWorkflowRunCreatedAtIdx: index("workflow_run_events_org_workflow_run_created_at_idx").on(
    table.organizationId,
    table.workflowId,
    table.runId,
    table.createdAt
  ),
  workflowRunEventsOrgRunCreatedAtIdx: index("workflow_run_events_org_run_created_at_idx").on(
    table.organizationId,
    table.runId,
    table.createdAt
  ),
}));

export const connectorSecrets = pgTable("connector_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").notNull(),
  name: text("name").notNull(),
  kekId: text("kek_id").notNull(),
  dekCiphertext: bytea("dek_ciphertext").notNull(),
  dekIv: bytea("dek_iv").notNull(),
  dekTag: bytea("dek_tag").notNull(),
  secretCiphertext: bytea("secret_ciphertext").notNull(),
  secretIv: bytea("secret_iv").notNull(),
  secretTag: bytea("secret_tag").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  connectorSecretsOrgConnectorNameUnique: uniqueIndex("connector_secrets_org_connector_name_unique").on(
    table.organizationId,
    table.connectorId,
    table.name
  ),
  connectorSecretsOrgConnectorIdx: index("connector_secrets_org_connector_idx").on(table.organizationId, table.connectorId),
}));

export const organizationCreditBalances = pgTable("organization_credit_balances", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  balanceCredits: bigint("balance_credits", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationCreditLedger = pgTable("organization_credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deltaCredits: bigint("delta_credits", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  stripeEventId: text("stripe_event_id"),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationCreditLedgerOrgCreatedAtIdx: index("organization_credit_ledger_org_created_at_idx").on(
    table.organizationId,
    table.createdAt
  ),
}));

export const organizationBillingAccounts = pgTable("organization_billing_accounts", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationAgents = pgTable("organization_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  capabilities: jsonb("capabilities"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationAgentsTokenHashUnique: uniqueIndex("organization_agents_token_hash_unique").on(table.tokenHash),
  organizationAgentsOrgCreatedAtIdx: index("organization_agents_org_created_at_idx").on(table.organizationId, table.createdAt),
}));

export const agentPairingTokens = pgTable("agent_pairing_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentPairingTokensTokenHashUnique: uniqueIndex("agent_pairing_tokens_token_hash_unique").on(table.tokenHash),
  agentPairingTokensOrgCreatedAtIdx: index("agent_pairing_tokens_org_created_at_idx").on(table.organizationId, table.createdAt),
}));

export const agentToolsets = pgTable("agent_toolsets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  visibility: text("visibility").notNull().default("private"),
  publicSlug: text("public_slug"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  mcpServers: jsonb("mcp_servers").notNull().default(sql`'[]'::jsonb`),
  agentSkills: jsonb("agent_skills").notNull().default(sql`'[]'::jsonb`),
  adoptedFrom: jsonb("adopted_from"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentToolsetsOrgCreatedAtIdx: index("agent_toolsets_org_created_at_idx").on(table.organizationId, table.createdAt),
  agentToolsetsPublicSlugIdx: index("agent_toolsets_public_slug_idx").on(table.publicSlug),
}));

export const toolsetBuilderSessions = pgTable("toolset_builder_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  llm: jsonb("llm").notNull(),
  latestIntent: text("latest_intent"),
  selectedComponentKeys: jsonb("selected_component_keys").notNull().default(sql`'[]'::jsonb`),
  finalDraft: jsonb("final_draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  toolsetBuilderSessionsOrgCreatedAtIdx: index("toolset_builder_sessions_org_created_at_idx").on(table.organizationId, table.createdAt),
}));

export const toolsetBuilderTurns = pgTable("toolset_builder_turns", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => toolsetBuilderSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  messageText: text("message_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  toolsetBuilderTurnsSessionCreatedAtIdx: index("toolset_builder_turns_session_created_at_idx").on(table.sessionId, table.createdAt),
}));

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("active"),
  pinnedAgentId: uuid("pinned_agent_id").references(() => organizationAgents.id, { onDelete: "set null" }),
  selectorTag: text("selector_tag"),
  selectorGroup: text("selector_group"),
  engineId: text("engine_id").notNull().default("vespid.loop.v1"),
  toolsetId: uuid("toolset_id").references(() => agentToolsets.id, { onDelete: "set null" }),
  llmProvider: text("llm_provider").notNull().default("openai"),
  llmModel: text("llm_model").notNull().default("gpt-4.1-mini"),
  llmSecretId: uuid("llm_secret_id").references(() => connectorSecrets.id, { onDelete: "set null" }),
  toolsAllow: jsonb("tools_allow").notNull().default(sql`'[]'::jsonb`),
  limits: jsonb("limits").notNull().default(sql`'{}'::jsonb`),
  promptSystem: text("prompt_system"),
  promptInstructions: text("prompt_instructions").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentSessionsOrgUpdatedIdx: index("agent_sessions_org_updated_idx").on(table.organizationId, table.updatedAt, table.id),
}));

export const agentSessionEvents = pgTable("agent_session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  eventType: text("event_type").notNull(),
  level: text("level").notNull().default("info"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentSessionEventsSessionSeqUnique: uniqueIndex("agent_session_events_session_seq_unique").on(table.sessionId, table.seq),
  agentSessionEventsOrgSessionSeqIdx: index("agent_session_events_org_session_seq_idx").on(table.organizationId, table.sessionId, table.seq),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
  workflowRunEvents: many(workflowRunEvents),
  connectorSecrets: many(connectorSecrets),
  agents: many(organizationAgents),
  agentPairingTokens: many(agentPairingTokens),
  toolsets: many(agentToolsets),
  toolsetBuilderSessions: many(toolsetBuilderSessions),
  agentSessions: many(agentSessions),
  agentSessionEvents: many(agentSessionEvents),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  sessions: many(authSessions),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
  agentSessions: many(agentSessions),
}));

export const toolsetBuilderSessionsRelations = relations(toolsetBuilderSessions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [toolsetBuilderSessions.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [toolsetBuilderSessions.createdByUserId],
    references: [users.id],
  }),
  turns: many(toolsetBuilderTurns),
}));

export const toolsetBuilderTurnsRelations = relations(toolsetBuilderTurns, ({ one }) => ({
  session: one(toolsetBuilderSessions, {
    fields: [toolsetBuilderTurns.sessionId],
    references: [toolsetBuilderSessions.id],
  }),
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
  events: many(workflowRunEvents),
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

export const workflowRunEventsRelations = relations(workflowRunEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowRunEvents.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowRunEvents.workflowId],
    references: [workflows.id],
  }),
  run: one(workflowRuns, {
    fields: [workflowRunEvents.runId],
    references: [workflowRuns.id],
  }),
}));

export const agentSessionsRelations = relations(agentSessions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agentSessions.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [agentSessions.createdByUserId],
    references: [users.id],
  }),
  toolset: one(agentToolsets, {
    fields: [agentSessions.toolsetId],
    references: [agentToolsets.id],
  }),
  pinnedAgent: one(organizationAgents, {
    fields: [agentSessions.pinnedAgentId],
    references: [organizationAgents.id],
  }),
  events: many(agentSessionEvents),
}));

export const agentSessionEventsRelations = relations(agentSessionEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentSessionEvents.organizationId],
    references: [organizations.id],
  }),
  session: one(agentSessions, {
    fields: [agentSessionEvents.sessionId],
    references: [agentSessions.id],
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
export type DbWorkflowRunEvent = typeof workflowRunEvents.$inferSelect;
export type DbConnectorSecret = typeof connectorSecrets.$inferSelect;
export type DbOrganizationAgent = typeof organizationAgents.$inferSelect;
export type DbAgentPairingToken = typeof agentPairingTokens.$inferSelect;
export type DbAgentToolset = typeof agentToolsets.$inferSelect;
export type DbToolsetBuilderSession = typeof toolsetBuilderSessions.$inferSelect;
export type DbToolsetBuilderTurn = typeof toolsetBuilderTurns.$inferSelect;
export type DbAgentSession = typeof agentSessions.$inferSelect;
export type DbAgentSessionEvent = typeof agentSessionEvents.$inferSelect;
