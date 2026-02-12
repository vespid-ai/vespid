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
