# Channel Runtime Runbook

## Scope

This runbook covers the Vespid channel runtime introduced in `packages/channels`, `apps/gateway/src/channels`, and org-scoped channel control APIs in `apps/api`.

Runtime invariants:

- Tenant context is resolved from `channel_accounts` mapping only.
- Inbound payloads never provide authoritative `organization_id`.
- Queue unavailability must fail fast for workflow triggers (`503/QUEUE_UNAVAILABLE`).
- Default security baseline:
  - `dmPolicy=pairing`
  - `groupPolicy=allowlist`
  - `requireMentionInGroup=true`
  - `open` modes require explicit `*` allowlist entries.

## Feature Flags

- Global: `CHANNEL_RUNTIME_ENABLED=true|false`
- Per channel: `CHANNEL_<CHANNEL_ID>_ENABLED=true|false`
  - Example: `CHANNEL_TELEGRAM_ENABLED=true`
  - Example: `CHANNEL_NEXTCLOUD_TALK_ENABLED=false` becomes `CHANNEL_NEXTCLOUD_TALK_ENABLED=false`
- Per account: `channel_accounts.enabled`

## Required Services

- PostgreSQL (channel account state, routing, audit, idempotency logs)
- Redis (gateway bus + idempotency key cache)
- API service (`/internal/v1/channels/trigger-run`)
- Gateway edge service (`/ingress/channels/:channelId/:accountKey`)

## Service Tokens

- Gateway -> API internal trigger uses `x-service-token`.
- Token resolution order:
  - API: `INTERNAL_API_SERVICE_TOKEN` -> `API_SERVICE_TOKEN` -> `GATEWAY_SERVICE_TOKEN`
  - Gateway: `INTERNAL_API_SERVICE_TOKEN` -> `GATEWAY_SERVICE_TOKEN`
- In production, set explicit `INTERNAL_API_SERVICE_TOKEN` and rotate regularly.

## External Channel Dependencies

Some channels need sidecars/daemons. Keep them isolated from gateway process and health-check each dependency.

- `signal`: Signal daemon (`signal-cli` bridge)
- `bluebubbles`: BlueBubbles server
- `imessage`: iMessage bridge runtime
- `msteams`: Bot Framework / Teams adapter runtime

Recommended operational model:

1. Run gateway and sidecars as separate containers/processes.
2. Route sidecar callbacks to gateway ingress endpoint.
3. Mark account status `stopped` or `error` instead of crashing gateway when sidecar is down.

## Health and Diagnostics

### API checks

- `GET /v1/meta/channels`
- `GET /v1/orgs/:orgId/channels/accounts`
- `GET /v1/orgs/:orgId/channels/accounts/:accountId/status`
- `POST /v1/orgs/:orgId/channels/accounts/:accountId/test-send`

### Gateway checks

- `GET /healthz`
- Ingress smoke test:

```bash
curl -X POST \
  "http://localhost:3002/ingress/channels/telegram/main" \
  -H "content-type: application/json" \
  -d '{"senderId":"u-1","conversationId":"dm:u-1","text":"hello","messageId":"m-1","isDirectMessage":true}'
```

Expected response:

- `202` with `{ ok: true, accepted: boolean, reason, sessionRouted, workflowsTriggered }`

### Full channel matrix smoke

Use the built-in smoke script to validate all 21 channels with:

- one channel-specific happy-path ingress payload (expects workflow run +1)
- one malformed payload (expects `normalize_failed` and no new workflow run)

```bash
CHANNEL_SMOKE_API_BASE_URL=http://localhost:3001 \
CHANNEL_SMOKE_GATEWAY_BASE_URL=http://localhost:3002 \
pnpm smoke:channels
```

Useful options:

- Reuse existing session/org:
  - `CHANNEL_SMOKE_TOKEN=<bearer-token>`
  - `CHANNEL_SMOKE_ORG_ID=<org-id>`
- Run subset only:

```bash
pnpm smoke:channels -- --channels=telegram,slack,msteams
```

## Validation Matrix

Automated coverage for channel runtime currently includes:

- Adapter unit matrix (21 channels, happy + malformed + auth-failure):
  - `apps/gateway/src/channels/adapters/core.test.ts`
- Runtime manager unit matrix (Core8 + Extended13 route to session/workflow, malformed drop):
  - `apps/gateway/src/channels/manager.test.ts`
- End-to-end integration (API + Gateway + DB + Redis):
  - Core channels happy + malformed:
    - `tests/channels-core8.integration.test.ts`
  - Extended channels happy + malformed:
    - `tests/channels-extended.integration.test.ts`
  - Auth-gated failure reasons for all 21 channels:
    - `tests/channels-auth.integration.test.ts`
- Operator smoke execution script:
  - `scripts/channel-smoke-matrix.ts`
- CI smoke gate:
  - `.github/workflows/channels-smoke.yml`
  - Runs nightly and via manual dispatch.
  - Boots API + Gateway + Postgres + Redis, then executes `pnpm smoke:channels`.

### Runtime event sources

- `channel_events`
- `channel_messages`
- API status payload includes `latestEvents`

### Metrics

The channel runtime emits metric-style log events with these names:

- `channel_inbound_total`
- `channel_outbound_total`
- `channel_drop_total`
- `channel_pairing_pending`
- `channel_auth_fail_total`
- `channel_trigger_run_total`

## Security Troubleshooting

### Inbound dropped with `dm_pairing_required`

- Expected when sender is not allowlisted under `dmPolicy=pairing`.
- Approve request via:
  - `GET /v1/orgs/:orgId/channels/pairing/requests`
  - `POST /v1/orgs/:orgId/channels/pairing/requests/:requestId/approve`

### Inbound dropped with `group_mention_required`

- Group message did not match mention rule.
- Either mention bot in message or set `requireMentionInGroup=false` on account.

### Inbound dropped with `*_open_requires_wildcard`

- `open` policy configured without explicit `*` allowlist entry.
- Add allowlist entry:

```bash
curl -X PUT \
  "http://localhost:3001/v1/orgs/<orgId>/channels/accounts/<accountId>/allowlist" \
  -H "authorization: Bearer <token>" \
  -H "x-org-id: <orgId>" \
  -H "content-type: application/json" \
  -d '{"scope":"sender","subject":"*"}'
```

## Outbound Retry and Dead Letter

Gateway session replies to channels use exponential backoff:

- `CHANNEL_OUTBOUND_MAX_ATTEMPTS` (default `3`)
- `CHANNEL_OUTBOUND_RETRY_BASE_MS` (default `500`)

After final failed attempt, outbound message is marked `dead_letter` in `channel_messages` and an error event is appended in `channel_events`.

## Rollout Sequence

1. Enable `CHANNEL_RUNTIME_ENABLED` in a single internal org.
2. Enable per-channel flags for pilot channels only.
3. Validate security gating and pairing approval flow.
4. Validate workflow trigger enqueue path and queue rollback behavior.
5. Expand to low-volume tenants, then full rollout.

## Rollback

Fast rollback options:

1. Set `CHANNEL_RUNTIME_ENABLED=false` globally.
2. Or disable a specific channel with `CHANNEL_<CHANNEL_ID>_ENABLED=false`.
3. Or disable specific accounts by setting `channel_accounts.enabled=false`.

Data retention and safety:

- Keep schema and channel history tables intact.
- Do not delete `channel_messages` / `channel_events` during incident rollback.
- Use status APIs for postmortem analysis.
