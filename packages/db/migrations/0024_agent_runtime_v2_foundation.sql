create table if not exists agent_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references organization_agents(id) on delete cascade,
  priority int not null default 0,
  dimension text not null,
  match jsonb not null default '{}'::jsonb,
  metadata jsonb,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_bindings_org_dimension_priority_idx
  on agent_bindings(organization_id, dimension, priority desc, id asc);
create index if not exists agent_bindings_org_agent_idx
  on agent_bindings(organization_id, agent_id);

create table if not exists agent_reset_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid null references organization_agents(id) on delete cascade,
  name text not null,
  policy jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_reset_policies_org_active_idx
  on agent_reset_policies(organization_id, active, id);
create index if not exists agent_reset_policies_org_agent_idx
  on agent_reset_policies(organization_id, agent_id);

alter table agent_sessions
  add column if not exists session_key text;

update agent_sessions
set session_key = concat('session:', id::text)
where session_key is null or btrim(session_key) = '';

alter table agent_sessions
  alter column session_key set default '';
alter table agent_sessions
  alter column session_key set not null;

alter table agent_sessions
  add column if not exists scope text not null default 'main';

alter table agent_sessions
  add column if not exists routed_agent_id uuid null references organization_agents(id) on delete set null;

alter table agent_sessions
  add column if not exists binding_id uuid null references agent_bindings(id) on delete set null;

alter table agent_sessions
  add column if not exists reset_policy_snapshot jsonb not null default '{}'::jsonb;

create unique index if not exists agent_sessions_org_session_key_unique
  on agent_sessions(organization_id, session_key);

alter table agent_session_events
  add column if not exists handoff_from_agent_id uuid null references organization_agents(id) on delete set null;

alter table agent_session_events
  add column if not exists handoff_to_agent_id uuid null references organization_agents(id) on delete set null;

alter table agent_session_events
  add column if not exists idempotency_key text;

create unique index if not exists agent_session_events_org_session_idempotency_unique
  on agent_session_events(organization_id, session_id, idempotency_key);

create table if not exists agent_memory_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid null references agent_sessions(id) on delete set null,
  session_key text not null default '',
  provider text not null default 'builtin',
  doc_path text not null,
  content_hash text not null,
  line_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_memory_documents_org_session_doc_idx
  on agent_memory_documents(organization_id, session_key, doc_path);
create unique index if not exists agent_memory_documents_org_session_doc_hash_unique
  on agent_memory_documents(organization_id, session_key, doc_path, content_hash);

create table if not exists agent_memory_chunks (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references agent_memory_documents(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  token_count int not null default 0,
  embedding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_memory_chunks_document_chunk_unique
  on agent_memory_chunks(document_id, chunk_index);
create index if not exists agent_memory_chunks_org_document_idx
  on agent_memory_chunks(organization_id, document_id);

create table if not exists agent_memory_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid null references agent_sessions(id) on delete set null,
  session_key text not null default '',
  provider text not null default 'builtin',
  status text not null default 'queued',
  reason text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_by_user_id uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_memory_sync_jobs_org_created_idx
  on agent_memory_sync_jobs(organization_id, created_at desc, id desc);
create index if not exists agent_memory_sync_jobs_org_session_status_idx
  on agent_memory_sync_jobs(organization_id, session_key, status, id);

alter table agent_bindings enable row level security;
alter table agent_reset_policies enable row level security;
alter table agent_memory_documents enable row level security;
alter table agent_memory_chunks enable row level security;
alter table agent_memory_sync_jobs enable row level security;

drop policy if exists agent_bindings_tenant_isolation on agent_bindings;
create policy agent_bindings_tenant_isolation on agent_bindings
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists agent_reset_policies_tenant_isolation on agent_reset_policies;
create policy agent_reset_policies_tenant_isolation on agent_reset_policies
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists agent_memory_documents_tenant_isolation on agent_memory_documents;
create policy agent_memory_documents_tenant_isolation on agent_memory_documents
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists agent_memory_chunks_tenant_isolation on agent_memory_chunks;
create policy agent_memory_chunks_tenant_isolation on agent_memory_chunks
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists agent_memory_sync_jobs_tenant_isolation on agent_memory_sync_jobs;
create policy agent_memory_sync_jobs_tenant_isolation on agent_memory_sync_jobs
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());
