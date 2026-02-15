create table if not exists organization_billing_accounts (
  organization_id uuid primary key references organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table organization_billing_accounts enable row level security;

drop policy if exists organization_billing_accounts_tenant_isolation_all on organization_billing_accounts;
create policy organization_billing_accounts_tenant_isolation_all
on organization_billing_accounts
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

