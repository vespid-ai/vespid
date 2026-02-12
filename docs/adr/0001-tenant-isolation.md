# ADR 0001: Tenant Isolation Strategy

## Status
Accepted

## Context
Vespid is a multi-tenant SaaS platform where organization-level data isolation is a hard requirement.

## Decision
- Use shared PostgreSQL tables with `organization_id` as tenant key.
- Enforce Row-Level Security (RLS) on tenant-scoped tables.
- Use database session settings (`app.current_org_id`, `app.current_user_id`) for policy evaluation.
- Apply strict tenant policies: missing `app.current_org_id` yields no tenant data access.
- Require API org context via `X-Org-Id` and validate actor membership before tenant operations.
- Keep API authorization checks at application layer as defense-in-depth.

## Consequences
- Strong isolation with lower operational overhead than per-tenant schema/database.
- Query and migration discipline is required for every new tenant-scoped table.
