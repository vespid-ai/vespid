create table if not exists managed_executors (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  labels text[] not null default '{}'::text[],
  capabilities jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists managed_executors_created_at_idx
  on managed_executors(created_at desc, id desc);

create index if not exists managed_executors_labels_gin_idx
  on managed_executors using gin (labels);

