import crypto from "node:crypto";

// This setup runs once per Vitest worker process (we use --pool=forks).
// It makes integration tests resilient to a developer running `pnpm dev` locally by
// isolating BullMQ queue names per test process.
const runId = crypto.randomBytes(6).toString("hex");

process.env.WORKFLOW_QUEUE_NAME = `workflow-runs-test-${runId}`;
process.env.WORKFLOW_CONTINUATION_QUEUE_NAME = `workflow-continuations-test-${runId}`;

// Deterministic KEK for tests that create/decrypt connector secrets.
process.env.SECRETS_KEK_ID = process.env.SECRETS_KEK_ID ?? "ci-kek-v1";
process.env.SECRETS_KEK_BASE64 = process.env.SECRETS_KEK_BASE64 ?? Buffer.alloc(32, 9).toString("base64");

process.env.GATEWAY_SERVICE_TOKEN = process.env.GATEWAY_SERVICE_TOKEN ?? "ci-gateway-token";
