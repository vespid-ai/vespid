# ADR 0003: Foundation Data Model

## Status
Accepted

## Context
Foundation requires a minimum data model to support auth, org bootstrap, and RBAC.

## Decision
Core tables:
- `users`
- `organizations`
- `roles`
- `memberships`
- `organization_invitations`
- `auth_sessions`

Model constraints:
- Unique user email (case-insensitive)
- Unique membership (`organization_id`, `user_id`)
- Role catalog seeded as `owner`, `admin`, `member`
- Refresh session tokens stored as hashes (`auth_sessions.refresh_token_hash`)

## Consequences
- Supports organization creation, invitation, and role mutation flows.
- Provides a stable baseline for workflow and runtime-scoped tables.
