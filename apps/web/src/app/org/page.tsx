"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { getActiveOrgId, setActiveOrgId, subscribeActiveOrg } from "../../lib/org-context";

type CreateOrgResponse = {
  organization?: { id: string; slug: string; name: string };
};

export default function OrganizationPage() {
  const [orgName, setOrgName] = useState("Acme");
  const [orgSlug, setOrgSlug] = useState(`acme-${Date.now()}`);
  const [orgId, setOrgId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("member@example.com");
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    const current = getActiveOrgId();
    if (current) {
      setOrgId(current);
    }

    return subscribeActiveOrg((value) => {
      if (value) {
        setOrgId(value);
      }
    });
  }, []);

  async function createOrganization() {
    const response = await apiFetch("/v1/orgs", {
      method: "POST",
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });
    const payload = (await response.json()) as CreateOrgResponse;
    setResult(payload);

    const createdOrgId = payload.organization?.id;
    if (createdOrgId) {
      setOrgId(createdOrgId);
      setActiveOrgId(createdOrgId);
    }
  }

  async function inviteMember() {
    if (!orgId) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org before inviting." });
      return;
    }

    const response = await apiFetch(
      `/v1/orgs/${orgId}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, roleKey: "member" }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
  }

  return (
    <main>
      <h1>Organization</h1>

      <div className="card">
        <label htmlFor="orgName">Organization name</label>
        <input id="orgName" value={orgName} onChange={(event) => setOrgName(event.target.value)} />

        <label htmlFor="orgSlug">Organization slug</label>
        <input id="orgSlug" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />

        <button onClick={createOrganization}>Create organization</button>
      </div>

      <div className="card">
        <label htmlFor="orgId">Active organization ID</label>
        <input
          id="orgId"
          value={orgId}
          onChange={(event) => {
            const value = event.target.value;
            setOrgId(value);
            if (value) {
              setActiveOrgId(value);
            }
          }}
        />

        <label htmlFor="inviteEmail">Invite email</label>
        <input id="inviteEmail" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />

        <button onClick={inviteMember}>Invite member</button>
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
