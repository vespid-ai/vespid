-- Best-effort rollback to legacy loop-centric defaults.

alter table agent_sessions
  alter column engine_id set default 'gateway.loop.v2';

alter table agent_sessions
  alter column llm_provider set default 'openai';

alter table agent_sessions
  alter column llm_model set default 'gpt-5.3-codex';

update agent_sessions
set engine_id = 'gateway.loop.v2'
where engine_id in ('gateway.codex.v2', 'gateway.claude.v2', 'gateway.opencode.v2');

update agent_sessions
set llm_provider = case
  when llm_provider = 'openai-codex' then 'openai'
  when llm_provider in ('anthropic', 'opencode') then llm_provider
  else 'openai'
end;

update workflows w
set dsl = jsonb_set(
  w.dsl,
  '{graph,nodes}',
  (
    select coalesce(
      jsonb_agg(
        case
          when n->>'type' <> 'agent.run' then n
          else (
            n ||
            jsonb_build_object(
              'config',
              (
                (coalesce(n->'config', '{}'::jsonb) - 'engine') ||
                jsonb_build_object(
                  'llm',
                  jsonb_strip_nulls(
                    jsonb_build_object(
                      'provider',
                        case coalesce(n#>>'{config,engine,id}', '')
                          when 'gateway.claude.v2' then 'anthropic'
                          when 'gateway.opencode.v2' then 'opencode'
                          else 'openai'
                        end,
                      'model', coalesce(n#>>'{config,engine,model}', null),
                      'auth', case
                        when coalesce(n#>>'{config,engine,auth,secretId}', '') <> ''
                          then jsonb_build_object('secretId', n#>>'{config,engine,auth,secretId}', 'fallbackToEnv', true)
                        else jsonb_build_object('fallbackToEnv', true)
                      end
                    )
                  )
                )
              )
            )
          )
        end
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(
      case jsonb_typeof(coalesce(w.dsl#>'{graph,nodes}', '[]'::jsonb))
        when 'array' then coalesce(w.dsl#>'{graph,nodes}', '[]'::jsonb)
        when 'object' then (
          select coalesce(
            jsonb_agg(
              case
                when jsonb_typeof(e.value) = 'object' and not (e.value ? 'id')
                  then jsonb_set(e.value, '{id}', to_jsonb(e.key), true)
                else e.value
              end
            ),
            '[]'::jsonb
          )
          from jsonb_each(coalesce(w.dsl#>'{graph,nodes}', '{}'::jsonb)) as e(key, value)
        )
        else '[]'::jsonb
      end
    ) as n
  ),
  true
)
where w.dsl ? 'graph';
