# Community Release Runbook

This runbook defines release operations for the community distribution.

## Scope
Community release includes:
- Source release in public repository
- Community Docker images
- Apache-licensed SDK packages

## Preconditions
- CI is green on default branch.
- Legal and licensing checks passed.
- `major` / `minor` release has completed `/docs/open-source/legal-release-checklist.md`.
- Version is finalized across community and enterprise planning.

## Steps
1. Run guardrails locally:
   - `pnpm check:boundary`
   - `pnpm check:licenses`
   - `pnpm check:mirror`
   - `pnpm check:secrets`
2. Create and push release tag (example):
   - `git tag community-v0.4.0`
   - `git push origin community-v0.4.0`
3. Trigger `community-release.yml` workflow.
4. Trigger `community-mirror.yml` workflow (or let push trigger handle it).
5. Verify artifacts:
   - public source tag
   - GHCR images
   - npm publish status of SDK
6. Publish release notes with:
   - capability matrix (community vs enterprise)
   - commercial license contact path
   - trademark usage reminder

## Rollback
If release is invalid:
1. Stop public announcement.
2. Revoke/bump affected npm package version if needed.
3. Mark GHCR image as deprecated and publish patched tag.
4. Re-run mirror with fixed allowlist or revert offending commit.
5. Document incident in postmortem.

## Operational Checks
- Public mirror contains no `enterprise` paths.
- License files are present and consistent.
- No secrets in release artifacts.

## Summary (English Only)
- Community release must pass four guardrails first (boundary, licenses, mirror dry-run, secrets scan).
- After release, verify all three artifact classes: source, images, and SDK packages.
- If an issue is discovered, stop distribution first, then patch and document the incident.
