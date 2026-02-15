# Node Host Connectivity (v1)

This runbook explains how to operate Vespid's "node host connectivity" feature set:

- A **node host** runs `vespid-agent` and executes agent nodes.
- A **control client** (web or CLI) connects to the gateway and drives an **interactive session**.

This is inspired by the general "gateway + nodes" model, but Vespid's implementation is workflow-first and multi-tenant by default.

## Concepts

### Control client vs node host

- **Control client**: any device that can authenticate as a user and send messages (browser, phone, CLI).
- **Node host**: a machine you control (laptop, server) running `vespid-agent` connected to `apps/gateway`.

Control clients do not execute tasks. They only drive sessions and workflows.

### Sessions vs workflows

- **Workflows**: persisted orchestration specs executed by `apps/worker`, optionally dispatching some nodes to node hosts.
- **Sessions**: interactive conversations that are **pinned** to a node host for consistent context and workdir state.

Sessions persist `agent_session_events` for auditability and replay.

## Security model (MVP)

- Node hosts are **org-bound** via pairing and agent tokens.
- Control-plane (DB) tags are authoritative for routing. Agent self-reported tags are capability hints only.
- Sessions are **BYOK on node host**:
  - The gateway does not decrypt or forward LLM API keys for sessions.
  - Node hosts must be configured with provider credentials in environment variables (for example `OPENAI_API_KEY`).

## TLS / WSS

Production recommendation:

- Run `apps/gateway` behind a TLS terminator (nginx, cloud load balancer).
- Expose only `wss://.../ws` (agents) and `wss://.../ws/client` (control clients).
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

