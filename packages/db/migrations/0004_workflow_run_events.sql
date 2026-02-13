create table if not exists workflow_run_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  attempt_count integer not null default 0,
  event_type text not null,
  node_id text,
  node_type text,
  level text not null default 'info',
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table workflow_run_events enable row level security;

create policy workflow_run_events_tenant_isolation_all
on workflow_run_events
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

alter table workflow_run_events
  add constraint workflow_run_events_attempt_count_non_negative
  check (attempt_count >= 0);

create index if not exists workflow_run_events_org_workflow_run_created_at_idx
  on workflow_run_events(organization_id, workflow_id, run_id, created_at);

create index if not exists workflow_run_events_org_run_created_at_idx
  on workflow_run_events(organization_id, run_id, created_at);
