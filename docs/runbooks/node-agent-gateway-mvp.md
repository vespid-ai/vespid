# Node-Agent + Gateway (Runtime v2) Runbook

This runbook documents the runtime v2 execution stack:
- `apps/gateway`: performs session routing and dispatches workflow/session execution to connected executors.
- `apps/node-agent`: connects to gateway over WebSocket and executes workloads (`connector.action`, `agent.execute`, `agent.run`) on pinned hosts.
- `apps/engine-runner`: isolated internal HTTP service for LLM inference used by gateway brain.

The goal is to support private-network or customer-controlled runtime execution while keeping tenancy strict and secrets safe.

For interactive sessions, gateway dispatches turns only to pinned node-hosts. Default policy is BYON-first with managed fallback and re-pin; managed-only is available via explicit selector.

## Prerequisites
- Postgres is running and `DATABASE_URL` is set.
- Redis is running and `REDIS_URL` is set.
- Secrets KEK is configured for connector secrets:
  - `SECRETS_KEK_ID`
  - `SECRETS_KEK_BASE64` (32-byte base64)

## Required Environment Variables
Gateway:
- `GATEWAY_HOST` (default `0.0.0.0`)
- `GATEWAY_PORT` (default `3002`)
- `GATEWAY_ROLE` (`edge|brain|all`, default `all`)
- `GATEWAY_LOG_LEVEL` (default `info`)
- `GATEWAY_AGENT_STALE_MS` (default `60000`; disconnects stale WS sessions)
- `GATEWAY_SERVICE_TOKEN` (required in non-test; used by worker -> gateway internal dispatch)
- `GATEWAY_HTTP_URL` (default `http://localhost:3002`)
- `GATEWAY_WS_URL` (default `ws://localhost:3002/ws/executor`)
- `GATEWAY_RESULTS_TTL_SEC` (default `900`; stores execution results for recovery across gateway restarts)
- `GATEWAY_ORG_MAX_INFLIGHT` (default per-org executor tool-call quota)
- `SESSION_MEMORY_ROOT` (optional, default `/tmp/vespid-memory`; markdown memory workspace root)

Engine runner:
- `ENGINE_RUNNER_BASE_URL` (required in production; e.g. `http://engine-runner:3003`)
- `ENGINE_RUNNER_TOKEN` (required; shared secret between gateway brain and engine-runner)
- `ENGINE_RUNNER_TIMEOUT_MS` (optional, default `30000`)

Worker:
- `NODE_EXEC_TIMEOUT_MS` (default `60000`)
- `WORKFLOW_CONTINUATION_QUEUE_NAME` (default `workflow-continuations`)
- `WORKFLOW_CONTINUATION_POLL_MS` (default `2000`; result polling interval while blocked)
- `WORKFLOW_CONTINUATION_CONCURRENCY` (default `10`)

## Pairing Flow
1. Create a pairing token (org owner/admin):
   - Web: `/agents`
   - API: `POST /v1/orgs/:orgId/agents/pairing-tokens` (requires `Authorization` and `X-Org-Id`)
2. Preferred UI-first path (recommended):
   - Open `/agents`, choose platform, copy the generated download + connect commands.
   - The connect command is auto-filled with the newly created pairing token.
3. Pair and start the agent with dev fallback command:
```bash
pnpm --filter @vespid/node-agent dev -- connect --pairing-token <token> --api-base http://localhost:3001
```

Optional: report tags for observability (capability hints only):
```bash
pnpm --filter @vespid/node-agent dev -- connect --pairing-token <token> --api-base http://localhost:3001 --tags "east,group:alpha"
```

Standalone binary examples (when release assets are available):

macOS (arm64):
```bash
curl -fsSL "https://github.com/vespid-ai/vespid/releases/latest/download/vespid-agent-darwin-arm64.tar.gz" -o "vespid-agent-darwin-arm64.tar.gz"
tar -xzf "vespid-agent-darwin-arm64.tar.gz"
chmod +x ./vespid-agent
./vespid-agent connect --pairing-token "<token>" --api-base "http://localhost:3001"
```

Linux (x64):
```bash
curl -fsSL "https://github.com/vespid-ai/vespid/releases/latest/download/vespid-agent-linux-x64.tar.gz" -o "vespid-agent-linux-x64.tar.gz"
tar -xzf "vespid-agent-linux-x64.tar.gz"
chmod +x ./vespid-agent
./vespid-agent connect --pairing-token "<token>" --api-base "http://localhost:3001"
```

Windows (x64, PowerShell):
```powershell
Invoke-WebRequest -Uri "https://github.com/vespid-ai/vespid/releases/latest/download/vespid-agent-windows-x64.zip" -OutFile "vespid-agent-windows-x64.zip"
Expand-Archive -Path "vespid-agent-windows-x64.zip" -DestinationPath . -Force
.\\vespid-agent.exe connect --pairing-token "<token>" --api-base "http://localhost:3001"
```

