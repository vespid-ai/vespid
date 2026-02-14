# Node-Agent + Gateway (MVP) Runbook

This runbook documents the MVP remote execution stack:
- `apps/gateway`: routes execution requests to connected node-agents.
- `apps/node-agent`: connects to gateway over WebSocket and executes `connector.action` and `agent.execute` nodes.

The goal is to support private-network or customer-controlled runtime execution while keeping tenancy strict and secrets safe.

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
- `GATEWAY_LOG_LEVEL` (default `info`)
- `GATEWAY_AGENT_STALE_MS` (default `60000`; disconnects stale WS sessions)
- `GATEWAY_AGENT_SELECTION` (default `least_in_flight_lru`; optional `round_robin`)
- `GATEWAY_SERVICE_TOKEN` (required in non-test; used by worker -> gateway internal dispatch)
- `GATEWAY_HTTP_URL` (default `http://localhost:3002`)
- `GATEWAY_WS_URL` (default `ws://localhost:3002/ws`)
- `GATEWAY_RESULTS_TTL_SEC` (default `900`; stores execution results for recovery across gateway restarts)

Worker:
- `NODE_EXEC_TIMEOUT_MS` (default `60000`)
- `WORKFLOW_CONTINUATION_QUEUE_NAME` (default `workflow-continuations`)
- `WORKFLOW_CONTINUATION_POLL_MS` (default `2000`; result polling interval while blocked)
- `WORKFLOW_CONTINUATION_CONCURRENCY` (default `10`)

## Pairing Flow
1. Create a pairing token (org owner/admin):
   - Web: `/agents`
   - API: `POST /v1/orgs/:orgId/agents/pairing-tokens` (requires `Authorization` and `X-Org-Id`)
2. Pair and start the agent:
```bash
pnpm --filter @vespid/node-agent dev -- connect --pairing-token <token> --api-base http://localhost:3001
```

Optional: publish tags for targeted dispatch:
```bash
pnpm --filter @vespid/node-agent dev -- connect --pairing-token <token> --api-base http://localhost:3001 --tags "east,group:alpha"
```

Notes:
- Pairing tokens are short-lived (15 minutes) and single-use.
- The agent token is returned once and stored locally in `~/.vespid/agent.json` by default.
- The `/agents` API reports `online/offline` by comparing `last_seen_at` to `GATEWAY_AGENT_STALE_MS` (clamped).

## Verifying Remote Execution
1. Create a workflow containing a `connector.action` node with:
```json
{ "execution": { "mode": "node" } }
```
2. Publish and run the workflow.
3. The worker dispatches the node asynchronously and persists a blocked run cursor until results arrive.
4. Confirm `workflow_run_events` contains `node_dispatched`, followed by `node_succeeded` (or `node_failed`) for that node.

Targeting notes:
- To target a specific agent, set `execution.selector.agentId = "<uuid>"` (agent IDs are visible via `GET /v1/orgs/:orgId/agents`).
- To target a group, set `execution.selector.group = "<name>"` and ensure matching agents publish tag `group:<name>`.

## Agent Capabilities (MVP)
Agents declare capabilities in the WS `hello` message:
- `kinds`: `["connector.action", "agent.execute"]`
- `connectors`: optional list of connector IDs the agent can execute (used for `connector.action` routing)
- `tags`: optional list of tags (used for targeted dispatch)
  - DSL: `execution.selector.tag = "<tag>"`
  - DSL: `execution.selector.group = "<name>"` maps to agent tag `group:<name>`
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
