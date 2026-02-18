# Contributing to Vespid

Thanks for contributing.

## Ground Rules
- Use English for code comments, docs, PR text, and commit messages.
- Keep all tenant-scoped behavior organization-safe.
- Keep changes buildable in open-source mode with no proprietary dependencies.

## Development Setup
1. `pnpm install`
2. `cp .env.example .env` (optional)
3. `pnpm migrate:check`
4. `pnpm lint && pnpm test && pnpm build`

## Commit and PR Requirements
- Use Conventional Commits, for example:
  - `feat(workflow): add agent.run selector validation`
  - `fix(api): enforce org membership on secret lookup`
- Every commit must include a DCO sign-off line.
  - Use `git commit -s`.
  - Required trailer format:
    - `Signed-off-by: Your Name <you@example.com>`
- PRs must include:
  - Problem statement
  - Solution summary
  - Verification commands and outcomes
  - Risk and rollback notes

## Testing Expectations
- Happy-path + failure-path tests for new behavior.
- Tenant-boundary tests for org-scoped logic.
- For workflow/runtime changes: include queue + retry/error-path coverage.

## Security
Do not include credentials or production data in commits, tests, fixtures, logs, or screenshots.
Report vulnerabilities through SECURITY.md.
