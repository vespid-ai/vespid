import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
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

export const platformUserRoles = pgTable(
  "platform_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    platformUserRolesUserRoleUnique: uniqueIndex("platform_user_roles_user_role_unique").on(table.userId, table.roleKey),
    platformUserRolesRoleCreatedAtIdx: index("platform_user_roles_role_created_at_idx").on(table.roleKey, table.createdAt),
  })
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const workflowShareInvitations = pgTable("workflow_share_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  accessRole: text("access_role").notNull().default("runner"),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowShareInvitationsOrgWorkflowIdx: index("workflow_share_invitations_org_workflow_idx").on(
    table.organizationId,
    table.workflowId,
    table.createdAt
  ),
  workflowShareInvitationsTokenIdx: index("workflow_share_invitations_token_idx").on(table.token),
  workflowShareInvitationsWorkflowEmailStatusUnique: uniqueIndex("workflow_share_invitations_workflow_email_status_unique").on(
    table.workflowId,
    table.email,
    table.status
  ),
}));

export const workflowShares = pgTable("workflow_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessRole: text("access_role").notNull().default("runner"),
  sourceInvitationId: uuid("source_invitation_id").references(() => workflowShareInvitations.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowSharesOrgWorkflowIdx: index("workflow_shares_org_workflow_idx").on(table.organizationId, table.workflowId, table.createdAt),
  workflowSharesUserIdx: index("workflow_shares_user_idx").on(table.userId, table.createdAt),
  workflowSharesWorkflowUserRevokedUnique: uniqueIndex("workflow_shares_workflow_user_revoked_unique").on(
    table.workflowId,
    table.userId,
    table.revokedAt
  ),
}));

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  triggerKey: text("trigger_key"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  triggerSource: text("trigger_source"),
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
  workflowRunsOrgWorkflowTriggerKeyUnique: uniqueIndex("workflow_runs_org_workflow_trigger_key_unique").on(
    table.organizationId,
    table.workflowId,
    table.triggerKey
  ),
  workflowRunsOrgStatusBlockedIdx: index("workflow_runs_org_status_blocked_idx").on(
    table.organizationId,
    table.status,
    table.blockedRequestId
  ),
}));

export const workflowTriggerSubscriptions = pgTable("workflow_trigger_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  workflowRevision: integer("workflow_revision").notNull(),
  triggerType: text("trigger_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  cronExpr: text("cron_expr"),
  heartbeatIntervalSec: integer("heartbeat_interval_sec"),
  heartbeatJitterSec: integer("heartbeat_jitter_sec"),
  heartbeatMaxSkewSec: integer("heartbeat_max_skew_sec"),
  webhookTokenHash: text("webhook_token_hash"),
  nextFireAt: timestamp("next_fire_at", { withTimezone: true }),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  lastTriggerKey: text("last_trigger_key"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowTriggerSubscriptionsOrgWorkflowTypeUnique: uniqueIndex("workflow_trigger_subscriptions_org_workflow_type_unique").on(
    table.organizationId,
    table.workflowId,
    table.triggerType
  ),
  workflowTriggerSubscriptionsWebhookTokenHashUnique: uniqueIndex("workflow_trigger_subscriptions_webhook_token_hash_unique").on(
    table.webhookTokenHash
  ),
  workflowTriggerSubscriptionsReadyIdx: index("workflow_trigger_subscriptions_ready_idx").on(
    table.enabled,
    table.nextFireAt,
    table.id
  ),
  workflowTriggerSubscriptionsOrgUpdatedIdx: index("workflow_trigger_subscriptions_org_updated_idx").on(
    table.organizationId,
    table.updatedAt
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

export const organizationPolicyRules = pgTable("organization_policy_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  effect: text("effect").notNull(),
  scope: jsonb("scope").notNull().default(sql`'{}'::jsonb`),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationPolicyRulesOrgEnabledPriorityIdx: index("organization_policy_rules_org_enabled_priority_idx").on(
    table.organizationId,
    table.enabled,
    table.priority,
    table.id
  ),
  organizationPolicyRulesOrgUpdatedIdx: index("organization_policy_rules_org_updated_idx").on(
    table.organizationId,
    table.updatedAt
  ),
}));

export const workflowApprovalRequests = pgTable("workflow_approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  requestKind: text("request_kind").notNull().default("policy"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decisionNote: text("decision_note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowApprovalRequestsOrgStatusCreatedIdx: index("workflow_approval_requests_org_status_created_idx").on(
    table.organizationId,
    table.status,
    table.createdAt,
    table.id
  ),
  workflowApprovalRequestsOrgRunIdx: index("workflow_approval_requests_org_run_idx").on(
    table.organizationId,
    table.runId,
    table.createdAt
  ),
  workflowApprovalRequestsOrgRunNodeStatusIdx: index("workflow_approval_requests_org_run_node_status_idx").on(
    table.organizationId,
    table.runId,
    table.nodeId,
    table.status,
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

export const executionWorkspaces = pgTable("execution_workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerType: text("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  currentVersion: bigint("current_version", { mode: "number" }).notNull().default(0),
  currentObjectKey: text("current_object_key").notNull(),
  currentEtag: text("current_etag"),
  lockToken: text("lock_token"),
  lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  executionWorkspacesOrgOwnerUnique: uniqueIndex("execution_workspaces_org_owner_unique").on(table.organizationId, table.ownerType, table.ownerId),
  executionWorkspacesOrgCurrentVersionIdx: index("execution_workspaces_org_current_version_idx").on(table.organizationId, table.currentVersion),
}));

export const organizationExecutors = pgTable("organization_executors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  capabilities: jsonb("capabilities"),
  labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationExecutorsTokenHashUnique: uniqueIndex("organization_executors_token_hash_unique").on(table.tokenHash),
  organizationExecutorsOrgCreatedAtIdx: index("organization_executors_org_created_at_idx").on(table.organizationId, table.createdAt),
}));

