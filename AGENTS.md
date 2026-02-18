# Repository Guidelines

## Overview
Vespid is a greenfield, international, multi-tenant SaaS automation platform.
It is inspired by Shrike's orchestration spirit, but it is not a code migration.

Primary goals:
- Multi-tenant SaaS isolation from day 1
- Internationalization-first (`en-US` primary, `zh-CN` supported)
- Extensible workflow runtime (`agent.run`, `agent.execute`, `connector.action`)
- BYON execution model for code-agent workloads

## Language Policy
- Docs, ADRs, runbooks, comments, commit messages, and PR text must be in English.
- Product UI may include `zh-CN` translation resources.

## Project Structure
- `apps/web/`: Next.js frontend
- `apps/api/`: Fastify control-plane API
- `apps/worker/`: queue consumers and workflow execution
- `apps/gateway/`: execution gateway (WS + internal dispatch)
- `apps/node-agent/`: cross-platform node execution agent
- `packages/db/`: Drizzle schema, migrations, RLS helpers
- `packages/workflow/`: workflow DSL v2 and runtime contracts
- `packages/connectors/`: connector adapters
- `packages/shared/`: shared types/errors/auth/observability helpers
- `tests/`: integration/e2e tests
- `docs/`: ADRs, runbooks, contracts
- `scripts/`: dev/CI utility scripts

## Build, Test, and Development Commands
- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm dev`
- `pnpm migrate:check`
- `pnpm migrate`
- `pnpm db:rollback`
- `pnpm check:migrations`

## Repository Truth Order
1. Committed scripts and package.json commands
2. `docs/**` architecture decisions and contracts
3. `AGENTS.md`
4. README and ad-hoc notes

## Open Source Governance (AI-Facing)
- Repository license baseline is Apache-2.0.
- DCO sign-off is required for code contributions.
- Use SPDX-compliant license metadata in package manifests.
- Trademark rights are not granted by source distribution; follow trademark policy.

## Runtime Invariants (AI-Facing)
- Tenant isolation is non-negotiable: all tenant reads/writes must enforce org boundary.
- Workflow lifecycle baseline:
  - draft state: `draft -> published`
  - run state: `queued -> running -> succeeded|failed`
- Workflow queue runtime uses Redis + BullMQ. `POST /runs` must fail with `503/QUEUE_UNAVAILABLE` when enqueue fails.
- Workflow run/node events are persisted in PostgreSQL (`workflow_run_events`) and tenant-scoped under RLS.
- Code-agent engines are restricted to:
  - `gateway.codex.v2`
  - `gateway.claude.v2`
  - `gateway.opencode.v2`
- Code-agent sessions/workflows are BYON-only.
- Node-agent tool bridge v1 supports only:
  - `connector.action`
  - `agent.execute`
- Legacy monetization endpoints are removed from OSS runtime.
- Drizzle is default DB path; use parameterized raw SQL only for proven complex queries.
- Migrations must include reversible `*.down.sql` partners and pass `pnpm check:migrations`.

## Security Guardrails
- Never access tenant data without tenant context (`organization_id` + principal).
- Org-scoped APIs require `X-Org-Id` plus membership validation.
- Enforce PostgreSQL RLS for tenant-scoped tables.
- Encrypt secrets at rest; never log plaintext credentials.
- Secret APIs must not return plaintext values after create/rotate.
- Queue unavailability must fail fast (no sync fallback).

## Coding Style
- TypeScript-first
- 2-space indentation for JS/TS/JSON/YAML
- Naming:
  - files: `kebab-case.ts`
  - types/classes: `PascalCase`
  - variables/functions: `camelCase`
- Keep modules focused and single-purpose.
- Add comments only where behavior is non-obvious.

## Testing Guidelines
- Unit tests for domain logic and adapters
- Integration tests for API + DB + queue flows
- E2E tests for critical journeys (auth, org setup, workflow execution)
- Each feature should include:
  - at least one happy-path test
  - at least one failure-path test
  - tenant-boundary test where applicable

## Change Type -> Minimum Verification
- `apps/web/**`: typecheck + changed-flow UI tests
- `apps/api/**`: API tests + auth/permission checks
- `apps/worker/**` or `packages/workflow/**`: runtime integration tests + retry/error-path checks
- `packages/db/**`: migration rehearsal + tenant-isolation tests
- workflow DSL/runtime changes: compatibility checks for existing v2 schemas

## Commit & PR Guidelines
Use Conventional Commits, for example:
- `feat(auth): add organization invitation flow`
- `fix(workflow): handle retry backoff overflow`
- `docs(architecture): add tenant isolation ADR`

PRs must include:
- Problem statement
- Solution summary
- Verification evidence (commands + outcomes)
- Risk and rollback notes
- UI screenshots when relevant

## High-Risk Checklist
Before merging high-impact changes, verify:
- Tenant isolation cannot be bypassed
- Auth/session checks are enforced on protected endpoints
- Queue workers are retry-safe/idempotent
- Secret values are never exposed in logs or errors
