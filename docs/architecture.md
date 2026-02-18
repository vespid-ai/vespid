# Foundation Architecture

## Apps
- `apps/api`: Fastify API for auth/org/workflow/secrets/sessions
- `apps/web`: Next.js product UI
- `apps/worker`: queue worker for async workflow execution
- `apps/gateway`: execution gateway (`edge` + `brain`)
- `apps/node-agent`: BYON executor agent (CLI-first)
- `apps/engine-runner`: legacy component retained in repo history; code-agent runtime now routes through gateway + node-agent executors

## Packages
- `packages/shared`: shared domain types, auth utilities, error model
- `packages/db`: Drizzle schema + migrations + tenant RLS baseline
- `packages/workflow`: workflow DSL v2 schemas and contracts
- `packages/connectors`: connector catalog baseline
- `packages/sdk-client`: client SDK

## Security and Tenancy Baseline
- Short-lived bearer access token + HttpOnly refresh cookie model.
- Tenant APIs require `X-Org-Id` plus membership validation.
- PostgreSQL RLS enforces org boundaries for tenant-scoped tables.
- Connector secrets are encrypted at rest and never returned in plaintext after write.
- Queue runtime is Redis + BullMQ; enqueue failures fail fast with `503/QUEUE_UNAVAILABLE`.

## Workflow and Execution Baseline
- Workflow lifecycle: `draft -> published`.
- Run lifecycle: `queued -> running -> succeeded|failed`.
- Run/node events persist to `workflow_run_events` and are exposed via org-scoped read APIs.
- `agent.run` is executed via gateway dispatch to BYON executors.
- Tool bridge v1 supports `connector.action` and `agent.execute` within `agent.run` execution.

## Session Runtime Baseline
- Sessions are persisted in PostgreSQL (`agent_sessions`, `agent_session_events`) under RLS.
- Session and workflow code-agent execution supports only:
  - `gateway.codex.v2`
  - `gateway.claude.v2`
  - `gateway.opencode.v2`
- Code-agent sessions/workflows are BYON-only.

## API Surfaces
- Auth
- Organization + membership
- Workflow CRUD/publish/run/events
- Secrets management
- Agent pairing and executor registration
- Session create/list/events/messages
- Metadata endpoints (`/v1/meta/*`, `/v1/agent/engines`)

## Licensing Baseline
- Repository license: Apache-2.0
- DCO sign-off required for contributions
- Trademark rights are governed separately by trademark policy
