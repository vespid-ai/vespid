create table if not exists execution_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_type text not null,
  owner_id uuid not null,
  current_version bigint not null default 0,
  current_object_key text not null,
  current_etag text null,
  lock_token text null,
  lock_expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists execution_workspaces_org_owner_unique
  on execution_workspaces (organization_id, owner_type, owner_id);

create index if not exists execution_workspaces_org_current_version_idx
  on execution_workspaces (organization_id, current_version);

alter table execution_workspaces enable row level security;

drop policy if exists execution_workspaces_tenant_isolation on execution_workspaces;
create policy execution_workspaces_tenant_isolation
on execution_workspaces
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

