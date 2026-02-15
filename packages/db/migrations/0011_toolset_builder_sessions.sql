create table if not exists toolset_builder_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by_user_id uuid not null references users(id) on delete restrict,
  status text not null,
  llm jsonb not null,
  latest_intent text,
  selected_component_keys jsonb not null default '[]'::jsonb,
  final_draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint toolset_builder_sessions_status_check check (status in ('ACTIVE','FINALIZED','ARCHIVED'))
);

create table if not exists toolset_builder_turns (
  id bigserial primary key,
  session_id uuid not null references toolset_builder_sessions(id) on delete cascade,
  role text not null,
  message_text text not null,
  created_at timestamptz not null default now(),
  constraint toolset_builder_turns_role_check check (role in ('USER','ASSISTANT'))
);

create index if not exists toolset_builder_sessions_org_created_at_idx
  on toolset_builder_sessions(organization_id, created_at desc);

create index if not exists toolset_builder_turns_session_created_at_idx
  on toolset_builder_turns(session_id, created_at asc);

alter table toolset_builder_sessions enable row level security;
alter table toolset_builder_turns enable row level security;

drop policy if exists toolset_builder_sessions_select_policy on toolset_builder_sessions;
create policy toolset_builder_sessions_select_policy
on toolset_builder_sessions
for select
using (organization_id = app.current_org_uuid());

drop policy if exists toolset_builder_sessions_insert_policy on toolset_builder_sessions;
create policy toolset_builder_sessions_insert_policy
on toolset_builder_sessions
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists toolset_builder_sessions_update_policy on toolset_builder_sessions;
create policy toolset_builder_sessions_update_policy
on toolset_builder_sessions
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists toolset_builder_sessions_delete_policy on toolset_builder_sessions;
create policy toolset_builder_sessions_delete_policy
on toolset_builder_sessions
for delete
using (organization_id = app.current_org_uuid());

drop policy if exists toolset_builder_turns_select_policy on toolset_builder_turns;
create policy toolset_builder_turns_select_policy
on toolset_builder_turns
for select
using (session_id in (select id from toolset_builder_sessions where organization_id = app.current_org_uuid()));

drop policy if exists toolset_builder_turns_insert_policy on toolset_builder_turns;
create policy toolset_builder_turns_insert_policy
on toolset_builder_turns
for insert
with check (session_id in (select id from toolset_builder_sessions where organization_id = app.current_org_uuid()));

drop policy if exists toolset_builder_turns_update_policy on toolset_builder_turns;
create policy toolset_builder_turns_update_policy
on toolset_builder_turns
for update
using (session_id in (select id from toolset_builder_sessions where organization_id = app.current_org_uuid()))
with check (session_id in (select id from toolset_builder_sessions where organization_id = app.current_org_uuid()));

drop policy if exists toolset_builder_turns_delete_policy on toolset_builder_turns;
create policy toolset_builder_turns_delete_policy
on toolset_builder_turns
for delete
using (session_id in (select id from toolset_builder_sessions where organization_id = app.current_org_uuid()));

