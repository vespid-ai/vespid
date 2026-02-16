create table if not exists organization_executors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  token_hash text not null,
  revoked_at timestamptz null,
  last_seen_at timestamptz null,
  capabilities jsonb null,
  labels text[] not null default '{}'::text[],
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists organization_executors_token_hash_unique
  on organization_executors(token_hash);

create index if not exists organization_executors_org_created_at_idx
  on organization_executors(organization_id, created_at);

create index if not exists organization_executors_labels_gin_idx
  on organization_executors using gin (labels);

alter table organization_executors enable row level security;

drop policy if exists organization_executors_tenant_isolation_all on organization_executors;
create policy organization_executors_tenant_isolation_all
on organization_executors
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

create table if not exists executor_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists executor_pairing_tokens_token_hash_unique
  on executor_pairing_tokens(token_hash);

create index if not exists executor_pairing_tokens_org_created_at_idx
  on executor_pairing_tokens(organization_id, created_at);

alter table executor_pairing_tokens enable row level security;

drop policy if exists executor_pairing_tokens_tenant_isolation_all on executor_pairing_tokens;
create policy executor_pairing_tokens_tenant_isolation_all
on executor_pairing_tokens
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