export const executorPairingTokens = pgTable("executor_pairing_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  executorPairingTokensTokenHashUnique: uniqueIndex("executor_pairing_tokens_token_hash_unique").on(table.tokenHash),
  executorPairingTokensOrgCreatedAtIdx: index("executor_pairing_tokens_org_created_at_idx").on(table.organizationId, table.createdAt),
}));

export const managedExecutors = pgTable("managed_executors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default(""),
  tokenHash: text("token_hash"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  maxInFlight: integer("max_in_flight").notNull().default(50),
  enabled: boolean("enabled").notNull().default(true),
  drain: boolean("drain").notNull().default(false),
  runtimeClass: text("runtime_class").notNull().default("container"),
  region: text("region"),
  labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
  capabilities: jsonb("capabilities"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  managedExecutorsTokenHashUnique: uniqueIndex("managed_executors_token_hash_unique").on(table.tokenHash),
  managedExecutorsCreatedAtIdx: index("managed_executors_created_at_idx").on(table.createdAt, table.id),
  managedExecutorsRevokedSeenIdx: index("managed_executors_revoked_seen_idx").on(table.revokedAt, table.lastSeenAt, table.id),
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
  sessionKey: text("session_key").notNull().default(""),
  scope: text("scope").notNull().default("main"),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("active"),
  pinnedAgentId: uuid("pinned_agent_id").references(() => organizationAgents.id, { onDelete: "set null" }),
  pinnedExecutorId: uuid("pinned_executor_id"),
  pinnedExecutorPool: text("pinned_executor_pool"),
  routedAgentId: uuid("routed_agent_id").references(() => organizationAgents.id, { onDelete: "set null" }),
  bindingId: uuid("binding_id"),
  selectorTag: text("selector_tag"),
  selectorGroup: text("selector_group"),
  engineId: text("engine_id").notNull().default("gateway.codex.v2"),
  toolsetId: uuid("toolset_id").references(() => agentToolsets.id, { onDelete: "set null" }),
  llmProvider: text("llm_provider").notNull().default("openai-codex"),
  llmModel: text("llm_model").notNull().default("gpt-5-codex"),
  llmSecretId: uuid("llm_secret_id").references(() => connectorSecrets.id, { onDelete: "set null" }),
  toolsAllow: jsonb("tools_allow").notNull().default(sql`'[]'::jsonb`),
  limits: jsonb("limits").notNull().default(sql`'{}'::jsonb`),
  promptSystem: text("prompt_system"),
  promptInstructions: text("prompt_instructions").notNull().default(""),
  runtime: jsonb("runtime").notNull().default(sql`'{}'::jsonb`),
  resetPolicySnapshot: jsonb("reset_policy_snapshot").notNull().default(sql`'{}'::jsonb`),
  workspaceId: uuid("workspace_id").references(() => executionWorkspaces.id, { onDelete: "set null" }),
  executorSelector: jsonb("executor_selector"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentSessionsOrgUpdatedIdx: index("agent_sessions_org_updated_idx").on(table.organizationId, table.updatedAt, table.id),
  agentSessionsOrgStatusUpdatedIdx: index("agent_sessions_org_status_updated_idx").on(
    table.organizationId,
    table.status,
    table.updatedAt,
    table.id
  ),
  agentSessionsOrgPinnedExecutorPoolUpdatedIdx: index("agent_sessions_org_pinned_executor_pool_updated_idx").on(
    table.organizationId,
    table.pinnedExecutorPool,
    table.updatedAt
  ),
  agentSessionsOrgSessionKeyUnique: uniqueIndex("agent_sessions_org_session_key_unique").on(table.organizationId, table.sessionKey),
}));

export const agentSessionEvents = pgTable("agent_session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  eventType: text("event_type").notNull(),
  level: text("level").notNull().default("info"),
  handoffFromAgentId: uuid("handoff_from_agent_id").references(() => organizationAgents.id, { onDelete: "set null" }),
  handoffToAgentId: uuid("handoff_to_agent_id").references(() => organizationAgents.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentSessionEventsSessionSeqUnique: uniqueIndex("agent_session_events_session_seq_unique").on(table.sessionId, table.seq),
  agentSessionEventsOrgSessionSeqIdx: index("agent_session_events_org_session_seq_idx").on(table.organizationId, table.sessionId, table.seq),
  agentSessionEventsOrgSessionIdempotencyUnique: uniqueIndex("agent_session_events_org_session_idempotency_unique").on(
    table.organizationId,
    table.sessionId,
    table.idempotencyKey
  ),
}));

