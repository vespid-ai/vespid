create table if not exists organization_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  token_hash text not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  capabilities jsonb,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists organization_agents_token_hash_unique
  on organization_agents(token_hash);

create index if not exists organization_agents_org_created_at_idx
  on organization_agents(organization_id, created_at);

alter table organization_agents enable row level security;

create policy organization_agents_tenant_isolation_all
on organization_agents
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

create table if not exists agent_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_pairing_tokens_token_hash_unique
  on agent_pairing_tokens(token_hash);

create index if not exists agent_pairing_tokens_org_created_at_idx
  on agent_pairing_tokens(organization_id, created_at);

alter table agent_pairing_tokens enable row level security;

create policy agent_pairing_tokens_tenant_isolation_all
on agent_pairing_tokens
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

