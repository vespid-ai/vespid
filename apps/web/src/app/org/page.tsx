"use client";

import { useState } from "react";

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
}

export default function OrganizationPage() {
  const [token, setToken] = useState("");
  const [orgName, setOrgName] = useState("Acme");
  const [orgSlug, setOrgSlug] = useState(`acme-${Date.now()}`);
  const [orgId, setOrgId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("member@example.com");
  const [result, setResult] = useState<unknown>(null);

  async function createOrganization() {
    const response = await fetch(`${getApiBase()}/v1/orgs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });
    const payload = await response.json();
    setResult(payload);
    const id = (payload as { organization?: { id?: string } })?.organization?.id;
    if (id) {
      setOrgId(id);
    }
  }

  async function inviteMember() {
    const response = await fetch(`${getApiBase()}/v1/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: inviteEmail, roleKey: "member" }),
    });
    setResult(await response.json());
  }

  return (
    <main>
      <h1>Organization Bootstrap</h1>

      <div className="card">
        <label htmlFor="token">Bearer token</label>
        <input id="token" value={token} onChange={(event) => setToken(event.target.value)} />

        <label htmlFor="orgName">Organization name</label>
        <input id="orgName" value={orgName} onChange={(event) => setOrgName(event.target.value)} />

        <label htmlFor="orgSlug">Organization slug</label>
        <input id="orgSlug" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />

        <button onClick={createOrganization}>Create organization</button>
      </div>

      <div className="card">
        <label htmlFor="orgId">Organization ID</label>
        <input id="orgId" value={orgId} onChange={(event) => setOrgId(event.target.value)} />

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