export const agentBindings = pgTable("agent_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => organizationAgents.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(0),
  dimension: text("dimension").notNull(),
  match: jsonb("match").notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb("metadata"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentBindingsOrgDimensionPriorityIdx: index("agent_bindings_org_dimension_priority_idx").on(
    table.organizationId,
    table.dimension,
    table.priority,
    table.id
  ),
  agentBindingsOrgAgentIdx: index("agent_bindings_org_agent_idx").on(table.organizationId, table.agentId),
}));

export const agentResetPolicies = pgTable("agent_reset_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => organizationAgents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  policy: jsonb("policy").notNull().default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentResetPoliciesOrgActiveIdx: index("agent_reset_policies_org_active_idx").on(table.organizationId, table.active, table.id),
  agentResetPoliciesOrgAgentIdx: index("agent_reset_policies_org_agent_idx").on(table.organizationId, table.agentId),
}));

export const agentMemoryDocuments = pgTable("agent_memory_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
  sessionKey: text("session_key").notNull().default(""),
  provider: text("provider").notNull().default("builtin"),
  docPath: text("doc_path").notNull(),
  contentHash: text("content_hash").notNull(),
  lineCount: integer("line_count").notNull().default(0),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentMemoryDocumentsOrgSessionDocIdx: index("agent_memory_documents_org_session_doc_idx").on(
    table.organizationId,
    table.sessionKey,
    table.docPath
  ),
  agentMemoryDocumentsOrgSessionDocHashUnique: uniqueIndex("agent_memory_documents_org_session_doc_hash_unique").on(
    table.organizationId,
    table.sessionKey,
    table.docPath,
    table.contentHash
  ),
}));

export const agentMemoryChunks = pgTable("agent_memory_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => agentMemoryDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  embedding: jsonb("embedding"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentMemoryChunksDocumentChunkUnique: uniqueIndex("agent_memory_chunks_document_chunk_unique").on(table.documentId, table.chunkIndex),
  agentMemoryChunksOrgDocumentIdx: index("agent_memory_chunks_org_document_idx").on(table.organizationId, table.documentId),
}));

