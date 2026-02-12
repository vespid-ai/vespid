create extension if not exists pgcrypto;

create table if not exists roles (
  key text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_unique on users ((lower(email)));

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_key text not null references roles(key) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists memberships_org_user_unique on memberships (organization_id, user_id);

create table if not exists organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role_key text not null references roles(key) on delete restrict,
  invited_by_user_id uuid not null references users(id) on delete restrict,
  token text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists invites_org_email_pending_unique
  on organization_invitations (organization_id, email, status);

insert into roles(key, name)
values
  ('owner', 'Owner'),
  ('admin', 'Admin'),
  ('member', 'Member')
on conflict (key) do nothing;

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table organization_invitations enable row level security;

create policy organizations_isolation_select
on organizations
for select
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

create policy organizations_isolation_modify
on organizations
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

create policy memberships_isolation_all
on memberships
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
);

create policy invitations_isolation_all
on organization_invitations
for all
using (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
)
with check (
  coalesce(current_setting('app.current_org_id', true), '') = ''
  or organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
);
