create schema if not exists app;

create or replace function app.current_org_uuid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_org_id', true), '')::uuid
$$;

create or replace function app.current_user_uuid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

drop policy if exists organizations_isolation_select on organizations;
drop policy if exists organizations_isolation_modify on organizations;
drop policy if exists memberships_isolation_all on memberships;
drop policy if exists invitations_isolation_all on organization_invitations;

create policy organizations_tenant_isolation_all
on organizations
for all
using (id = app.current_org_uuid())
with check (id = app.current_org_uuid());

create policy memberships_tenant_isolation_all
on memberships
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

create policy invitations_tenant_isolation_all
on organization_invitations
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

-- Enforce RLS even for table owners/superusers to avoid accidental bypass.
alter table organizations force row level security;
alter table memberships force row level security;
alter table organization_invitations force row level security;

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_id_idx on auth_sessions(user_id);
create unique index if not exists auth_sessions_refresh_token_hash_unique on auth_sessions(refresh_token_hash);

alter table auth_sessions enable row level security;

create policy auth_sessions_user_isolation_all
on auth_sessions
for all
using (user_id = app.current_user_uuid())
with check (user_id = app.current_user_uuid());

alter table auth_sessions force row level security;