export const agentMemorySyncJobs = pgTable("agent_memory_sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
  sessionKey: text("session_key").notNull().default(""),
  provider: text("provider").notNull().default("builtin"),
  status: text("status").notNull().default("queued"),
  reason: text("reason"),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentMemorySyncJobsOrgCreatedIdx: index("agent_memory_sync_jobs_org_created_idx").on(table.organizationId, table.createdAt, table.id),
  agentMemorySyncJobsOrgSessionStatusIdx: index("agent_memory_sync_jobs_org_session_status_idx").on(
    table.organizationId,
    table.sessionKey,
    table.status
  ),
}));

export const channelAccounts = pgTable("channel_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  accountKey: text("account_key").notNull(),
  displayName: text("display_name"),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("stopped"),
  dmPolicy: text("dm_policy").notNull().default("pairing"),
  groupPolicy: text("group_policy").notNull().default("allowlist"),
  requireMentionInGroup: boolean("require_mention_in_group").notNull().default(true),
  webhookUrl: text("webhook_url"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  lastError: text("last_error"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelAccountsOrgChannelAccountKeyUnique: uniqueIndex("channel_accounts_org_channel_account_key_unique").on(
    table.organizationId,
    table.channelId,
    table.accountKey
  ),
  channelAccountsOrgChannelIdx: index("channel_accounts_org_channel_idx").on(table.organizationId, table.channelId),
}));

export const channelAccountSecrets = pgTable("channel_account_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
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
  channelAccountSecretsAccountNameUnique: uniqueIndex("channel_account_secrets_account_name_unique").on(table.accountId, table.name),
  channelAccountSecretsOrgAccountIdx: index("channel_account_secrets_org_account_idx").on(table.organizationId, table.accountId),
}));

export const channelAllowlistEntries = pgTable("channel_allowlist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  subject: text("subject").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelAllowlistEntriesUnique: uniqueIndex("channel_allowlist_entries_unique").on(table.accountId, table.scope, table.subject),
  channelAllowlistEntriesOrgScopeIdx: index("channel_allowlist_entries_org_scope_idx").on(table.organizationId, table.accountId, table.scope),
}));

export const channelPairingRequests = pgTable("channel_pairing_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("dm"),
  requesterId: text("requester_id").notNull(),
  requesterDisplayName: text("requester_display_name"),
  code: text("code").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelPairingRequestsCodeUnique: uniqueIndex("channel_pairing_requests_code_unique").on(table.code),
  channelPairingRequestsOrgStatusIdx: index("channel_pairing_requests_org_status_idx").on(table.organizationId, table.accountId, table.status),
  channelPairingRequestsExpiresAtIdx: index("channel_pairing_requests_expires_at_idx").on(table.expiresAt),
}));

export const channelConversations = pgTable("channel_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull(),
  sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
  workflowRouting: jsonb("workflow_routing").notNull().default(sql`'{}'::jsonb`),
  security: jsonb("security").notNull().default(sql`'{}'::jsonb`),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelConversationsUnique: uniqueIndex("channel_conversations_unique").on(table.accountId, table.conversationId),
  channelConversationsOrgSessionIdx: index("channel_conversations_org_session_idx").on(table.organizationId, table.sessionId),
}));

export const channelMessages = pgTable("channel_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull(),
  direction: text("direction").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  sessionEventSeq: integer("session_event_seq"),
  status: text("status").notNull().default("accepted"),
  attemptCount: integer("attempt_count").notNull().default(0),
  payload: jsonb("payload"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelMessagesProviderUnique: uniqueIndex("channel_messages_provider_unique").on(table.accountId, table.direction, table.providerMessageId),
  channelMessagesOrgConversationIdx: index("channel_messages_org_conversation_idx").on(table.organizationId, table.accountId, table.conversationId, table.createdAt),
}));

