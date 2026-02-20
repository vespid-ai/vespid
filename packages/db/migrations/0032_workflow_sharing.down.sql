drop policy if exists workflow_run_events_delete_policy on workflow_run_events;
drop policy if exists workflow_run_events_update_policy on workflow_run_events;
drop policy if exists workflow_run_events_insert_policy on workflow_run_events;
drop policy if exists workflow_run_events_select_policy on workflow_run_events;

drop policy if exists workflow_runs_delete_policy on workflow_runs;
drop policy if exists workflow_runs_update_policy on workflow_runs;
drop policy if exists workflow_runs_insert_policy on workflow_runs;
drop policy if exists workflow_runs_select_policy on workflow_runs;

drop policy if exists workflows_delete_policy on workflows;
drop policy if exists workflows_update_policy on workflows;
drop policy if exists workflows_insert_policy on workflows;
drop policy if exists workflows_select_policy on workflows;

drop policy if exists workflow_shares_delete_policy on workflow_shares;
drop policy if exists workflow_shares_update_policy on workflow_shares;
drop policy if exists workflow_shares_insert_policy on workflow_shares;
drop policy if exists workflow_shares_select_policy on workflow_shares;

drop policy if exists workflow_share_invitations_delete_policy on workflow_share_invitations;
drop policy if exists workflow_share_invitations_update_policy on workflow_share_invitations;
drop policy if exists workflow_share_invitations_insert_policy on workflow_share_invitations;
drop policy if exists workflow_share_invitations_select_policy on workflow_share_invitations;

drop table if exists workflow_shares;
drop table if exists workflow_share_invitations;

create policy workflows_tenant_isolation_all
on workflows
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

create policy workflow_runs_tenant_isolation_all
on workflow_runs
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());

create policy workflow_run_events_tenant_isolation_all
on workflow_run_events
for all
using (organization_id = app.current_org_uuid())
with check (organization_id = app.current_org_uuid());
