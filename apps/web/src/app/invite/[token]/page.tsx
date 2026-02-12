"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "../../../lib/api";

export default function InviteAcceptPage() {
  const params = useParams<{ token?: string | string[] }>();
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token ?? "";

  async function acceptInvitation() {
    if (!token) {
      setResult({ code: "BAD_REQUEST", message: "Missing invitation token" });
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch(`/v1/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Accept Invitation</h1>
      <div className="card">
        <p>Invitation token: {token || "(missing)"}</p>
        <button onClick={acceptInvitation} disabled={loading}>
          {loading ? "Accepting..." : "Accept invitation"}
        </button>
        <p>
          You must be logged in first. <Link href="/auth">Go to Auth</Link>
        </p>
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
