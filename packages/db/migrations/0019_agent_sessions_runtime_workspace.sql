alter table agent_sessions
  add column if not exists runtime jsonb not null default '{}'::jsonb;

alter table agent_sessions
  add column if not exists workspace_id uuid null references execution_workspaces(id) on delete set null;

alter table agent_sessions
  add column if not exists executor_selector jsonb null;

