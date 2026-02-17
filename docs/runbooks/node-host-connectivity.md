# Node Host Connectivity (v2)

This runbook explains how to operate Vespid's v2 interactive runtime:

- A **node host** runs `vespid-agent` and executes agent nodes.
- A **control client** (web or CLI) connects to the gateway and drives an **interactive session**.

The design is OpenClaw-aligned for session, memory, and routing-first multi-agent behavior.

## Concepts

### Control client vs node host

- **Control client**: any device that can authenticate as a user and send messages (browser, phone, CLI).
- **Node host**:
  - BYON executor: a machine you control (laptop/server) running `vespid-agent`.
  - Managed executor: platform-operated node-host from the shared managed pool.

Control clients do not execute tasks. They only drive sessions and workflows.

### Sessions vs workflows

- **Workflows**: persisted orchestration specs executed by `apps/worker`, optionally dispatching some nodes to node hosts.
- **Sessions**: interactive conversations that are **pinned** to a node host for consistent context and workdir state.
  - Execution mode is fixed to `pinned-node-host`.
  - No local in-process fallback exists in gateway brain.
  - Default routing is BYON-first with managed fallback; explicit `executorSelector.pool="managed"` is managed-only.

Sessions persist `agent_session_events` for auditability and replay.

### Routing and bindings

- Session routing resolves agent bindings in strict precedence:
  - `peer`
  - `parent_peer`
  - `org_roles`
  - `organization`
  - `team`
  - `account`
  - `channel`
  - `default`
- Deterministic session key:
  - `agent:<agentId>:org:<orgId>:scope:<scope>:<normalized-route-parts>`

## Security model (MVP)

- BYON executors are **org-bound** via pairing and executor tokens.
- Managed executors are service-issued via internal endpoints and authenticated with managed executor tokens.
- Control-plane (DB) tags are authoritative for routing. Agent self-reported tags are capability hints only.
- Session credential flow:
  - BYON path stays BYOK (`authMode=env`), and gateway does not forward inline LLM keys.
  - Managed path may receive temporary inline auth for session execution and must not persist or log auth payloads.
- Managed sessions run with a safe-minimum tool allowlist (memory tools only in v1).

## TLS / WSS

Production recommendation:

- Run `apps/gateway` behind a TLS terminator (nginx, cloud load balancer).
- Expose only `wss://.../ws` (agents) and `wss://.../ws/client` (control clients).
  - Canonical endpoint for agents is `wss://.../ws/executor` (`/ws` is compatibility alias).
- Keep internal routes private:
  - `/internal/v1/dispatch-async`
  - `/internal/v1/results/*`

Node-agent supports a custom CA bundle for `wss://` connections:

- `VESPID_AGENT_TLS_CA_FILE=/absolute/path/to/ca.pem`

Do not disable TLS verification.

## Local dev quickstart (single machine)

Prereqs:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`

1. Start the stack:

```bash
pnpm dev
```

2. Pair and start a node host:

```bash
pnpm --filter @vespid/node-agent dev
```

3. Configure LLM credentials on the node host environment:

```bash
export OPENAI_API_KEY=...
```

4. Open the control client UI:

- Web: `http://localhost:3000/en/sessions`
- Create a session, then send a message.

## Toolsets (skills-only semantics)

For `vespid.loop.v1` and `codex.sdk.v1` on node hosts, toolsets are treated as:

- **read-only prompt context** by injecting each enabled `SKILL.md` bundle into the system prompt.
- No MCP execution in this path (MCP is engine-dependent and may be supported in other engines).

Caps are controlled by:

- `TOOLSET_SKILLS_MAX_BUNDLES` (default 8)
- `TOOLSET_SKILLS_MAX_CHARS_PER_BUNDLE` (default 20000)
- `TOOLSET_SKILLS_MAX_TOTAL_CHARS` (default 80000)

## CLI usage (control client)

The CLI is token-based and intentionally minimal:

```bash
vespid session list --api http://localhost:3001 --org <orgId> --token <accessToken>
vespid session create --api http://localhost:3001 --org <orgId> --token <accessToken> --model gpt-4.1-mini --instructions "..."
vespid session send --gateway ws://localhost:3002/ws/client --org <orgId> --token <accessToken> --session <sessionId> --message "hello"
```

## Session and memory APIs (org-scoped)

- `POST /v1/orgs/:orgId/sessions`
- `POST /v1/orgs/:orgId/sessions/:sessionId/messages`
- `POST /v1/orgs/:orgId/sessions/:sessionId/reset`
- `GET/POST/PATCH/DELETE /v1/orgs/:orgId/agent-bindings`
- `POST /v1/orgs/:orgId/memory/sync`
- `GET /v1/orgs/:orgId/memory/search`
- `GET /v1/orgs/:orgId/memory/docs/:docId`

## Managed pool bootstrap APIs (internal)

- `POST /internal/v1/managed-executors/issue` (service token required)
  - Returns `executorId`, `executorToken`, `gatewayWsUrl` for managed node-host startup.
- `POST /internal/v1/managed-executors/:executorId/revoke` (service token required)
