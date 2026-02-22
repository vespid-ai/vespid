create table if not exists organization_subscriptions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  tier text not null default 'free',
  status text not null default 'active',
  monthly_run_limit integer,
  inflight_run_limit integer,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_tier_chk check (tier in ('free', 'pro', 'enterprise')),
  constraint organization_subscriptions_status_chk check (status in ('active', 'trialing', 'past_due', 'canceled')),
  constraint organization_subscriptions_monthly_limit_chk check (monthly_run_limit is null or monthly_run_limit >= 0),
  constraint organization_subscriptions_inflight_limit_chk check (inflight_run_limit is null or inflight_run_limit >= 0)
);

create table if not exists organization_run_usage_monthly (
  organization_id uuid not null references organizations(id) on delete cascade,
  usage_month text not null,
  run_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, usage_month),
  constraint organization_run_usage_monthly_month_chk check (usage_month ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint organization_run_usage_monthly_run_count_chk check (run_count >= 0)
);

create index if not exists organization_run_usage_monthly_org_updated_idx
  on organization_run_usage_monthly(organization_id, updated_at desc);

alter table organization_subscriptions enable row level security;
alter table organization_run_usage_monthly enable row level security;

drop policy if exists organization_subscriptions_tenant_isolation on organization_subscriptions;
create policy organization_subscriptions_tenant_isolation
on organization_subscriptions
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists organization_run_usage_monthly_tenant_isolation on organization_run_usage_monthly;
create policy organization_run_usage_monthly_tenant_isolation
on organization_run_usage_monthly
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());
