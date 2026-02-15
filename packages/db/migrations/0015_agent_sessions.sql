-- Agent sessions are a "chat-like" control plane feature (distinct from workflow runs).
-- They are tenant-scoped under strict RLS, like other org data.

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by_user_id uuid not null references users(id) on delete cascade,
  title text not null default '',
  status text not null default 'active',

  pinned_agent_id uuid null references organization_agents(id) on delete set null,
  selector_tag text null,
  selector_group text null,

  engine_id text not null default 'vespid.loop.v1',
  toolset_id uuid null references agent_toolsets(id) on delete set null,
  llm_provider text not null default 'openai',
  llm_model text not null default 'gpt-4.1-mini',
  tools_allow jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  prompt_system text null,
  prompt_instructions text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists agent_sessions_org_updated_idx on agent_sessions(organization_id, updated_at desc, id desc);

create table if not exists agent_session_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid not null references agent_sessions(id) on delete cascade,
  seq int not null,
  event_type text not null,
  level text not null default 'info',
  payload jsonb null,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_session_events_session_seq_unique on agent_session_events(session_id, seq);
create index if not exists agent_session_events_org_session_seq_idx on agent_session_events(organization_id, session_id, seq asc);

alter table agent_sessions enable row level security;
alter table agent_session_events enable row level security;

-- Tenant isolation: require app.current_org_id context.
drop policy if exists agent_sessions_tenant_isolation on agent_sessions;
create policy agent_sessions_tenant_isolation on agent_sessions
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists agent_session_events_tenant_isolation on agent_session_events;
create policy agent_session_events_tenant_isolation on agent_session_events
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

