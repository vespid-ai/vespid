alter table organization_agents
  add column if not exists tags text[] not null default '{}'::text[];

-- Optional index to support future server-side filtering (not used in gateway selection today).
create index if not exists organization_agents_tags_gin_idx
  on organization_agents using gin (tags);

