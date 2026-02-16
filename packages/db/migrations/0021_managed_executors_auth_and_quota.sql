alter table managed_executors
  add column if not exists token_hash text null,
  add column if not exists revoked_at timestamptz null,
  add column if not exists last_seen_at timestamptz null,
  add column if not exists max_in_flight integer not null default 50;

create unique index if not exists managed_executors_token_hash_unique
  on managed_executors(token_hash)
  where token_hash is not null;

create index if not exists managed_executors_revoked_seen_idx
  on managed_executors(revoked_at, last_seen_at desc, id desc);

