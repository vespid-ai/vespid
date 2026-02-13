"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { getActiveOrgId } from "../../lib/org-context";

type SecretMeta = {
  id: string;
  connectorId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
};

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [connectorId] = useState("github");
  const [name, setName] = useState("token");
  const [value, setValue] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [rotateValue, setRotateValue] = useState("");

  const orgId = useMemo(() => getActiveOrgId(), []);

  async function refresh() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    const response = await apiFetch(`/v1/orgs/${active}/secrets`, { method: "GET" }, { orgScoped: true });
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      const list = payload as { secrets?: SecretMeta[] };
      setSecrets(list.secrets ?? []);
      if (!selectedId && (list.secrets ?? []).length > 0) {
        setSelectedId((list.secrets ?? [])[0]!.id);
      }
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function createSecret() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${active}/secrets`,
      {
        method: "POST",
        body: JSON.stringify({ connectorId, name, value }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      setValue("");
      await refresh();
    }
  }

  async function rotateSecret() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    if (!selectedId) {
      setResult({ code: "SECRET_ID_REQUIRED", message: "Select a secret first." });
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${active}/secrets/${selectedId}`,
      {
        method: "PUT",
        body: JSON.stringify({ value: rotateValue }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      setRotateValue("");
      await refresh();
    }
  }

  async function deleteSecret() {
    const active = getActiveOrgId();
    if (!active) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return;
    }
    if (!selectedId) {
      setResult({ code: "SECRET_ID_REQUIRED", message: "Select a secret first." });
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${active}/secrets/${selectedId}`,
      { method: "DELETE" },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    if (response.ok) {
      setSelectedId("");
      await refresh();
    }
  }

  return (
    <main>
      <h1>Secrets</h1>

      <div className="card">
        <h2>List</h2>
        <button onClick={refresh}>Refresh</button>
        {secrets.length === 0 ? <p>No secrets yet.</p> : null}
        {secrets.length > 0 ? (
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            <label htmlFor="secret-select">Selected secret</label>
            <select id="secret-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {secrets.map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.connectorId}:{secret.name} ({secret.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Create</h2>
        <p>Values are never displayed after saving.</p>

        <label htmlFor="connector-id">Connector</label>
        <input id="connector-id" value={connectorId} disabled />

        <label htmlFor="secret-name">Name</label>
        <input id="secret-name" value={name} onChange={(e) => setName(e.target.value)} />

        <label htmlFor="secret-value">Value</label>
        <input
          id="secret-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste token..."
        />

        <button onClick={createSecret}>Create secret</button>
      </div>

      <div className="card">
        <h2>Rotate</h2>
        <label htmlFor="rotate-value">New value</label>
        <input
          id="rotate-value"
          value={rotateValue}
          onChange={(e) => setRotateValue(e.target.value)}
          placeholder="Paste new token..."
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={rotateSecret}>Rotate selected</button>
          <button onClick={deleteSecret}>Delete selected</button>
        </div>
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

