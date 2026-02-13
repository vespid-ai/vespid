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

## Chinese Summary
- 本仓库强制 CLA，不签 CLA 不合并。
- 选择 CLA 是为了保证商业再许可的法律清晰性。
