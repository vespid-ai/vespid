"use client";

import { useEffect, useState } from "react";
import { clearActiveOrgId, getActiveOrgId, getKnownOrgIds, setActiveOrgId, subscribeActiveOrg } from "../lib/org-context";

export function OrgSwitcher() {
  const [activeOrgId, setActiveOrgIdState] = useState<string>("");
  const [knownOrgIds, setKnownOrgIds] = useState<string[]>([]);
  const [draftOrgId, setDraftOrgId] = useState<string>("");

  useEffect(() => {
    const current = getActiveOrgId();
    setActiveOrgIdState(current ?? "");
    setKnownOrgIds(getKnownOrgIds());
    setDraftOrgId(current ?? "");

    return subscribeActiveOrg((next) => {
      setActiveOrgIdState(next ?? "");
      setKnownOrgIds(getKnownOrgIds());
      setDraftOrgId(next ?? "");
    });
  }, []);

  function applyOrgId(value: string) {
    if (!value) {
      clearActiveOrgId();
      return;
    }
    setActiveOrgId(value);
  }

  return (
    <header style={{ borderBottom: "1px solid #ddd", padding: "0.75rem 1rem", display: "grid", gap: "0.5rem" }}>
      <strong>Active Organization</strong>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <select
          value={activeOrgId}
          onChange={(event) => applyOrgId(event.target.value)}
          style={{ minWidth: "22rem", maxWidth: "100%" }}
        >
          <option value="">No active org</option>
          {knownOrgIds.map((orgId) => (
            <option key={orgId} value={orgId}>
              {orgId}
            </option>
          ))}
        </select>
        <input
          value={draftOrgId}
          onChange={(event) => setDraftOrgId(event.target.value)}
          placeholder="Paste org UUID"
          style={{ minWidth: "22rem", maxWidth: "100%" }}
        />
        <button type="button" onClick={() => applyOrgId(draftOrgId.trim())}>
          Set org
        </button>
      </div>
      <small>{activeOrgId ? `Current org: ${activeOrgId}` : "Org-scoped API calls require this header."}</small>
    </header>
  );
}
