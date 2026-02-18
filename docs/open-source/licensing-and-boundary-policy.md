# Licensing and Distribution Policy

This policy defines licensing and release controls for the Apache-licensed Vespid repository.

## 1) License Baseline
- Repository license: `Apache-2.0`
- Every package must declare an SPDX-compatible `license` field in `package.json`.
- Root legal files must remain present and accurate:
  - `LICENSE`
  - `NOTICE`
  - `COPYRIGHT`

## 2) Open-Source Runtime Invariants
- Mainline code must build and run without proprietary modules.
- Public APIs and runtime contracts must not require closed-source dependencies.
- Legacy monetization endpoints are removed from OSS runtime surfaces.

## 3) Contribution Intake
- DCO sign-off is required for all commits.
- CI must enforce DCO before merge.

## 4) Release Gates
Before release, CI must pass at minimum:
- SPDX/license checks (`pnpm check:licenses`)
- Dependency review checks
- Secret scan (`pnpm check:secrets`)
- SBOM generation (`pnpm sbom:generate`)
- Build provenance attestation workflow

## 5) Trademark
Code distribution does not grant trademark rights. See `docs/open-source/trademark-policy.md`.

## Summary
Vespid uses a single Apache-2.0 open-source licensing model with DCO-based contribution attestation and supply-chain-focused release gates.
