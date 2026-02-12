# Vespid

Vespid is a greenfield, international, multi-tenant SaaS automation platform.

## Foundation Scope (Current)
- Monorepo baseline (`apps/*`, `packages/*`, `tests`)
- Auth + organization + RBAC baseline APIs
- Drizzle schema + SQL migrations + PostgreSQL RLS baseline
- Minimal Next.js bootstrap pages for auth/org setup
- CI baseline for lint/test/build/migration checks

## Quick Start
1. Install dependencies:
```bash
pnpm install
```
2. (Optional) set environment variables:
```bash
cp .env.example .env
```
3. Run checks:
```bash
pnpm lint
pnpm test
pnpm build
```
4. Run API and web locally:
```bash
pnpm --filter @vespid/api dev
pnpm --filter @vespid/web dev
```
