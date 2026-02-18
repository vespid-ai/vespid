# Open-Source Release Runbook

## Purpose
Release tagged open-source artifacts with reproducible checks, SBOM, and provenance attestation.

## Preconditions
- All required CI checks are green.
- DCO checks are green for merged commits.
- Release notes draft is prepared.

## Required Gates
Run before tagging:
1. `pnpm check:licenses`
2. `pnpm check:secrets`
3. `pnpm lint && pnpm test && pnpm build`
4. `pnpm sbom:generate`

## Tagging and Release
1. Create and push a tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
2. GitHub workflow `.github/workflows/open-source-release.yml` builds:
   - node-agent binaries
   - SBOM and checksums
   - release assets upload
   - artifact provenance attestation
3. Verify release assets on the GitHub release page.

## Validation Checklist
- Release assets exist for all supported node-agent platforms.
- `artifacts/sbom/community-sbom.json` is included.
- Checksums file is included.
- Attestation was generated successfully.

## Rollback
- If release content is incorrect, revoke/deprecate the tag and publish a corrective release.
- If CI gate failures are found post-tag, stop downstream distribution and issue patched release notes.

## Summary
Open-source releases are gated by license/security checks and must include SBOM + provenance attestation.
