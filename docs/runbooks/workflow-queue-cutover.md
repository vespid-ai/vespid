# Workflow Queue Cutover Runbook

## Goal
Switch workflow run execution to Redis/BullMQ as the only queue path, with fail-fast behavior in API:

- `POST /v1/orgs/:orgId/workflows/:workflowId/runs` returns `201` only when enqueue succeeds.
- Redis/queue failures return `503` with `code=QUEUE_UNAVAILABLE`.
- API removes the just-created queued run if enqueue fails.

## Preconditions
- PostgreSQL is reachable and migrations are current.
- Redis is reachable from both `apps/api` and `apps/worker`.
- Environment variables are configured:
  - `REDIS_URL`
  - `WORKFLOW_QUEUE_NAME`
  - `WORKFLOW_QUEUE_CONCURRENCY`
  - `WORKFLOW_RETRY_ATTEMPTS`
  - `WORKFLOW_RETRY_BACKOFF_MS`

## Rollout Steps
1. Deploy DB migration changes first (`workflow_runs` retry/audit fields are backward compatible).
2. Deploy API with BullMQ producer enabled.
3. Deploy worker with BullMQ consumer enabled.
4. Verify logs show `workflow_run_enqueued` and `workflow_run_started`.
5. Verify end-to-end by creating/publishing/running a workflow and observing final `succeeded`/`failed`.

## Validation Commands
```bash
pnpm migrate:check
pnpm migrate
pnpm --filter @vespid/api test
pnpm --filter @vespid/worker test
pnpm --filter @vespid/tests test
```

## Observability Contract
Track these structured events:

- `workflow_run_enqueued`
- `workflow_run_started`
- `workflow_run_retried`
- `workflow_run_succeeded`
- `workflow_run_failed`
- `queue_unavailable`

Recommended dashboard ratios:
- `queue_unavailable` / run-create requests
- `workflow_run_failed` / `workflow_run_started`
- retry rate (`workflow_run_retried` / `workflow_run_started`)
- end-to-end success rate (`workflow_run_succeeded` / run-create requests)

## Common Failures
1. `QUEUE_UNAVAILABLE` spikes:
   - Check Redis availability and credentials in `REDIS_URL`.
   - Check network ACL/firewall between app services and Redis.
2. Runs stuck in `queued`:
   - Verify worker process is up and subscribed to `WORKFLOW_QUEUE_NAME`.
   - Verify worker concurrency and queue backlog.
3. High retry/failure rate:
   - Inspect `workflow_run_failed` error payloads.
   - Validate workflow DSL input and downstream dependencies.

## Rollback Steps
1. If queue failure rate is high, stop accepting new runs at ingress (temporary maintenance window) or scale down traffic.
2. Roll back API + worker to the last stable release tag.
3. Keep DB migration in place (schema is backward compatible; `next_attempt_at` retained).
4. Re-run validation commands and confirm run lifecycle is stable before reopening run creation traffic.

## Notes
- This cutover is single-stack (no producer/consumer dual-write).
- API does not fallback to synchronous execution when queue is down.