export const channelEvents = pgTable("channel_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => channelAccounts.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  eventType: text("event_type").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelEventsOrgAccountIdx: index("channel_events_org_account_idx").on(table.organizationId, table.accountId, table.createdAt),
  channelEventsOrgTypeIdx: index("channel_events_org_type_idx").on(table.organizationId, table.eventType, table.createdAt),
}));

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterUserId: uuid("requester_user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    category: text("category").notNull().default("general"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    supportTicketsStatusPriorityUpdatedAtIdx: index("support_tickets_status_priority_updated_at_idx").on(
      table.status,
      table.priority,
      table.updatedAt
    ),
    supportTicketsRequesterCreatedAtIdx: index("support_tickets_requester_created_at_idx").on(table.requesterUserId, table.createdAt),
  })
);

export const supportTicketEvents = pgTable(
  "support_ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    supportTicketEventsTicketCreatedAtIdx: index("support_ticket_events_ticket_created_at_idx").on(table.ticketId, table.createdAt),
  })
);

export const platformAuditLogs = pgTable(
  "platform_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    platformAuditLogsCreatedAtIdx: index("platform_audit_logs_created_at_idx").on(table.createdAt),
    platformAuditLogsActionCreatedAtIdx: index("platform_audit_logs_action_created_at_idx").on(table.action, table.createdAt),
  })
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
  workflowTriggerSubscriptions: many(workflowTriggerSubscriptions),
  workflowRunEvents: many(workflowRunEvents),
  policyRules: many(organizationPolicyRules),
  approvalRequests: many(workflowApprovalRequests),
  connectorSecrets: many(connectorSecrets),
  agents: many(organizationAgents),
  agentPairingTokens: many(agentPairingTokens),
  executionWorkspaces: many(executionWorkspaces),
  executors: many(organizationExecutors),
  executorPairingTokens: many(executorPairingTokens),
  toolsets: many(agentToolsets),
  toolsetBuilderSessions: many(toolsetBuilderSessions),
  agentSessions: many(agentSessions),
  agentSessionEvents: many(agentSessionEvents),
  channelAccounts: many(channelAccounts),
  channelAccountSecrets: many(channelAccountSecrets),
  channelAllowlistEntries: many(channelAllowlistEntries),
  channelPairingRequests: many(channelPairingRequests),
  channelConversations: many(channelConversations),
  channelMessages: many(channelMessages),
  channelEvents: many(channelEvents),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(organizationInvitations),
  sessions: many(authSessions),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
  workflowTriggerSubscriptions: many(workflowTriggerSubscriptions),
  policyRulesCreated: many(organizationPolicyRules),
  approvalRequestsRequested: many(workflowApprovalRequests),
  approvalRequestsDecided: many(workflowApprovalRequests),
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
  triggerSubscriptions: many(workflowTriggerSubscriptions),
  events: many(workflowRunEvents),
  approvalRequests: many(workflowApprovalRequests),
  shareInvitations: many(workflowShareInvitations),
  shares: many(workflowShares),
}));

export const workflowShareInvitationsRelations = relations(workflowShareInvitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowShareInvitations.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowShareInvitations.workflowId],
    references: [workflows.id],
  }),
  invitedByUser: one(users, {
    fields: [workflowShareInvitations.invitedByUserId],
    references: [users.id],
  }),
  acceptedByUser: one(users, {
    fields: [workflowShareInvitations.acceptedByUserId],
    references: [users.id],
  }),
}));

export const workflowSharesRelations = relations(workflowShares, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowShares.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowShares.workflowId],
    references: [workflows.id],
  }),
  user: one(users, {
    fields: [workflowShares.userId],
    references: [users.id],
  }),
  sourceInvitation: one(workflowShareInvitations, {
    fields: [workflowShares.sourceInvitationId],
    references: [workflowShareInvitations.id],
  }),
  createdByUser: one(users, {
    fields: [workflowShares.createdByUserId],
    references: [users.id],
  }),
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

export const workflowTriggerSubscriptionsRelations = relations(workflowTriggerSubscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowTriggerSubscriptions.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowTriggerSubscriptions.workflowId],
    references: [workflows.id],
  }),
  requestedByUser: one(users, {
    fields: [workflowTriggerSubscriptions.requestedByUserId],
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

export const organizationPolicyRulesRelations = relations(organizationPolicyRules, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationPolicyRules.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [organizationPolicyRules.createdByUserId],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [organizationPolicyRules.updatedByUserId],
    references: [users.id],
  }),
}));

