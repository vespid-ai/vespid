drop index if exists managed_executors_revoked_seen_idx;

drop index if exists managed_executors_token_hash_unique;

alter table managed_executors
  drop column if exists max_in_flight,
  drop column if exists last_seen_at,
  drop column if exists revoked_at,
  drop column if exists token_hash;
