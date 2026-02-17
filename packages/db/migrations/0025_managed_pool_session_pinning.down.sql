drop index if exists agent_sessions_org_pinned_executor_pool_updated_idx;

alter table agent_sessions
  drop constraint if exists agent_sessions_pinned_executor_pool_check;

alter table agent_sessions
  drop column if exists pinned_executor_pool,
  drop column if exists pinned_executor_id;

alter table managed_executors
  drop column if exists region,
  drop column if exists runtime_class,
  drop column if exists drain,
  drop column if exists enabled;
