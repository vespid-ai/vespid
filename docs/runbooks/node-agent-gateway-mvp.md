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
- `GATEWAY_SERVICE_TOKEN` (required in non-test; used by worker -> gateway internal dispatch)
- `GATEWAY_HTTP_URL` (default `http://localhost:3002`)
- `GATEWAY_WS_URL` (default `ws://localhost:3002/ws`)

Worker:
- `NODE_EXEC_TIMEOUT_MS` (default `60000`)

## Pairing Flow
1. Create a pairing token (org owner/admin):
   - Web: `/agents`
   - API: `POST /v1/orgs/:orgId/agents/pairing-tokens` (requires `Authorization` and `X-Org-Id`)
2. Pair and start the agent:
```bash
pnpm --filter @vespid/node-agent dev -- connect --pairing-token <token> --api-base http://localhost:3001
```

Notes:
- Pairing tokens are short-lived (15 minutes) and single-use.
- The agent token is returned once and stored locally in `~/.vespid/agent.json` by default.

## Verifying Remote Execution
1. Create a workflow containing a `connector.action` node with:
```json
{ "execution": { "mode": "node" } }
```
2. Publish and run the workflow.
3. Confirm `workflow_run_events` contains `node_started/node_succeeded` for that node.

## Troubleshooting
- `503 NO_AGENT_AVAILABLE`:
  - No connected agents exist for the organization.
  - Confirm the agent is running and connected to `GATEWAY_WS_URL`.
  - Confirm the gateway is running and reachable from the agent.

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
- Never expose `POST /internal/v1/dispatch` publicly.
  - Restrict by network policy and require `GATEWAY_SERVICE_TOKEN`.
