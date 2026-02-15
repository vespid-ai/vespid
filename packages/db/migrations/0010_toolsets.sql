create table if not exists agent_toolsets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  visibility text not null default 'private',
  public_slug text,
  published_at timestamptz,
  mcp_servers jsonb not null default '[]'::jsonb,
  agent_skills jsonb not null default '[]'::jsonb,
  adopted_from jsonb,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_toolsets_visibility_check check (visibility in ('private','org','public'))
);

create index if not exists agent_toolsets_org_created_at_idx
  on agent_toolsets(organization_id, created_at desc);

create unique index if not exists agent_toolsets_public_slug_unique
  on agent_toolsets(public_slug)
  where visibility='public' and public_slug is not null;

alter table agent_toolsets enable row level security;

-- SELECT is allowed for:
-- - org members (tenant context) for their org rows
-- - any authenticated user for public rows (no org context required)
drop policy if exists agent_toolsets_select_policy on agent_toolsets;
create policy agent_toolsets_select_policy
on agent_toolsets
for select
using (visibility = 'public' or organization_id = app.current_org_uuid());

drop policy if exists agent_toolsets_insert_policy on agent_toolsets;
create policy agent_toolsets_insert_policy
on agent_toolsets
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists agent_toolsets_update_policy on agent_toolsets;
create policy agent_toolsets_update_policy
on agent_toolsets
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists agent_toolsets_delete_policy on agent_toolsets;
create policy agent_toolsets_delete_policy
on agent_toolsets
for delete
using (organization_id = app.current_org_uuid());

