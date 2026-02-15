create table if not exists organization_credit_balances (
  organization_id uuid primary key references organizations(id) on delete cascade,
  balance_credits bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists organization_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  delta_credits bigint not null,
  reason text not null,
  stripe_event_id text,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  created_by_user_id uuid references users(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Idempotency for Stripe events.
create unique index if not exists organization_credit_ledger_stripe_event_unique
on organization_credit_ledger(stripe_event_id)
where stripe_event_id is not null;

create index if not exists organization_credit_ledger_org_created_at_idx
on organization_credit_ledger(organization_id, created_at desc);

alter table organization_credit_balances enable row level security;
alter table organization_credit_ledger enable row level security;

drop policy if exists organization_credit_balances_tenant_isolation_all on organization_credit_balances;
create policy organization_credit_balances_tenant_isolation_all
on organization_credit_balances
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists organization_credit_ledger_tenant_isolation_all on organization_credit_ledger;
create policy organization_credit_ledger_tenant_isolation_all
on organization_credit_ledger
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

