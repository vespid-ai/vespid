create table if not exists user_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payer_user_id uuid references users(id) on delete set null,
  payer_email text,
  status text not null,
  amount bigint,
  currency text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists user_payment_events_provider_event_unique
  on user_payment_events(provider, provider_event_id);
create index if not exists user_payment_events_payer_created_at_idx
  on user_payment_events(payer_user_id, created_at);
create index if not exists user_payment_events_provider_status_created_at_idx
  on user_payment_events(provider, status, created_at);

create table if not exists user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tier text not null,
  source_provider text not null,
  source_event_id text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists user_entitlements_source_unique
  on user_entitlements(user_id, source_provider, source_event_id);
create index if not exists user_entitlements_user_active_idx
  on user_entitlements(user_id, active, valid_until);

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

create unique index if not exists organization_credit_ledger_stripe_event_unique
  on organization_credit_ledger(stripe_event_id)
  where stripe_event_id is not null;
create index if not exists organization_credit_ledger_org_created_at_idx
  on organization_credit_ledger(organization_id, created_at desc);

create table if not exists organization_billing_accounts (
  organization_id uuid primary key references organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table organization_credit_balances enable row level security;
alter table organization_credit_ledger enable row level security;
alter table organization_billing_accounts enable row level security;

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

drop policy if exists organization_billing_accounts_tenant_isolation_all on organization_billing_accounts;
create policy organization_billing_accounts_tenant_isolation_all
on organization_billing_accounts
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

insert into platform_settings(key, value)
values ('payments.providers', '{"enabled":["stripe"]}'::jsonb)
on conflict (key) do nothing;
