# Foundation Architecture

## Apps
- `apps/api`: Fastify API for auth/org/rbac foundation endpoints.
- `apps/web`: Next.js bootstrap UI for auth and org onboarding.
- `apps/worker`: runtime placeholder to host workflow workers.
- `apps/node-agent`: CLI bootstrap for future node execution.

## Packages
- `packages/shared`: shared domain types, auth token utilities, error model.
- `packages/db`: Drizzle schema, SQL migrations, tenant RLS baseline.
- `packages/workflow`: workflow DSL v2 schema baseline.
- `packages/connectors`: connector catalog baseline.

## Security Baseline
- Auth uses short-lived bearer access tokens plus HttpOnly refresh cookie sessions.
- Session state is persisted in PostgreSQL (`auth_sessions`) and supports revoke/revoke-all.
- OAuth uses real authorization code flow with PKCE/state (`google`, `github`) and nonce validation.
- Tenant APIs require `X-Org-Id` and membership verification before org-scoped mutations.
- PostgreSQL RLS is strict: tenant-scoped tables require a valid `app.current_org_id` context.
- Rollout support: `ORG_CONTEXT_ENFORCEMENT=warn|strict` controls header fallback behavior; membership checks remain enforced in both modes.
- Rollout observability uses structured events: `org_context_header_fallback`, `org_context_access_denied`, `oauth_callback_failed`, `invitation_accept_failed`.
- Workflow runtime baseline: manual trigger execution path is available through API-managed runs (`queued -> running -> succeeded/failed`).
- See `/docs/runbooks/org-context-rollout.md` for rollout/rollback operations.

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
  - `GET /v1/orgs/:orgId/workflows/:workflowId/runs/:runId` (`X-Org-Id` required)
