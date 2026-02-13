alter table workflow_runs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz;

alter table workflow_runs
  add constraint workflow_runs_attempt_count_non_negative
  check (attempt_count >= 0);

alter table workflow_runs
  add constraint workflow_runs_max_attempts_positive
  check (max_attempts >= 1);

create index if not exists workflow_runs_next_attempt_at_idx
  on workflow_runs(next_attempt_at)
  where status = 'queued';
