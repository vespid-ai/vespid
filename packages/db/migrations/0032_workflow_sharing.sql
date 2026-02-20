create table if not exists workflow_share_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  email text not null,
  access_role text not null default 'runner',
  token text not null unique,
  status text not null default 'pending',
  invited_by_user_id uuid not null references users(id) on delete restrict,
  accepted_by_user_id uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workflow_share_invitations_access_role_check check (access_role in ('runner')),
  constraint workflow_share_invitations_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create index if not exists workflow_share_invitations_org_workflow_idx
  on workflow_share_invitations(organization_id, workflow_id, created_at desc);
create index if not exists workflow_share_invitations_token_idx
  on workflow_share_invitations(token);
create unique index if not exists workflow_share_invitations_workflow_email_pending_unique
  on workflow_share_invitations(workflow_id, lower(email))
  where status = 'pending';

create table if not exists workflow_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  access_role text not null default 'runner',
  source_invitation_id uuid references workflow_share_invitations(id) on delete set null,
  created_by_user_id uuid not null references users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_shares_access_role_check check (access_role in ('runner'))
);

create index if not exists workflow_shares_org_workflow_idx
  on workflow_shares(organization_id, workflow_id, created_at desc);
create index if not exists workflow_shares_user_idx
  on workflow_shares(user_id, created_at desc);
create unique index if not exists workflow_shares_active_workflow_user_unique
  on workflow_shares(workflow_id, user_id)
  where revoked_at is null;

alter table workflow_share_invitations enable row level security;
alter table workflow_shares enable row level security;

drop policy if exists workflow_share_invitations_select_policy on workflow_share_invitations;
create policy workflow_share_invitations_select_policy
on workflow_share_invitations
for select
using (organization_id = app.current_org_uuid());

drop policy if exists workflow_share_invitations_insert_policy on workflow_share_invitations;
create policy workflow_share_invitations_insert_policy
on workflow_share_invitations
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_share_invitations_update_policy on workflow_share_invitations;
create policy workflow_share_invitations_update_policy
on workflow_share_invitations
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_share_invitations_delete_policy on workflow_share_invitations;
create policy workflow_share_invitations_delete_policy
on workflow_share_invitations
for delete
using (organization_id = app.current_org_uuid());

drop policy if exists workflow_shares_select_policy on workflow_shares;
create policy workflow_shares_select_policy
on workflow_shares
for select
using (
  organization_id = app.current_org_uuid()
  or user_id = app.current_user_uuid()
);

drop policy if exists workflow_shares_insert_policy on workflow_shares;
create policy workflow_shares_insert_policy
on workflow_shares
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_shares_update_policy on workflow_shares;
create policy workflow_shares_update_policy
on workflow_shares
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_shares_delete_policy on workflow_shares;
create policy workflow_shares_delete_policy
on workflow_shares
for delete
using (organization_id = app.current_org_uuid());

drop policy if exists workflows_tenant_isolation_all on workflows;

drop policy if exists workflows_select_policy on workflows;
create policy workflows_select_policy
on workflows
for select
using (
  organization_id = app.current_org_uuid()
  or exists (
    select 1
    from workflow_shares ws
    where ws.organization_id = workflows.organization_id
      and ws.workflow_id = workflows.id
      and ws.user_id = app.current_user_uuid()
      and ws.revoked_at is null
  )
);

drop policy if exists workflows_insert_policy on workflows;
create policy workflows_insert_policy
on workflows
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists workflows_update_policy on workflows;
create policy workflows_update_policy
on workflows
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists workflows_delete_policy on workflows;
create policy workflows_delete_policy
on workflows
for delete
using (organization_id = app.current_org_uuid());

drop policy if exists workflow_runs_tenant_isolation_all on workflow_runs;

drop policy if exists workflow_runs_select_policy on workflow_runs;
create policy workflow_runs_select_policy
on workflow_runs
for select
using (
  organization_id = app.current_org_uuid()
  or (
    requested_by_user_id = app.current_user_uuid()
    and exists (
      select 1
      from workflow_shares ws
      where ws.organization_id = workflow_runs.organization_id
        and ws.workflow_id = workflow_runs.workflow_id
        and ws.user_id = app.current_user_uuid()
        and ws.revoked_at is null
    )
  )
);

drop policy if exists workflow_runs_insert_policy on workflow_runs;
create policy workflow_runs_insert_policy
on workflow_runs
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_runs_update_policy on workflow_runs;
create policy workflow_runs_update_policy
on workflow_runs
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_runs_delete_policy on workflow_runs;
create policy workflow_runs_delete_policy
on workflow_runs
for delete
using (organization_id = app.current_org_uuid());

drop policy if exists workflow_run_events_tenant_isolation_all on workflow_run_events;

drop policy if exists workflow_run_events_select_policy on workflow_run_events;
create policy workflow_run_events_select_policy
on workflow_run_events
for select
using (
  organization_id = app.current_org_uuid()
  or exists (
    select 1
    from workflow_runs wr
    join workflow_shares ws
      on ws.organization_id = wr.organization_id
     and ws.workflow_id = wr.workflow_id
     and ws.user_id = app.current_user_uuid()
     and ws.revoked_at is null
    where wr.organization_id = workflow_run_events.organization_id
      and wr.workflow_id = workflow_run_events.workflow_id
      and wr.id = workflow_run_events.run_id
      and wr.requested_by_user_id = app.current_user_uuid()
  )
);

drop policy if exists workflow_run_events_insert_policy on workflow_run_events;
create policy workflow_run_events_insert_policy
on workflow_run_events
for insert
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_run_events_update_policy on workflow_run_events;
create policy workflow_run_events_update_policy
on workflow_run_events
for update
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

drop policy if exists workflow_run_events_delete_policy on workflow_run_events;
create policy workflow_run_events_delete_policy
on workflow_run_events
for delete
using (organization_id = app.current_org_uuid());
