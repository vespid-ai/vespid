drop policy if exists agent_memory_sync_jobs_tenant_isolation on agent_memory_sync_jobs;
drop policy if exists agent_memory_chunks_tenant_isolation on agent_memory_chunks;
drop policy if exists agent_memory_documents_tenant_isolation on agent_memory_documents;
drop policy if exists agent_reset_policies_tenant_isolation on agent_reset_policies;
drop policy if exists agent_bindings_tenant_isolation on agent_bindings;

drop table if exists agent_memory_sync_jobs;
drop table if exists agent_memory_chunks;
drop table if exists agent_memory_documents;

drop index if exists agent_session_events_org_session_idempotency_unique;
alter table if exists agent_session_events
  drop column if exists idempotency_key,
  drop column if exists handoff_to_agent_id,
  drop column if exists handoff_from_agent_id;

alter table if exists agent_sessions
  drop column if exists reset_policy_snapshot,
  drop column if exists binding_id,
  drop column if exists routed_agent_id,
  drop column if exists scope,
  drop column if exists session_key;

drop index if exists agent_sessions_org_session_key_unique;

drop table if exists agent_reset_policies;
drop table if exists agent_bindings;
