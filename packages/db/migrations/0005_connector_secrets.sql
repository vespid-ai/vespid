create table if not exists connector_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connector_id text not null,
  name text not null,
  kek_id text not null,
  dek_ciphertext bytea not null,
  dek_iv bytea not null,
  dek_tag bytea not null,
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists connector_secrets_org_connector_name_unique
  on connector_secrets(organization_id, connector_id, name);

create index if not exists connector_secrets_org_connector_idx
  on connector_secrets(organization_id, connector_id);

alter table connector_secrets enable row level security;

create policy connector_secrets_tenant_isolation_all
on connector_secrets
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

