create index if not exists agent_sessions_org_status_updated_idx
  on agent_sessions(organization_id, status, updated_at desc, id desc);