export const workflowApprovalRequestsRelations = relations(workflowApprovalRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowApprovalRequests.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowApprovalRequests.workflowId],
    references: [workflows.id],
  }),
  run: one(workflowRuns, {
    fields: [workflowApprovalRequests.runId],
    references: [workflowRuns.id],
  }),
  requestedByUser: one(users, {
    fields: [workflowApprovalRequests.requestedByUserId],
    references: [users.id],
  }),
  decidedByUser: one(users, {
    fields: [workflowApprovalRequests.decidedByUserId],
    references: [users.id],
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
  routedAgent: one(organizationAgents, {
    fields: [agentSessions.routedAgentId],
    references: [organizationAgents.id],
  }),
  binding: one(agentBindings, {
    fields: [agentSessions.bindingId],
    references: [agentBindings.id],
  }),
  workspace: one(executionWorkspaces, {
    fields: [agentSessions.workspaceId],
    references: [executionWorkspaces.id],
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
  handoffFromAgent: one(organizationAgents, {
    fields: [agentSessionEvents.handoffFromAgentId],
    references: [organizationAgents.id],
  }),
  handoffToAgent: one(organizationAgents, {
    fields: [agentSessionEvents.handoffToAgentId],
    references: [organizationAgents.id],
  }),
}));

export const agentBindingsRelations = relations(agentBindings, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agentBindings.organizationId],
    references: [organizations.id],
  }),
  agent: one(organizationAgents, {
    fields: [agentBindings.agentId],
    references: [organizationAgents.id],
  }),
  createdByUser: one(users, {
    fields: [agentBindings.createdByUserId],
    references: [users.id],
  }),
  sessions: many(agentSessions),
}));

export const agentResetPoliciesRelations = relations(agentResetPolicies, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentResetPolicies.organizationId],
    references: [organizations.id],
  }),
  agent: one(organizationAgents, {
    fields: [agentResetPolicies.agentId],
    references: [organizationAgents.id],
  }),
  createdByUser: one(users, {
    fields: [agentResetPolicies.createdByUserId],
    references: [users.id],
  }),
}));

export const agentMemoryDocumentsRelations = relations(agentMemoryDocuments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agentMemoryDocuments.organizationId],
    references: [organizations.id],
  }),
  session: one(agentSessions, {
    fields: [agentMemoryDocuments.sessionId],
    references: [agentSessions.id],
  }),
  chunks: many(agentMemoryChunks),
}));

export const agentMemoryChunksRelations = relations(agentMemoryChunks, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentMemoryChunks.organizationId],
    references: [organizations.id],
  }),
  document: one(agentMemoryDocuments, {
    fields: [agentMemoryChunks.documentId],
    references: [agentMemoryDocuments.id],
  }),
}));

export const agentMemorySyncJobsRelations = relations(agentMemorySyncJobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [agentMemorySyncJobs.organizationId],
    references: [organizations.id],
  }),
  session: one(agentSessions, {
    fields: [agentMemorySyncJobs.sessionId],
    references: [agentSessions.id],
  }),
  createdByUser: one(users, {
    fields: [agentMemorySyncJobs.createdByUserId],
    references: [users.id],
  }),
}));

export const channelAccountsRelations = relations(channelAccounts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [channelAccounts.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [channelAccounts.createdByUserId],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [channelAccounts.updatedByUserId],
    references: [users.id],
  }),
  secrets: many(channelAccountSecrets),
  allowlistEntries: many(channelAllowlistEntries),
  pairingRequests: many(channelPairingRequests),
  conversations: many(channelConversations),
  messages: many(channelMessages),
  events: many(channelEvents),
}));

export const channelAccountSecretsRelations = relations(channelAccountSecrets, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelAccountSecrets.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelAccountSecrets.accountId],
    references: [channelAccounts.id],
  }),
  createdByUser: one(users, {
    fields: [channelAccountSecrets.createdByUserId],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [channelAccountSecrets.updatedByUserId],
    references: [users.id],
  }),
}));

