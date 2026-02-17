create table if not exists platform_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role_key text not null,
  granted_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists platform_user_roles_user_role_unique on platform_user_roles(user_id, role_key);
create index if not exists platform_user_roles_role_created_at_idx on platform_user_roles(role_key, created_at);

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

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
create index if not exists user_payment_events_payer_created_at_idx on user_payment_events(payer_user_id, created_at);
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

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references users(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  category text not null default 'general',
  priority text not null default 'normal',
  status text not null default 'open',
  subject text not null,
  content text not null,
  assignee_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_priority_updated_at_idx
  on support_tickets(status, priority, updated_at);
create index if not exists support_tickets_requester_created_at_idx
  on support_tickets(requester_user_id, created_at);

create table if not exists support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_events_ticket_created_at_idx
  on support_ticket_events(ticket_id, created_at);

create table if not exists platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_at_idx on platform_audit_logs(created_at);
create index if not exists platform_audit_logs_action_created_at_idx on platform_audit_logs(action, created_at);

insert into platform_settings(key, value)
values
  ('org_policy', '{"free":{"canManageOrg":false,"maxOrgs":1},"paid":{"canManageOrg":true,"maxOrgs":5},"enterprise":{"canManageOrg":true,"maxOrgs":null}}'::jsonb),
  ('payments.providers', '{"enabled":["stripe"]}'::jsonb),
  ('risk.policies', '{"allowSignup":true,"rateLimitMode":"default"}'::jsonb),
  ('risk.incidents', '{"items":[]}'::jsonb),
  ('observability.logs', '{"items":[]}'::jsonb),
  ('observability.metrics', '{"items":[]}'::jsonb)
on conflict (key) do nothing;

with multi_org_users as (
  select m.user_id
  from memberships m
  group by m.user_id
  having count(distinct m.organization_id) > 1
)
insert into user_entitlements(user_id, tier, source_provider, source_event_id, valid_from, valid_until, active)
select u.user_id, 'paid', 'migration', 'grandfathered_multi_org', now(), null, true
from multi_org_users u
where not exists (
  select 1
  from user_entitlements e
  where e.user_id = u.user_id
    and e.active = true
    and e.tier = 'paid'
);
