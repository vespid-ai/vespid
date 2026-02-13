# Vespid

Vespid is a greenfield, international, multi-tenant SaaS automation platform.

## Foundation Scope (Current)
- Monorepo baseline (`apps/*`, `packages/*`, `tests`)
- Auth + organization + RBAC baseline APIs (cookie + bearer sessions)
- Real Google/GitHub OAuth authorization code flow
- Drizzle schema + SQL migrations + strict PostgreSQL RLS baseline
- Minimal Next.js bootstrap pages for auth/org setup/invitation accept
- CI baseline for migration + RLS + API integration + web checks
- Workflow Core v2 baseline (create/publish/enqueue-run/get-run for manual trigger)
- Redis/BullMQ queue baseline (producer in API, consumer in worker, retry/backoff)
- Worker async execution baseline (`queued -> running -> succeeded|failed`)

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
4. Run full local stack (api + web + worker):
```bash
pnpm dev
```
5. Redis is required for workflow run enqueue/execution:
```bash
redis-server --port 6379
```

## Rollout Runbook
- Org context rollout and rollback guide: `/docs/runbooks/org-context-rollout.md`
- Workflow queue cutover and rollback guide: `/docs/runbooks/workflow-queue-cutover.md`
- Enterprise provider integration guide: `/docs/runbooks/enterprise-provider-integration.md`

## Open Core Licensing
Vespid uses an Open Core model.

| Area | License | Distribution |
|---|---|---|
| Community Core (`apps/api`, `apps/web`, `apps/worker`, `apps/node-agent`, `packages/db`, `packages/workflow`, `packages/shared`, `packages/connectors`) | AGPL-3.0-only | Public |
| SDK/Client (`packages/sdk-*`) | Apache-2.0 | Public |
| Enterprise modules (`packages/enterprise-*`, `apps/api-enterprise`, private enterprise repos) | Commercial Proprietary | Private |

Governance and policy references:
- `/docs/adr/0004-open-core-licensing-strategy.md`
- `/docs/open-source/licensing-and-boundary-policy.md`
- `/docs/open-source/cla-policy.md`
- `/docs/open-source/trademark-policy.md`
- `/docs/runbooks/community-release.md`
- `/COMMERCIAL-LICENSE.md`

## Community vs Enterprise
| Capability | Community | Enterprise |
|---|---|---|
| Email + OAuth auth baseline | Yes | Yes |
| Org and RBAC baseline | Yes | Yes |
| Workflow DSL v2 + async run queue | Yes | Yes |
| PostgreSQL RLS tenant isolation | Yes | Yes |
| Enterprise SSO/SCIM and advanced RBAC | No | Yes |
| Compliance export and enterprise policy packs | No | Yes |
| Enterprise connector packs | No | Yes |

## Community Release Artifacts
- Public source mirror (`.oss-allowlist` controlled)
- Community Docker images (API/Web/Worker)
- Apache-licensed SDK packages (`@vespid/sdk-client`)

## Commercial Licensing
For enterprise modules, commercial terms, and private deployment rights:
- `COMMERCIAL-LICENSE.md`
- Contact: `legal@vespid.example`

## Enterprise Provider Package Integration
To load private enterprise features in API runtime:

1. Install private package access in `.npmrc`:
```ini
@vespid-enterprise:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${ENTERPRISE_NPM_TOKEN}
```
2. Install provider package:
```bash
pnpm add -Dw @vespid-enterprise/provider@latest
```
3. Configure runtime:
```bash
export VESPID_ENTERPRISE_PROVIDER_MODULE=@vespid-enterprise/provider
```

Validation endpoints:
- `GET /v1/meta/capabilities` should return `edition: enterprise`.
- `GET /v1/meta/connectors` should include enterprise connectors (for bootstrap: `salesforce`).

## Compliance Commands
```bash
pnpm check:boundary
pnpm check:licenses
pnpm check:mirror
pnpm check:secrets
pnpm sbom:generate
```

## Workflow Core APIs (Phase 2 Baseline)
- `POST /v1/orgs/:orgId/workflows`
- `GET /v1/orgs/:orgId/workflows/:workflowId`
- `POST /v1/orgs/:orgId/workflows/:workflowId/publish`
- `POST /v1/orgs/:orgId/workflows/:workflowId/runs` (returns `queued`; returns `503/QUEUE_UNAVAILABLE` if queue is down)
- `GET /v1/orgs/:orgId/workflows/:workflowId/runs/:runId`

## Chinese Summary
- 许可模型为 Open Core：社区核心 AGPL、SDK Apache、企业模块商业许可证。
- 私有仓库为真源，公开社区仓由 allowlist 镜像生成。
- CI 强制门禁：边界依赖、许可证一致性、镜像 dry-run、密钥扫描。