Notes:
- Pairing tokens are short-lived (15 minutes) and single-use.
- The agent token is returned once and stored locally in `~/.vespid/agent.json` by default.
- The `/agents` API reports `online/offline` by comparing `last_seen_at` to `GATEWAY_AGENT_STALE_MS` (clamped).
- Agent-reported tags (from the WS `hello.capabilities.tags` field) are surfaced as `reportedTags` and are not used for routing.

## Managed Pool Bootstrap (Internal)
1. Issue a managed executor token (service-to-service):
   - `POST /internal/v1/managed-executors/issue`
   - Header: `X-Service-Token: <internal service token>`
2. Start node-agent using issued credentials:
```bash
pnpm --filter @vespid/node-agent dev -- start \
  --pool managed \
  --executor-id <executorId> \
  --executor-token <executorToken> \
  --gateway-ws-url <gatewayWsUrl> \
  --api-base http://localhost:3001
```
3. Revoke on drain/retire:
   - `POST /internal/v1/managed-executors/:executorId/revoke`

## Verifying Remote Execution
1. Create a workflow containing a `connector.action` node with:
```json
{ "execution": { "mode": "executor" } }
```
2. Publish and run the workflow.
3. The worker dispatches the node asynchronously and persists a blocked run cursor until results arrive.
4. Confirm `workflow_run_events` contains `node_dispatched`, followed by `node_succeeded` (or `node_failed`) for that node.

## Verifying Interactive Session v2
1. Start gateway, one BYON node-agent, and one managed node-agent connected to `/ws/executor`.
2. Create a session:
   - `POST /v1/orgs/:orgId/sessions` with `scope`, `peer`, `channel`, `executionMode: "pinned-node-host"`.
3. Send a turn:
   - `POST /v1/orgs/:orgId/sessions/:sessionId/messages`.
4. Confirm client stream receives:
   - `session_ack`
   - `agent_delta`
   - `agent_final`
5. Disconnect the pinned BYON node-agent and send another turn:
   - Confirm the session auto failovers to managed and continues without message-chain interruption.
   - Confirm a `system` event with `action: "session_executor_failover"` is persisted/broadcast.
6. If both BYON and managed pools are unavailable, confirm deterministic failure:
   - `NO_AGENT_AVAILABLE`

Streaming notes:
- When `GATEWAY_CONTINUATION_PUSH=1` and `REDIS_URL` is configured, node-agents may stream remote execution events while a run is blocked.
- These are persisted as `workflow_run_events.event_type="remote_event"` and can be used to drive interactive UIs.
- To control payload size, set `WORKFLOW_REMOTE_EVENT_PAYLOAD_MAX_CHARS` in the worker (default `20000`).

Targeting notes:
- To target a group, set `execution.selector.group = "<name>"` and ensure the agent is configured with the control-plane tag `group:<name>`.
- To target a tag, set `execution.selector.tag = "<tag>"` and ensure the agent is configured with the control-plane tag `<tag>`.

Notes:
- Agent-reported tags are not used for routing; only control-plane tags (stored in DB) affect dispatch decisions.
- Explicit agent ID/group targeting beyond tags is intentionally deferred in the MVP.

Control-plane tags are authoritative:
1. Pair agent (above).
2. Configure tags in the control plane (owner/admin):
   - Web: `/agents`
   - API: `PUT /v1/orgs/:orgId/agents/:agentId/tags` body `{ "tags": ["west", "group:beta"] }` (with `X-Org-Id`)
3. Use DSL selectors (`execution.selector.tag` or `execution.selector.group`) to route to the intended agents.

## Agent Capabilities (MVP)
Agents declare capabilities in the WS `hello` message:
- `kinds`: `["connector.action", "agent.execute", "agent.run"]`
- `connectors`: optional list of connector IDs the agent can execute (used for `connector.action` routing)
- `tags`: optional list of tags, treated as a capability hint (`reportedTags`) for operator visibility
- `maxInFlight`: optional integer concurrency hint (default 10)

## Docker Sandbox (agent.execute)
`agent.execute` supports an optional shell task payload. When `execution.mode="node"` and the node-agent is configured for Docker, the task runs inside a hardened container.

Agent prerequisites:
- Docker is installed and the agent user can run `docker` (e.g. in the `docker` group on Linux).

Recommended env:
- `VESPID_AGENT_EXEC_BACKEND=docker`
- `VESPID_AGENT_WORKDIR_ROOT=~/.vespid/workdir`
- `VESPID_AGENT_DOCKER_IMAGE=node:24-alpine`
- `VESPID_AGENT_DOCKER_NETWORK_DEFAULT=none` (default; opt-in per node to enable network)

