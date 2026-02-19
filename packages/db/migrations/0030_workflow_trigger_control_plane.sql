alter table workflow_runs
  add column if not exists trigger_key text,
  add column if not exists triggered_at timestamptz,
  add column if not exists trigger_source text;

create unique index if not exists workflow_runs_org_workflow_trigger_key_unique
  on workflow_runs(organization_id, workflow_id, trigger_key);

create table if not exists workflow_trigger_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  workflow_revision integer not null,
  trigger_type text not null,
  enabled boolean not null default true,
  cron_expr text,
  heartbeat_interval_sec integer,
  heartbeat_jitter_sec integer,
  heartbeat_max_skew_sec integer,
  webhook_token_hash text,
  next_fire_at timestamptz,
  last_triggered_at timestamptz,
  last_trigger_key text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_trigger_subscriptions_trigger_type_chk
    check (trigger_type in ('cron', 'webhook', 'heartbeat')),
  constraint workflow_trigger_subscriptions_cron_shape_chk
    check (
      (trigger_type = 'cron' and cron_expr is not null and heartbeat_interval_sec is null and webhook_token_hash is null)
      or
      (trigger_type = 'heartbeat' and cron_expr is null and heartbeat_interval_sec is not null and webhook_token_hash is null)
      or
      (trigger_type = 'webhook' and cron_expr is null and heartbeat_interval_sec is null and webhook_token_hash is not null)
    ),
  constraint workflow_trigger_subscriptions_heartbeat_non_negative_chk
    check (
      heartbeat_interval_sec is null or (heartbeat_interval_sec >= 5 and heartbeat_interval_sec <= 86400)
    ),
  constraint workflow_trigger_subscriptions_heartbeat_jitter_non_negative_chk
    check (
      heartbeat_jitter_sec is null or (heartbeat_jitter_sec >= 0 and heartbeat_jitter_sec <= 3600)
    ),
  constraint workflow_trigger_subscriptions_heartbeat_skew_non_negative_chk
    check (
      heartbeat_max_skew_sec is null or (heartbeat_max_skew_sec >= 0 and heartbeat_max_skew_sec <= 3600)
    )
);

create unique index if not exists workflow_trigger_subscriptions_org_workflow_type_unique
  on workflow_trigger_subscriptions(organization_id, workflow_id, trigger_type);

create unique index if not exists workflow_trigger_subscriptions_webhook_token_hash_unique
  on workflow_trigger_subscriptions(webhook_token_hash);

create index if not exists workflow_trigger_subscriptions_ready_idx
  on workflow_trigger_subscriptions(enabled, next_fire_at, id);

create index if not exists workflow_trigger_subscriptions_org_updated_idx
  on workflow_trigger_subscriptions(organization_id, updated_at desc, id desc);

alter table workflow_trigger_subscriptions enable row level security;

drop policy if exists workflow_trigger_subscriptions_tenant_isolation on workflow_trigger_subscriptions;
create policy workflow_trigger_subscriptions_tenant_isolation on workflow_trigger_subscriptions
  using (organization_id = app.current_org_uuid())
  with check (organization_id = app.current_org_uuid());
