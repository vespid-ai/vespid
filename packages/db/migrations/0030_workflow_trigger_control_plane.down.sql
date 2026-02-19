drop policy if exists workflow_trigger_subscriptions_tenant_isolation on workflow_trigger_subscriptions;

drop table if exists workflow_trigger_subscriptions;

drop index if exists workflow_runs_org_workflow_trigger_key_unique;

alter table workflow_runs
  drop column if exists trigger_source,
  drop column if exists triggered_at,
  drop column if exists trigger_key;
