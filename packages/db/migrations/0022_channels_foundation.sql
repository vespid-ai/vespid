-- Channels foundation: org-scoped channel accounts, routing state, and audit events.

create table if not exists channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_id text not null,
  account_key text not null,
  display_name text null,
  enabled boolean not null default true,
  status text not null default 'stopped',
  dm_policy text not null default 'pairing',
  group_policy text not null default 'allowlist',
  require_mention_in_group boolean not null default true,
  webhook_url text null,
  metadata jsonb not null default '{}'::jsonb,
  last_error text null,
  last_seen_at timestamptz null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_accounts_org_channel_account_key_unique
  on channel_accounts(organization_id, channel_id, account_key);
create index if not exists channel_accounts_org_channel_idx
  on channel_accounts(organization_id, channel_id);

create table if not exists channel_account_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  name text not null,
  kek_id text not null,
  dek_ciphertext bytea not null,
  dek_iv bytea not null,
  dek_tag bytea not null,
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_account_secrets_account_name_unique
  on channel_account_secrets(account_id, name);
create index if not exists channel_account_secrets_org_account_idx
  on channel_account_secrets(organization_id, account_id);

create table if not exists channel_allowlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  scope text not null,
  subject text not null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists channel_allowlist_entries_unique
  on channel_allowlist_entries(account_id, scope, subject);
create index if not exists channel_allowlist_entries_org_scope_idx
  on channel_allowlist_entries(organization_id, account_id, scope);

create table if not exists channel_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  scope text not null default 'dm',
  requester_id text not null,
  requester_display_name text null,
  code text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  approved_by_user_id uuid null references users(id) on delete set null,
  approved_at timestamptz null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists channel_pairing_requests_code_unique
  on channel_pairing_requests(code);
create index if not exists channel_pairing_requests_org_status_idx
  on channel_pairing_requests(organization_id, account_id, status);
create index if not exists channel_pairing_requests_expires_at_idx
  on channel_pairing_requests(expires_at);

create table if not exists channel_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  conversation_id text not null,
  session_id uuid null references agent_sessions(id) on delete set null,
  workflow_routing jsonb not null default '{}'::jsonb,
  security jsonb not null default '{}'::jsonb,
  last_inbound_at timestamptz null,
  last_outbound_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_conversations_unique
  on channel_conversations(account_id, conversation_id);
create index if not exists channel_conversations_org_session_idx
  on channel_conversations(organization_id, session_id);

create table if not exists channel_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  conversation_id text not null,
  direction text not null,
  provider_message_id text not null,
  session_event_seq int null,
  status text not null default 'accepted',
  attempt_count int not null default 0,
  payload jsonb null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_messages_provider_unique
  on channel_messages(account_id, direction, provider_message_id);
create index if not exists channel_messages_org_conversation_idx
  on channel_messages(organization_id, account_id, conversation_id, created_at);

create table if not exists channel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references channel_accounts(id) on delete cascade,
  conversation_id text null,
  event_type text not null,
  level text not null default 'info',
  message text null,
  payload jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists channel_events_org_account_idx
  on channel_events(organization_id, account_id, created_at);
create index if not exists channel_events_org_type_idx
  on channel_events(organization_id, event_type, created_at);

alter table channel_accounts enable row level security;
alter table channel_account_secrets enable row level security;
alter table channel_allowlist_entries enable row level security;
alter table channel_pairing_requests enable row level security;
alter table channel_conversations enable row level security;
alter table channel_messages enable row level security;
alter table channel_events enable row level security;

drop policy if exists channel_accounts_tenant_isolation on channel_accounts;
create policy channel_accounts_tenant_isolation on channel_accounts
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_account_secrets_tenant_isolation on channel_account_secrets;
create policy channel_account_secrets_tenant_isolation on channel_account_secrets
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_allowlist_entries_tenant_isolation on channel_allowlist_entries;
create policy channel_allowlist_entries_tenant_isolation on channel_allowlist_entries
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_pairing_requests_tenant_isolation on channel_pairing_requests;
create policy channel_pairing_requests_tenant_isolation on channel_pairing_requests
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_conversations_tenant_isolation on channel_conversations;
create policy channel_conversations_tenant_isolation on channel_conversations
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_messages_tenant_isolation on channel_messages;
create policy channel_messages_tenant_isolation on channel_messages
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists channel_events_tenant_isolation on channel_events;
create policy channel_events_tenant_isolation on channel_events
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());
