alter table managed_executors
  add column if not exists enabled boolean not null default true,
  add column if not exists drain boolean not null default false,
  add column if not exists runtime_class text not null default 'container',
  add column if not exists region text null;

alter table agent_sessions
  add column if not exists pinned_executor_id uuid null,
  add column if not exists pinned_executor_pool text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_sessions_pinned_executor_pool_check'
      and conrelid = 'agent_sessions'::regclass
  ) then
    alter table agent_sessions
      add constraint agent_sessions_pinned_executor_pool_check
      check (pinned_executor_pool in ('byon', 'managed'));
  end if;
end
$$;

create index if not exists agent_sessions_org_pinned_executor_pool_updated_idx
  on agent_sessions (organization_id, pinned_executor_pool, updated_at desc);
