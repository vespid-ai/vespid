alter table if exists agent_sessions
  add column if not exists llm_secret_id uuid references connector_secrets(id) on delete set null;
