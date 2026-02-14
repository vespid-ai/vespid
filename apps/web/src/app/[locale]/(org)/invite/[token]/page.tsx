"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../../../../../lib/api";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { CodeBlock } from "../../../../../components/ui/code-block";

export default function InviteAcceptPage() {
  const params = useParams<{ locale?: string | string[]; token?: string | string[] }>();
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";
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
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">Accept invitation</div>
        <div className="mt-1 text-sm text-muted">You must be logged in before accepting.</div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant={token ? "accent" : "warn"}>{token ? "TOKEN" : "MISSING"}</Badge>
            <CardTitle>Invitation</CardTitle>
          </div>
          <CardDescription className="break-all">{token || "(missing)"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="accent" onClick={acceptInvitation} disabled={loading || !token}>
            {loading ? "Accepting..." : "Accept invitation"}
          </Button>
          <Button asChild>
            <Link href={`/${locale}/auth`}>Go to Auth</Link>
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>Debug payload returned by the API.</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock value={result} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
