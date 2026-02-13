# Licensing and Boundary Policy

This policy defines mandatory engineering and release controls for Vespid Open Core.

## 1) License Matrix
| Scope | License | Public Distribution |
|---|---|---|
| Community Core (`apps/api`, `apps/web`, `apps/worker`, `apps/node-agent`, `packages/db`, `packages/workflow`, `packages/shared`, `packages/connectors`) | AGPL-3.0-only | Yes |
| SDK/Client packages (`packages/sdk-*`) | Apache-2.0 | Yes |
| Enterprise modules (`packages/enterprise-*`, `apps/api-enterprise`, private enterprise repos) | Commercial Proprietary | No |

## 2) Boundary Invariants
- `community -> enterprise` imports are forbidden.
- `enterprise -> community` imports are allowed.
- Community services must run with no enterprise package installed.
- Enterprise features must be loaded through explicit provider interfaces.

## 3) License-per-directory Rule
- Every package must declare a SPDX `license` in `package.json`.
- Package-level LICENSE files are required for non-default licenses (for example Apache in `packages/sdk-*`).
- Root license files (`LICENSE`, `NOTICE`, `COPYRIGHT`) must always exist.

## 4) Public Mirror Controls
- Public mirror source is `.oss-allowlist`.
- Mirror dry-run must pass in CI before merge.
- Any matched path containing `enterprise` fails CI.
- Manual exceptions require both engineering and legal approval in PR notes.

## 5) Release Gates
Before release, CI must pass:
- boundary import check
- SPDX/license consistency check
- secret scan
- mirror dry-run check
- regression tests

## 6) Exception Process
If an exception is required:
1. Open a PR with `policy-exception` label.
2. Document reason, scope, rollback path, and expiry date.
3. Obtain approvals from legal and core maintainers.
4. Add a follow-up task to remove exception before expiry.

## 7) Summary (English Only)
- Directory-level licensing must be explicit and consistent with package declarations.
- Community code must not depend on enterprise code; CI must block violations.
- Public mirroring must use the allowlist only; any `enterprise` path match must fail.
- Exceptions must be time-bound with rollback plans and legal approval.
