# Repository Guidelines

## Overview
Vespid is a greenfield, international, multi-tenant SaaS automation platform.
It is inspired by Shrike’s orchestration spirit, but it is not a code migration.
Do not copy implementation from legacy repos; rebuild with clean boundaries.

Primary product goals:
- Multi-tenant SaaS (organization-level isolation from day 1)
- Internationalization-first (en-US primary, zh-CN supported)
- General enterprise automation (not limited to software bug workflows)
- Extensible workflow runtime (agent + browser + node execution)

## Project Structure & Module Organization
Use this monorepo layout:

- `apps/web/` Next.js frontend (product UI + BFF-facing routes)
- `apps/api/` Fastify control plane API (auth/org/workflow/connectors/billing)
- `apps/worker/` queue consumers and workflow runtime execution
- `apps/node-agent/` cross-platform node execution agent (CLI, optional Docker mode)
- `packages/db/` Drizzle schema, migrations, RLS policies, DB utilities
- `packages/workflow/` workflow DSL v2, runtime contracts, node specs
- `packages/connectors/` Jira/GitHub/Slack/Email adapters
- `packages/shared/` shared domain types, errors, auth and observability helpers
- `tests/` integration/e2e tests
- `docs/` architecture decisions, runbooks, and product contracts
- `scripts/` local/dev/CI utility scripts

## Build, Test, and Development Commands
- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm lint`
- `pnpm dev`
- `pnpm migrate:check`
- `pnpm migrate`

## Codex Rules (AI Execution Guardrails)
This repo includes Codex rules to control what commands may run **outside the sandbox**:
- `codex/rules/vespid.rules` (primary)
- `.codex/rules/vespid.rules` (compat)

These rules only apply when the repo is marked as trusted so Codex will load project overrides.

## Repository Truth & Priorities
When documentation conflicts, trust in this order:

1. Committed scripts and package.json commands
2. `/docs/**` architecture decisions (ADR/runbook/contracts)
3. `AGENTS.md`
4. README or ad-hoc notes

## Open Source Governance (AI-Facing)
- `Open Source Boundary Invariant`: Open Core separation is mandatory. Community code must remain buildable/runnable without enterprise modules.
- `License-per-directory Rule`: Every package and directory scope must have explicit SPDX-aligned license ownership; do not introduce mixed-license ambiguity in a single module.
- `No community->enterprise import rule`: Any dependency from community modules to enterprise modules is forbidden.
- `Public mirror release gate`: Public source publication must be generated only from `.oss-allowlist` and pass dry-run checks.
- `CLA required for code contributions`: External code contributions must pass CLA checks before merge.
- `Trademark protection required for distribution`: Distribution does not grant trademark rights; brand usage must follow trademark policy.

## Runtime Invariants (AI-Facing)
- Treat organization isolation as non-negotiable; every tenant-scoped read/write must enforce org boundary.
- Prefer typed module boundaries and explicit contracts over implicit shared state.
- Workflow runtime uses Graph DSL v2 (new design), not Shrike GRAPH_V1 compatibility mode.
- Workflow lifecycle baseline: `draft -> published`, with run state `queued -> running -> succeeded|failed` (`/runs` enqueues, `apps/worker` executes).
- Workflow queue runtime is Redis + BullMQ single stack. `POST /runs` must only succeed when enqueue succeeds; queue failures must return `503/QUEUE_UNAVAILABLE` and not leave fresh dirty queued runs.
- Drizzle is the default DB access path; use parameterized raw SQL only for proven complex queries.
- Auth model is Email + OAuth first; enterprise SSO can be added later without breaking core auth contracts.
- Auth runtime is dual-mode: short-lived Bearer access token + HttpOnly refresh cookie.
- Billing model is Seat + Usage (Stripe), with idempotent webhook processing.
- Node agent supports CLI-first execution with optional Docker isolation mode.

## Security & Multi-Tenant Guardrails
- Never access tenant data without tenant context (`organization_id` + auth principal).
- Org-scoped API routes must require `X-Org-Id` and membership validation.
- Workflow APIs are org-scoped and require `X-Org-Id` with membership checks.
- Temporary rollout mode `ORG_CONTEXT_ENFORCEMENT=warn` is allowed only for short observation windows and only for header fallback observation; membership checks stay enforced.
- Queue unavailability must fail fast (no sync execution fallback in API).
- Enforce PostgreSQL RLS for tenant-scoped tables.
- Encrypt secrets at rest (envelope encryption); never log plaintext credentials/tokens.
- Keep audit logs for permission changes, credential changes, workflow publish/deploy actions, and billing mutations.
- Default retention is 30 days for logs/artifacts unless org policy overrides it.

## Coding Style & Naming Conventions
- TypeScript-first.
- Indentation: 2 spaces for JS/TS/JSON/YAML.
- Naming:
  - Files: `kebab-case.ts` for TS modules
  - Types/classes: `PascalCase`
  - Variables/functions: `camelCase`
- Keep modules small and single-purpose.
- Add comments only where behavior is not obvious from code.

## Testing Guidelines
- Unit tests for domain logic and adapters.
- Integration tests for API + DB + queue flows.
- E2E tests for core user journeys (auth, org setup, workflow run, billing event).
- Every feature should include:
  - at least one happy-path test
  - at least one failure-path test
  - tenant-boundary test where applicable

## Change Type -> Minimum Verification
- `apps/web/**`: type-check + UI tests for changed flows.
- `apps/api/**`: API tests + auth/permission checks.
- `apps/worker/**` or `packages/workflow/**`: runtime integration tests and retry/error-path checks.
- `packages/db/**`: migration rehearsal + tenant isolation tests.
- auth/billing changes: idempotency and security regression checks required.
- workflow DSL/runtime changes: compatibility tests for existing v2 schemas required.

## Commit & Pull Request Guidelines
Use Conventional Commits:

- `feat(auth): add organization invitation flow`
- `fix(workflow): handle retry backoff overflow`
- `docs(architecture): add tenant isolation ADR`

PRs must include:

- Problem statement
- Solution summary
- Verification evidence (commands and outcomes)
- Risk and rollback notes
- Screenshots for UI changes where relevant

## AGENTS.md Maintenance Triggers
Update this file when any of the following changes:

- Core commands (`pnpm dev/build/test/lint`) or script entrypoints
- Runtime topology (apps/services added/removed)
- Auth, tenancy, billing, or workflow contracts
- Open source licensing, boundary policy, CLA flow, or trademark policy
- Required environment variables
- Release/deployment model changes (AWS/Cloudflare assumptions)

## High-Risk Checklist
Before merging high-impact changes, verify:

- Tenant isolation cannot be bypassed
- Auth/session checks are enforced on all protected endpoints
- Stripe webhook handlers are idempotent
- Queue workers are safe under retries
- Secret values are never exposed in logs/errors
