alter table organizations
  add column if not exists settings jsonb not null default '{}'::jsonb;