export const channelAllowlistEntriesRelations = relations(channelAllowlistEntries, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelAllowlistEntries.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelAllowlistEntries.accountId],
    references: [channelAccounts.id],
  }),
  createdByUser: one(users, {
    fields: [channelAllowlistEntries.createdByUserId],
    references: [users.id],
  }),
}));

export const channelPairingRequestsRelations = relations(channelPairingRequests, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelPairingRequests.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelPairingRequests.accountId],
    references: [channelAccounts.id],
  }),
  approvedByUser: one(users, {
    fields: [channelPairingRequests.approvedByUserId],
    references: [users.id],
  }),
}));

export const channelConversationsRelations = relations(channelConversations, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelConversations.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelConversations.accountId],
    references: [channelAccounts.id],
  }),
  session: one(agentSessions, {
    fields: [channelConversations.sessionId],
    references: [agentSessions.id],
  }),
}));

export const channelMessagesRelations = relations(channelMessages, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelMessages.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelMessages.accountId],
    references: [channelAccounts.id],
  }),
}));

export const channelEventsRelations = relations(channelEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelEvents.organizationId],
    references: [organizations.id],
  }),
  account: one(channelAccounts, {
    fields: [channelEvents.accountId],
    references: [channelAccounts.id],
  }),
}));

export type DbRole = typeof roles.$inferSelect;
export type DbUser = typeof users.$inferSelect;
export type DbOrganization = typeof organizations.$inferSelect;
export type DbMembership = typeof memberships.$inferSelect;
export type DbOrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type DbAuthSession = typeof authSessions.$inferSelect;
export type DbWorkflow = typeof workflows.$inferSelect;
export type DbWorkflowShareInvitation = typeof workflowShareInvitations.$inferSelect;
export type DbWorkflowShare = typeof workflowShares.$inferSelect;
export type DbWorkflowRun = typeof workflowRuns.$inferSelect;
export type DbWorkflowTriggerSubscription = typeof workflowTriggerSubscriptions.$inferSelect;
export type DbWorkflowRunEvent = typeof workflowRunEvents.$inferSelect;
export type DbOrganizationPolicyRule = typeof organizationPolicyRules.$inferSelect;
export type DbWorkflowApprovalRequest = typeof workflowApprovalRequests.$inferSelect;
export type DbConnectorSecret = typeof connectorSecrets.$inferSelect;
export type DbOrganizationAgent = typeof organizationAgents.$inferSelect;
export type DbAgentPairingToken = typeof agentPairingTokens.$inferSelect;
export type DbExecutionWorkspace = typeof executionWorkspaces.$inferSelect;
export type DbOrganizationExecutor = typeof organizationExecutors.$inferSelect;
export type DbExecutorPairingToken = typeof executorPairingTokens.$inferSelect;
export type DbManagedExecutor = typeof managedExecutors.$inferSelect;
export type DbAgentToolset = typeof agentToolsets.$inferSelect;
export type DbToolsetBuilderSession = typeof toolsetBuilderSessions.$inferSelect;
export type DbToolsetBuilderTurn = typeof toolsetBuilderTurns.$inferSelect;
export type DbAgentSession = typeof agentSessions.$inferSelect;
export type DbAgentSessionEvent = typeof agentSessionEvents.$inferSelect;
export type DbAgentBinding = typeof agentBindings.$inferSelect;
export type DbAgentResetPolicy = typeof agentResetPolicies.$inferSelect;
export type DbAgentMemoryDocument = typeof agentMemoryDocuments.$inferSelect;
export type DbAgentMemoryChunk = typeof agentMemoryChunks.$inferSelect;
export type DbAgentMemorySyncJob = typeof agentMemorySyncJobs.$inferSelect;
export type DbChannelAccount = typeof channelAccounts.$inferSelect;
export type DbChannelAccountSecret = typeof channelAccountSecrets.$inferSelect;
export type DbChannelAllowlistEntry = typeof channelAllowlistEntries.$inferSelect;
export type DbChannelPairingRequest = typeof channelPairingRequests.$inferSelect;
export type DbChannelConversation = typeof channelConversations.$inferSelect;
export type DbChannelMessage = typeof channelMessages.$inferSelect;
export type DbChannelEvent = typeof channelEvents.$inferSelect;
