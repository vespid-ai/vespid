create table if not exists organization_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  effect text not null,
  scope jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_policy_rules_effect_chk check (effect in ('allow', 'deny', 'require_approval'))
);

create index if not exists organization_policy_rules_org_enabled_priority_idx
  on organization_policy_rules(organization_id, enabled, priority, id);

create index if not exists organization_policy_rules_org_updated_idx
  on organization_policy_rules(organization_id, updated_at desc, id desc);

create table if not exists workflow_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  request_kind text not null default 'policy',
  status text not null default 'pending',
  reason text,
  context jsonb not null default '{}'::jsonb,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  decided_by_user_id uuid references users(id) on delete set null,
  decision_note text,
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_approval_requests_status_chk check (status in ('pending', 'approved', 'rejected', 'expired'))
);

create index if not exists workflow_approval_requests_org_status_created_idx
  on workflow_approval_requests(organization_id, status, created_at desc, id desc);

create index if not exists workflow_approval_requests_org_run_idx
  on workflow_approval_requests(organization_id, run_id, created_at desc, id desc);

create index if not exists workflow_approval_requests_org_run_node_status_idx
  on workflow_approval_requests(organization_id, run_id, node_id, status, created_at desc);

alter table organization_policy_rules enable row level security;
alter table workflow_approval_requests enable row level security;

drop policy if exists organization_policy_rules_tenant_isolation on organization_policy_rules;
create policy organization_policy_rules_tenant_isolation on organization_policy_rules
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_approval_requests_tenant_isolation on workflow_approval_requests;
create policy workflow_approval_requests_tenant_isolation on workflow_approval_requests
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());
