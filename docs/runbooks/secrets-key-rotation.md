# Secrets KEK Runbook (Connector Secrets)

## Purpose
Vespid stores org-scoped connector secrets encrypted at rest. This runbook describes the minimum operational steps to:
- configure the Key Encryption Key (KEK) required for encrypt/decrypt
- rotate individual secrets (value rotation)
- prepare for future KEK rotation

## Environment Variables
Required for API + worker in any environment that writes or reads secrets:
- `SECRETS_KEK_ID`: identifier for the active KEK (default `dev-kek-v1`)
- `SECRETS_KEK_BASE64`: base64-encoded 32-byte key (required)

Optional:
- `GITHUB_API_BASE_URL`: override GitHub API base URL for tests/dev.

## Initial Setup
1. Generate a random 32-byte key and base64-encode it.
1. Set:
  - `SECRETS_KEK_ID` to a stable identifier (example: `prod-kek-2026-01`)
  - `SECRETS_KEK_BASE64` to the generated base64 string
1. Deploy API and worker with the same KEK settings.

## Secret Value Rotation (Recommended)
If you need to rotate a GitHub PAT (or any connector secret value):
1. Create a new PAT/token in the provider.
1. Call `PUT /v1/orgs/:orgId/secrets/:secretId` with the new `value`.
1. Verify subsequent runs succeed and events do not contain the token.

This rotates the encrypted secret value without changing workflow DSL (DSL references `secretId`).

## KEK Rotation Strategy (Future)
Current implementation assumes a single active KEK in env. To rotate KEKs safely without downtime, we will later extend:
- KEK resolver to support multiple KEKs during transition
- background re-encryption of stored DEKs under the new KEK

Until multi-KEK support is implemented:
- do not change `SECRETS_KEK_ID`/`SECRETS_KEK_BASE64` in-place for an environment that already has stored secrets.
  - Doing so will make existing secrets undecryptable.

