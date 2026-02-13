# CLA Policy

## Purpose
Vespid requires a Contributor License Agreement (CLA) so accepted contributions can be maintained under Open Core and commercial distribution models.

## Requirements
- External contributors must sign CLA before PR merge.
- Corporate contributors sign organization CLA where applicable.
- Commits without CLA signature are blocked from merge.

## Why CLA (instead of DCO-only)
- DCO proves origin attestation but does not grant sufficient relicensing permissions for dual/open-core commercialization.
- CLA provides explicit rights needed for long-term legal clarity.

## Process
1. Contributor opens PR.
2. CLA workflow checks signature status.
3. If unsigned, contributor follows CLA bot link and signs.
4. PR can merge only when CLA status is green.

## Repository Enforcement
- GitHub workflow: `.github/workflows/cla.yml`
- Policy reference: this document and `AGENTS.md`

## Summary (English Only)
- This repository requires a CLA; unsigned contributions must not be merged.
- We use a CLA to ensure legal clarity for Open Core and commercial relicensing needs.
