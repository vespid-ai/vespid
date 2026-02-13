# Enterprise Provider Integration Runbook

## Purpose
Wire a private enterprise provider package into community API runtime without changing community source dependencies.

## Prerequisites
- Access token with `read:packages` for `npm.pkg.github.com`.
- Private package published: `@vespid-ai/enterprise-provider`.
- Community repo already installed with workspace dependencies.

## Setup
1. Create project `.npmrc`:
   ```ini
   @vespid-ai:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${ENTERPRISE_NPM_TOKEN}
   ```
2. Install provider package:
   ```bash
   pnpm add -Dw @vespid-ai/enterprise-provider@latest
   ```
3. Set runtime module path:
   ```bash
   export VESPID_ENTERPRISE_PROVIDER_MODULE=@vespid-ai/enterprise-provider
   ```
4. Start API and verify:
   - `GET /v1/meta/capabilities` returns `edition: "enterprise"`
   - `GET /v1/meta/connectors` includes `salesforce` connector source `enterprise`

## Rollback
1. Unset environment variable:
   ```bash
   unset VESPID_ENTERPRISE_PROVIDER_MODULE
   ```
2. Restart API service.
3. API falls back to `community-core` provider.

## CI Validation
Use workflow:
- `.github/workflows/enterprise-provider-integration.yml`

The workflow installs enterprise provider package and runs API tests with `VESPID_ENTERPRISE_PROVIDER_MODULE` set.

## Summary (English Only)
- Inject enterprise capabilities via a private npm package + environment variable; do not add static community-to-enterprise dependencies.
- Rollback is removing the environment variable and restarting services.
