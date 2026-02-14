-- Adds persisted workflow run cursor/blocking fields to support async remote execution
-- (gateway + node-agent) without blocking worker threads.

alter table workflow_runs
  add column if not exists cursor_node_index integer not null default 0,
  add column if not exists blocked_request_id text,
  add column if not exists blocked_node_id text,
  add column if not exists blocked_node_type text,
  add column if not exists blocked_kind text,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_timeout_at timestamptz;

create index if not exists workflow_runs_org_status_blocked_idx
  on workflow_runs(organization_id, status, blocked_request_id);

