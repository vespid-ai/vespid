# Toolsets (MCP + Agent Skills)

Toolsets are reusable bundles that package:
- MCP server configurations (`mcpServers[]`)
- Agent Skills bundles (`agentSkills[]`, `agentskills-v1`)

They are designed to be attached to `agent.run` nodes executed by gateway-dispatched BYON executors.

## Data Model

### Toolset
- `visibility`: `private | org | public`
- `publicSlug`: set only when published (`visibility=public`)
- `mcpServers`: array of MCP server configs
- `agentSkills`: array of Agent Skills bundles

Toolsets are tenant-scoped by `organization_id` and protected by PostgreSQL RLS.

## MCP Placeholder Policy (No Secrets Stored)

To prevent secret material from being stored in the database, MCP server `env` and `headers` values must be **placeholders only**:

- Allowed format: `${ENV:VAR_NAME}`
- Any literal secret values are rejected by the API.

At runtime on the executor machine, placeholders are resolved from the executor process environment:
- If a referenced `VAR_NAME` is missing or empty, execution fails with `MCP_ENV_NOT_SET:VAR_NAME`.

## Applying Toolsets to `agent.run`

Toolsets are applied only when:
- `agent.run.config.execution.mode = "gateway"`
- `agent.run.config.tools.execution = "executor"` (for remote tool workloads)

Resolution order:
1. `agent.run.config.toolsetId` (explicit per-node)
2. `organization.settings.toolsets.defaultToolsetId` (org default)
3. No toolset (no MCP/skills applied)

## Publishing and Adopting (Gallery)

- Toolsets can be published to the public gallery by setting a unique `publicSlug`.
- Any authenticated user can browse public toolsets via the gallery API.
- Org owners/admins can adopt a public toolset into their org, creating a new toolset copy with `adoptedFrom` metadata.

## AI Builder (Generate Toolsets)

Toolsets can optionally be generated via a multi-turn AI Builder flow.

Key properties:
- The AI Builder runs server-side in `apps/api` using org-scoped LLM secrets (`llm.anthropic` or `llm.openai`).
- MCP server `command`/`url` are selected from a curated catalog. The model does not invent MCP transport details.
- The placeholder policy still applies: MCP `env`/`headers` values are `${ENV:VAR}` placeholders only.
- Users should not paste secrets into chat. The service redacts common token patterns, but redaction is best-effort only.

Endpoints (org-scoped, `owner|admin`):
- `POST /v1/orgs/:orgId/toolsets/builder/sessions`
- `POST /v1/orgs/:orgId/toolsets/builder/sessions/:sessionId/chat`
- `POST /v1/orgs/:orgId/toolsets/builder/sessions/:sessionId/finalize`

The finalize endpoint returns a `draft` toolset payload (`mcpServers` + `agentSkills`) which can be reviewed and then saved via the normal toolset create API.

## Manual Validation (Optional)

This MVP is validated primarily via unit/integration tests. If you want to verify end-to-end behavior with a real executor:

1. Create a toolset with an external MCP server config using placeholder values (for example `env: { TOKEN: "${ENV:MY_TOKEN}" }`).
2. Ensure the referenced environment variables are set in the executor environment (`MY_TOKEN` in this example).
3. Attach the toolset to an `agent.run` node via `config.toolsetId` (or set an org default toolset).
4. Run the workflow with `execution.mode="gateway"` and `engine.id` in `{gateway.codex.v2, gateway.claude.v2, gateway.opencode.v2}`.

Expected results:
- Node execution fails fast with `MCP_ENV_NOT_SET:VAR` when a placeholder env var is missing.
- Enabled Agent Skills are staged to the run workdir under `skills/<skillId>/...`.
- Enabled MCP servers are passed through toolset context and their tools become callable as `mcp__<server>__*`.
