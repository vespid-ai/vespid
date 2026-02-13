"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { getActiveOrgId } from "../../lib/org-context";

type AgentMeta = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt?: string | null;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  const orgId = useMemo(() => getActiveOrgId(), []);

  async function refresh() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    const response = await apiFetch(`/v1/orgs/${active}/agents`, { method: "GET" }, { orgScoped: true });
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      const list = payload as { agents?: AgentMeta[] };
      setAgents(list.agents ?? []);
      if (!selectedId && (list.agents ?? []).length > 0) {
        setSelectedId((list.agents ?? [])[0]!.id);
      }
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function createPairingToken() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${active}/agents/pairing-tokens`,
      { method: "POST" },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      const parsed = payload as { token?: string; expiresAt?: string };
      setPairingToken(parsed.token ?? null);
      setPairingExpiresAt(parsed.expiresAt ?? null);
    }
  }

  async function revokeSelected() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    if (!selectedId) {
      setResult({ code: "AGENT_ID_REQUIRED", message: "Select an agent first." });
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${active}/agents/${selectedId}/revoke`,
      { method: "POST" },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      await refresh();
    }
  }

  return (
    <main>
      <h1>Agents</h1>

      <div className="card">
        <h2>List</h2>
        <button onClick={refresh}>Refresh</button>
        {agents.length === 0 ? <p>No agents yet.</p> : null}
        {agents.length > 0 ? (
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            <label htmlFor="agent-select">Selected agent</label>
            <select id="agent-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.status}) {agent.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button onClick={revokeSelected}>Revoke selected</button>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Pairing token</h2>
        <p>Tokens are displayed only once. They expire in 15 minutes.</p>
        <button onClick={createPairingToken}>Create pairing token</button>
        {pairingToken ? (
          <pre style={{ marginTop: "0.75rem" }}>
            {JSON.stringify({ token: pairingToken, expiresAt: pairingExpiresAt }, null, 2)}
          </pre>
        ) : null}
      </div>

      {result ? (
        <div className="card">
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </main>
  );
}

