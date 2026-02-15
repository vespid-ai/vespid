# Toolsets (MCP + Agent Skills)

Toolsets are reusable bundles that package:
- MCP server configurations (`mcpServers[]`)
- Anthropic Agent Skills bundles (`agentSkills[]`, `agentskills-v1`)

They are designed to be attached to `agent.run` nodes when executing on a node-agent using the Claude Agent SDK engine (`engine.id="claude.agent-sdk.v1"`).

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

At runtime on the node-agent machine, placeholders are resolved from the node-agent process environment:
- If a referenced `VAR_NAME` is missing or empty, execution fails with `MCP_ENV_NOT_SET:VAR_NAME`.

## Applying Toolsets to `agent.run`

Toolsets are applied only when:
- `agent.run.config.execution.mode = "node"`
- `agent.run.config.engine.id = "claude.agent-sdk.v1"`

Resolution order:
1. `agent.run.config.toolsetId` (explicit per-node)
2. `organization.settings.toolsets.defaultToolsetId` (org default)
3. No toolset (no MCP/skills applied)

## Publishing and Adopting (Gallery)

- Toolsets can be published to the public gallery by setting a unique `publicSlug`.
- Any authenticated user can browse public toolsets via the gallery API.
- Org owners/admins can adopt a public toolset into their org, creating a new toolset copy with `adoptedFrom` metadata.

## Manual Validation (Optional)

This MVP is validated primarily via unit/integration tests. If you want to verify end-to-end behavior with a real node-agent and Claude Code:

1. Create a toolset with an external MCP server config using placeholder values (for example `env: { TOKEN: "${ENV:MY_TOKEN}" }`).
2. Ensure the referenced environment variables are set in the node-agent environment (`MY_TOKEN` in this example).
3. Attach the toolset to an `agent.run` node via `config.toolsetId` (or set an org default toolset).
4. Run the workflow with `execution.mode="node"` and `engine.id="claude.agent-sdk.v1"`.

Expected results:
- Node execution fails fast with `MCP_ENV_NOT_SET:VAR` when a placeholder env var is missing.
- Enabled Agent Skills are staged to the run workdir under `.claude/skills/<skillId>/...`.
- Enabled MCP servers are passed to the Claude Agent SDK under `mcpServers` and their tools become callable as `mcp__<server>__*`.

### Claude Agent SDK E2E (Opt-in)

The engine adapter includes an opt-in e2e test that validates the local Claude Agent SDK + Claude Code wiring without impacting CI.

Run:
```bash
VESPID_CLAUDE_E2E=1 \
VESPID_CLAUDE_CODE_PATH=/path/to/claude \
ANTHROPIC_API_KEY=... \
pnpm -C packages/engine-claude-agent-sdk test
```

Notes:
- This test is skipped unless `VESPID_CLAUDE_E2E` is set.
- It registers an SDK MCP server and checks that `mcpServerStatus()` includes it.
