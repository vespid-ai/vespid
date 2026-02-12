# Vespid

Vespid is a greenfield, international, multi-tenant SaaS automation platform.

## Foundation Scope (Current)
- Monorepo baseline (`apps/*`, `packages/*`, `tests`)
- Auth + organization + RBAC baseline APIs (cookie + bearer sessions)
- Real Google/GitHub OAuth authorization code flow
- Drizzle schema + SQL migrations + strict PostgreSQL RLS baseline
- Minimal Next.js bootstrap pages for auth/org setup/invitation accept
- CI baseline for migration + RLS + API integration + web checks
- Workflow Core v2 baseline (create/publish/run/get-run for manual trigger)

## Quick Start
1. Install dependencies:
```bash
pnpm install
```
2. (Optional) set environment variables:
```bash
cp .env.example .env
```
   - rollout tip: keep `ORG_CONTEXT_ENFORCEMENT=warn` briefly for header fallback observation, then switch to `strict`.
   - logging: use `API_LOG_LEVEL` (default `info`) for structured rollout events.
3. Run checks:
```bash
pnpm migrate:check
pnpm lint
pnpm test
pnpm build
```
4. Run API and web locally:
```bash
pnpm --filter @vespid/api dev
pnpm --filter @vespid/web dev
```

## Rollout Runbook
- Org context rollout and rollback guide: `/docs/runbooks/org-context-rollout.md`

## Workflow Core APIs (Phase 2 Baseline)
- `POST /v1/orgs/:orgId/workflows`
- `GET /v1/orgs/:orgId/workflows/:workflowId`
- `POST /v1/orgs/:orgId/workflows/:workflowId/publish`
- `POST /v1/orgs/:orgId/workflows/:workflowId/runs`
- `GET /v1/orgs/:orgId/workflows/:workflowId/runs/:runId`
