alter table agent_sessions
  alter column engine_id set default 'gateway.loop.v2';

update agent_sessions
set engine_id = 'gateway.loop.v2'
where engine_id = 'vespid.loop.v1';

update agent_sessions
set engine_id = 'gateway.codex.v2'
where engine_id = 'codex.sdk.v1';

update agent_sessions
set engine_id = 'gateway.claude.v2'
where engine_id = 'claude.agent-sdk.v1';