Limits (Strict profile defaults):
- `VESPID_AGENT_DOCKER_TIMEOUT_MS=30000`
- `VESPID_AGENT_DOCKER_MEMORY_MB=256`
- `VESPID_AGENT_DOCKER_CPUS=1`
- `VESPID_AGENT_DOCKER_PIDS=256`
- `VESPID_AGENT_DOCKER_OUTPUT_MAX_CHARS=65536`

Workdir notes:
- The agent mounts a per-run directory under `VESPID_AGENT_WORKDIR_ROOT` as `/work` (read-write).
- The container root filesystem is read-only; only `/work` and `/tmp` are writable.

LLM credential pass-through:
- The node config may include `sandbox.envPassthroughAllowlist: ["OPENAI_API_KEY"]`.
- The agent copies only allowlisted env keys from the agent process into the container environment.
- Keys are not logged by Vespid components, but task scripts can still print/exfiltrate them; treat scripts as trusted.

## Host Sandbox (agent.execute / shell.run / skills)
For environments where Docker is not available, the node-agent can execute shell tasks directly on the host.

Recommended env:
- `VESPID_AGENT_EXEC_BACKEND=host` (default)
- `VESPID_AGENT_WORKDIR_ROOT=~/.vespid/workdir`
- `VESPID_AGENT_HOST_OUTPUT_MAX_CHARS=65536`
- `VESPID_AGENT_HOST_KILL_GRACE_MS=500`

Notes:
- `networkMode: "none"` is not enforceable on the host backend. Requests with `networkMode="none"` fail with `HOST_NETWORK_MODE_UNSUPPORTED`.
- Host execution only passes a minimal environment by default, plus `envPassthroughAllowlist` keys and per-task env overrides.

## Local Skills Directory (node-agent)
Node-agents can expose local skills as tools for `agent.run` (node execution).

Env:
- `VESPID_AGENT_SKILLS_DIR=~/.vespid/skills`

Each skill directory must contain `skill.json` and may include `SKILL.md`:
- `<skillsDir>/<skillId>/skill.json`
- `<skillsDir>/<skillId>/SKILL.md` (optional)
- `<skillsDir>/<skillId>/scripts/...` (optional)

Skill tools are addressed as `skill.<skillId>` and must be explicitly allowlisted in the workflow node (`tools.allow`).

## External Engines (CLI-first)
Some engines require locally installed CLIs on the node-agent machine.

Claude Agent SDK engine:
- Engine id: `claude.agent-sdk.v1`
- Requires the Claude Code executable.
- Env:
  - `VESPID_CLAUDE_CODE_PATH=/absolute/path/to/claude` (recommended), or ensure `claude` is in `PATH`.

Codex engine:
- Engine id: `codex.sdk.v1`
- Requires the OpenAI Codex CLI.
- Env:
  - `VESPID_CODEX_PATH=/absolute/path/to/codex` (recommended), or ensure `codex` is in `PATH`.

## MCP (Future)
MCP server configuration is not enabled by default yet.

Placeholder env (no effect today):
- `VESPID_AGENT_MCP_CONFIG=/absolute/path/to/mcp.json`

## Troubleshooting
- `503 NO_AGENT_AVAILABLE`:
  - No connected agents exist for the organization.
  - Confirm the agent is running and connected to `GATEWAY_WS_URL`.
  - Confirm the gateway is running and reachable from the agent.
  - Confirm worker has `GATEWAY_HTTP_URL` + `GATEWAY_SERVICE_TOKEN` configured.

- `GATEWAY_NOT_CONFIGURED` (worker):
  - Ensure `GATEWAY_HTTP_URL` and `GATEWAY_SERVICE_TOKEN` are set in the worker environment.

- Agent cannot connect (WS closes immediately):
  - Confirm the agent token prefix contains the organization UUID: `<orgId>.<token>`.
  - Confirm the agent has not been revoked (via `/agents` or `POST /v1/orgs/:orgId/agents/:agentId/revoke`).

## Security Notes
- Secrets are decrypted in the cloud runtime and sent to node-agent in-memory only for a single request.
- Never log `secret` values. Gateway and agent handlers must treat secrets as sensitive.
- In production, run gateway behind a TLS terminator / reverse proxy (`wss://` externally).
  - `ws://` inside a trusted private network is acceptable.
- For `wss://` with a private CA (dev/prod), configure the node-agent with a custom CA bundle:
  - `VESPID_AGENT_TLS_CA_FILE=/absolute/path/to/ca.pem`
- Never expose `POST /internal/v1/dispatch` publicly.
  - Restrict by network policy and require `GATEWAY_SERVICE_TOKEN`.
