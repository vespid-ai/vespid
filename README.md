# Vespid

Vespid is an open-source, multi-tenant automation platform focused on code-agent execution.

## License
This repository is fully open source under Apache-2.0.

## What This Build Supports
- Multi-tenant org isolation (API + DB + workflow runtime)
- Workflow DSL v2 (`draft -> published`, run queue lifecycle)
- BYON execution model for code-agent workloads
- Three integrated code-agent engines only:
  - `gateway.codex.v2`
  - `gateway.claude.v2`
  - `gateway.opencode.v2`
- Tool bridge v1 for:
  - `connector.action`
  - `agent.execute`

## What Was Removed
- Legacy monetization API surface from runtime paths
- Legacy proprietary-provider wiring from primary runtime paths
- DCO-required contribution policy for code contributions

## Quick Start
1. Install dependencies
```bash
pnpm install
```

2. (Optional) create local env file
```bash
cp .env.example .env
```

3. Validate migrations and baseline checks
```bash
pnpm migrate:check
pnpm check:migrations
pnpm lint
pnpm test
pnpm build
```

4. Start local services
```bash
pnpm dev
```

5. Ensure Redis is available for workflow queue execution
```bash
redis-server --port 6379
```

## Key Commands
```bash
pnpm build
pnpm test
pnpm lint
pnpm dev
pnpm migrate:check
pnpm migrate
pnpm db:rollback
pnpm check:migrations
pnpm sbom:generate
```

## Governance and Security
- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Governance model: `GOVERNANCE.md`
- Maintainers: `MAINTAINERS.md`
- Support channels: `SUPPORT.md`
