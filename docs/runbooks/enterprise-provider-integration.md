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

## Chinese Summary
- 通过私有 npm 包 + 环境变量方式注入企业能力，不在社区代码里静态依赖企业模块。
- 回滚只需移除环境变量并重启服务。
