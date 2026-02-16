# Foundation Architecture

## Apps
- `apps/api`: Fastify API for auth/org/rbac foundation endpoints.
- `apps/web`: Next.js bootstrap UI for auth and org onboarding.
- `apps/worker`: queue worker for async workflow run execution with retry/backoff.
- `apps/gateway`: split execution gateway (`edge` + `brain`) for executor remote tool execution.
- `apps/node-agent`: CLI executor agent that connects to gateway.
- `apps/engine-runner`: isolated LLM inference service used by gateway brain.
- `apps/api`: supports optional enterprise provider injection (`VESPID_ENTERPRISE_PROVIDER_MODULE`) with community fallback.

## Packages
- `packages/shared`: shared domain types, auth token utilities, error model.
- `packages/db`: Drizzle schema, SQL migrations, tenant RLS baseline.
- `packages/workflow`: workflow DSL v2 schema baseline.
- `packages/connectors`: connector catalog baseline.
- `packages/sdk-client`: Apache-licensed client SDK for ecosystem integrations.

## Security Baseline
- Auth uses short-lived bearer access tokens plus HttpOnly refresh cookie sessions.
- Session state is persisted in PostgreSQL (`auth_sessions`) and supports revoke/revoke-all.
- OAuth uses real authorization code flow with PKCE/state (`google`, `github`) and nonce validation.
- Tenant APIs require `X-Org-Id` and membership verification before org-scoped mutations.
- PostgreSQL RLS is strict: tenant-scoped tables require a valid `app.current_org_id` context.
- Rollout support: `ORG_CONTEXT_ENFORCEMENT=warn|strict` controls header fallback behavior; membership checks remain enforced in both modes.
- Rollout observability uses structured events: `org_context_header_fallback`, `org_context_access_denied`, `oauth_callback_failed`, `invitation_accept_failed`.
- Workflow runtime baseline: API enqueues runs (`queued`) and `apps/worker` consumes runs asynchronously (`queued -> running -> succeeded/failed`) with retry backoff.
- Queue runtime is Redis + BullMQ only (single stack). If Redis is unavailable, run creation fails fast with `503/QUEUE_UNAVAILABLE`; API rolls back the fresh queued run.
- Queue observability uses structured events: `workflow_run_enqueued`, `workflow_run_started`, `workflow_run_retried`, `workflow_run_succeeded`, `workflow_run_failed`, `queue_unavailable`.
- Workflow run/node execution events are persisted in PostgreSQL (`workflow_run_events`) with strict tenant RLS.
  - Event payloads are capped via `WORKFLOW_EVENT_PAYLOAD_MAX_CHARS` to avoid oversized rows.
- Connector secrets are encrypted at rest and scoped per organization (`connector_secrets`).
  - Encryption uses an environment-provided KEK (`SECRETS_KEK_ID`, `SECRETS_KEK_BASE64`).
- Remote execution (MVP):
  - Workflows may set `execution.mode="executor"` for `agent.execute` and `connector.action`.
  - `apps/worker` dispatches work to `apps/gateway` asynchronously and persists a blocked cursor in `workflow_runs`:
    - `blocked_request_id` (deterministic request id)
    - `cursor_node_index` (next node position)
  - A continuation worker polls gateway results and resumes run execution without blocking worker threads.
  - Gateway dispatch is protected by `GATEWAY_SERVICE_TOKEN`; agent auth uses long-lived agent tokens stored hashed.
  - Pairing uses short-lived, single-use pairing tokens stored hashed.
  - Production deployment: terminate TLS in front of gateway (reverse proxy / cloud LB) and keep `/internal/v1/dispatch` private.
- Node-agent sandbox backends:
  - Community edition supports a Docker backend for `agent.execute` shell tasks (hardened container, strict limits).
  - A provider backend hook is reserved for enterprise to integrate fast-start sandboxes (e.g. e2b.dev-style), loaded dynamically at runtime.
- Session connectivity (gateway brain, MVP):
  - Interactive sessions are stored in PostgreSQL (`agent_sessions`, `agent_session_events`) and are tenant-scoped under RLS.
  - Control clients connect to the gateway (WS) to stream session events and send messages.
  - Session brains run in gateway; tool calls route to managed/BYON executors via selector and quota policy.
  - LLM inference is delegated to `apps/engine-runner`; provider credentials are never sent to shell tools.
- Open Core boundary baseline: community runtime is independently runnable; enterprise capability is loaded via typed provider interfaces.
- See `/docs/runbooks/org-context-rollout.md` for rollout/rollback operations.
- See `/docs/runbooks/workflow-queue-cutover.md` for workflow queue cutover/rollback operations.
- See `/docs/runbooks/secrets-key-rotation.md` for KEK configuration and secret rotation guidance.
- See `/docs/runbooks/node-agent-gateway-mvp.md` for node-agent + gateway remote execution operations.

## Foundation APIs
- Auth:
  - `POST /v1/auth/signup`
  - `POST /v1/auth/login`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `POST /v1/auth/logout-all`
  - `GET /v1/auth/oauth/:provider/start`
  - `GET /v1/auth/oauth/:provider/callback`
- Organization:
  - `POST /v1/orgs`
  - `POST /v1/orgs/:orgId/invitations` (`X-Org-Id` required)
  - `POST /v1/orgs/:orgId/members/:memberId/role` (`X-Org-Id` required)
  - `POST /v1/invitations/:token/accept`
- Workflow:
  - `POST /v1/orgs/:orgId/workflows` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/workflows/:workflowId` (`X-Org-Id` required)
  - `POST /v1/orgs/:orgId/workflows/:workflowId/publish` (`X-Org-Id` required)
  - `POST /v1/orgs/:orgId/workflows/:workflowId/runs` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/workflows/:workflowId/runs` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/workflows/:workflowId/runs/:runId` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/workflows/:workflowId/runs/:runId/events` (`X-Org-Id` required)
- Secrets:
  - `GET /v1/orgs/:orgId/secrets` (`X-Org-Id` required, owner/admin only)
  - `POST /v1/orgs/:orgId/secrets` (`X-Org-Id` required, owner/admin only)
  - `PUT /v1/orgs/:orgId/secrets/:secretId` (`X-Org-Id` required, owner/admin only)
  - `DELETE /v1/orgs/:orgId/secrets/:secretId` (`X-Org-Id` required, owner/admin only)
- Agents:
  - `GET /v1/orgs/:orgId/agents` (`X-Org-Id` required, owner/admin only)
  - `POST /v1/orgs/:orgId/agents/pairing-tokens` (`X-Org-Id` required, owner/admin only)
  - `POST /v1/orgs/:orgId/agents/:agentId/revoke` (`X-Org-Id` required, owner/admin only)
  - `POST /v1/agents/pair` (pairing token only)
- Sessions:
  - `POST /v1/orgs/:orgId/sessions` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/sessions` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/sessions/:sessionId` (`X-Org-Id` required)
  - `GET /v1/orgs/:orgId/sessions/:sessionId/events` (`X-Org-Id` required)
- Metadata:
  - `GET /v1/meta/capabilities`
  - `GET /v1/meta/connectors`

## Licensing Baseline
- Community core: `AGPL-3.0-only`
- SDK/client (`packages/sdk-*`): `Apache-2.0`
- Enterprise modules: commercial proprietary terms
- Public mirror publishing is gated by `.oss-allowlist` and CI dry-run checks.
