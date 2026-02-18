# ADR 0004: Apache-2.0 Open-Source Licensing Strategy

## Status
Accepted

## Context
Vespid requires broad enterprise adoption, transparent contribution workflows, and verifiable open-source supply-chain practices.

The prior dual-track licensing model and separate contributor agreement workflow introduced additional adoption and governance overhead that no longer aligns with project direction.

## Decision
Adopt a single-repository Apache-2.0 licensing model.

Key decisions:
- Repository source is Apache-2.0.
- Contribution attestation is DCO-required (no CLA workflow).
- CI includes OSS-focused security gates:
  - Dependency Review
  - OpenSSF Scorecard
  - SBOM generation
  - Build provenance attestation for release artifacts

## Consequences
Positive:
- Lower legal friction for enterprise evaluation and internal deployment.
- Clear contribution workflow based on signed commits.
- Better supply-chain verifiability for released artifacts.

Tradeoffs:
- No proprietary licensing layer inside this repository.
- Release and governance rigor must carry more weight.

## Alternatives Considered
- Continue the prior dual-track licensing model with a separate contributor agreement workflow: rejected (higher adoption and contribution friction).
- Source-available licensing: rejected (not aligned with OSI-compatible strategy).

## Summary
Vespid uses Apache-2.0 with DCO-required contributions and supply-chain-verifiable release gates.
