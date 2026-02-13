create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  version integer not null default 1,
  dsl jsonb not null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflows_org_id_idx on workflows(organization_id);
create index if not exists workflows_org_status_idx on workflows(organization_id, status);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  trigger_type text not null,
  status text not null default 'queued',
  requested_by_user_id uuid not null references users(id) on delete restrict,
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists workflow_runs_org_id_idx on workflow_runs(organization_id);
create index if not exists workflow_runs_workflow_id_idx on workflow_runs(workflow_id);
create index if not exists workflow_runs_status_idx on workflow_runs(status);

alter table workflows enable row level security;
alter table workflow_runs enable row level security;

create policy workflows_tenant_isolation_all
on workflows
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

create policy workflow_runs_tenant_isolation_all
on workflow_runs
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

alter table workflows force row level security;
alter table workflow_runs force row level security;
