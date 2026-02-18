# Legal and OSS Release Checklist

Use this checklist before each tagged release.

## IP and Provenance
- [ ] Third-party dependency license review is complete.
- [ ] Build provenance attestation is generated and published.
- [ ] Release artifacts include checksums.

## Licensing
- [ ] SPDX checks passed (`pnpm check:licenses`).
- [ ] Root legal files are present and accurate.
- [ ] Package manifest `license` fields are correct.

## Contribution Compliance
- [ ] DCO checks passed for all release-scope commits.

## Security and Disclosure
- [ ] Secret scan passed (`pnpm check:secrets`).
- [ ] SBOM generated (`pnpm sbom:generate`).
- [ ] No private tokens/internal endpoints leaked in artifacts or release notes.

## Trademark
- [ ] Release notes preserve trademark usage constraints.

## Approval
- [ ] Engineering approver signed off.

## Summary
Each release must pass license, DCO, security, SBOM, and provenance attestation gates.
