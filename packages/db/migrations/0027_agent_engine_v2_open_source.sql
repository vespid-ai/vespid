-- Normalize sessions and workflow DSL to three-engine BYON model.

alter table agent_sessions
  alter column engine_id set default 'gateway.codex.v2';

alter table agent_sessions
  alter column llm_provider set default 'openai-codex';

alter table agent_sessions
  alter column llm_model set default 'gpt-5-codex';

update agent_sessions
set engine_id = case
  when engine_id in ('gateway.codex.v2', 'gateway.claude.v2', 'gateway.opencode.v2') then engine_id
  when llm_provider in ('anthropic', 'claude') then 'gateway.claude.v2'
  when llm_provider = 'opencode' then 'gateway.opencode.v2'
  else 'gateway.codex.v2'
end;

update agent_sessions
set llm_provider = case
  when llm_provider in ('anthropic', 'opencode', 'openai-codex') then llm_provider
  when llm_provider = 'openai' then 'openai-codex'
  else 'openai-codex'
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
                (
                  coalesce(n->'config', '{}'::jsonb) - 'llm' - 'team'
                ) ||
                jsonb_build_object(
                  'engine',
                  jsonb_strip_nulls(
                    jsonb_build_object(
                      'id',
                        case coalesce(n#>>'{config,llm,provider}', '')
                          when 'anthropic' then 'gateway.claude.v2'
                          when 'claude' then 'gateway.claude.v2'
                          when 'opencode' then 'gateway.opencode.v2'
                          else 'gateway.codex.v2'
                        end,
                      'model', coalesce(n#>>'{config,llm,model}', null),
                      'auth', case
                        when coalesce(n#>>'{config,llm,auth,secretId}', '') <> ''
                          then jsonb_build_object('secretId', n#>>'{config,llm,auth,secretId}')
                        else null
                      end
                    )
                  ),
                  'execution',
                  jsonb_build_object(
                    'mode', 'gateway',
                    'selector',
                    jsonb_strip_nulls(
                      (coalesce(n#>'{config,execution,selector}', '{}'::jsonb) - 'pool')
                      || jsonb_build_object('pool', 'byon')
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
