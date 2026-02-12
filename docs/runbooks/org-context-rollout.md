# Org Context Rollout Runbook

## Goal
Roll out strict tenant org-context enforcement safely:
- temporary observation mode: `ORG_CONTEXT_ENFORCEMENT=warn`
- steady-state production mode: `ORG_CONTEXT_ENFORCEMENT=strict`

In `warn` mode, only header issues are tolerated and surfaced as warnings. Membership checks are always enforced.

## Scope
This runbook applies to org-scoped API endpoints that require tenant context, including:
- `POST /v1/orgs/:orgId/invitations`
- `POST /v1/orgs/:orgId/members/:memberId/role`

## Structured Log Events
The API emits structured events for rollout monitoring:
- `org_context_header_fallback`
  - Fields: `reason`, `userId`, `routeOrgId`, `headerOrgId`, `requestId`, `path`, `method`
- `org_context_access_denied`
  - Fields: `userId`, `orgId`, `requestId`, `path`, `method`
- `oauth_callback_failed`
  - Fields: `provider`, `reasonCode`, `requestId`, `path`
- `invitation_accept_failed`
  - Fields: `tokenPrefix`, `reasonCode`, `userId`, `requestId`, `path`

## Rollout Steps
1. Deploy with `ORG_CONTEXT_ENFORCEMENT=warn`.
2. Observe for a minimum of 24 hours.
3. Validate warning/error rates against thresholds.
4. Switch to `ORG_CONTEXT_ENFORCEMENT=strict`.
5. Continue monitoring for another 24 hours.

## Suggested Default Thresholds
- `org_context_header_fallback` rate:
  - < 0.5% of org-scoped requests over the last 24h.
- 403 (`ORG_ACCESS_DENIED`) rate:
  - stable relative to pre-change baseline (no sustained spike > 20%).
- `oauth_callback_failed` rate:
  - no sustained increase > 10% versus baseline.
- `invitation_accept_failed` rate:
  - no sustained increase > 10% versus baseline.

If thresholds are not met, remain in `warn` mode and resolve client-side header issues first.

## Rollback
If strict mode causes an unexpected increase in failures:
1. Set `ORG_CONTEXT_ENFORCEMENT=warn`.
2. Redeploy API.
3. Confirm rollback by checking reduction in strict rejections and increased header fallback warnings.
4. Triage by route/client and fix missing or incorrect `X-Org-Id` behavior.

## Verification Checklist
- API starts with expected mode (`warn` or `strict`).
- Org-scoped requests without `X-Org-Id` in `warn` mode return `x-org-context-warning`.
- Outsider requests without membership are rejected in both modes.
- Logs include the four rollout event types above.

## Notes
- Keep `warn` windows short and controlled.
- Production steady state must remain `strict`.
