"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { getActiveOrgId, getKnownOrgIds, setActiveOrgId, subscribeActiveOrg } from "../../../../lib/org-context";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";

type CreateOrgResponse = {
  organization?: { id: string; slug: string; name: string };
};

export default function OrganizationPage() {
  const t = useTranslations();

  const [orgName, setOrgName] = useState("Acme");
  const [orgSlug, setOrgSlug] = useState(`acme-${Date.now()}`);
  const [orgId, setOrgId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("member@example.com");
  const [result, setResult] = useState<unknown>(null);
  const [showDebug, setShowDebug] = useState(false);

  const recentOrgs = useMemo(() => getKnownOrgIds(), [orgId]);

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
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("nav.org")}</div>
        <div className="mt-1 text-sm text-muted">Tenant context is required for org-scoped API calls.</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create organization</CardTitle>
            <CardDescription>Creates an org and automatically sets it as active.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="orgName">Organization name</Label>
              <Input id="orgName" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="orgSlug">Organization slug</Label>
              <Input id="orgSlug" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
            </div>
            <Button variant="accent" onClick={createOrganization}>
              Create organization
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
            <CardDescription>Requires an active org.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="orgId">Active organization ID</Label>
              <Input
                id="orgId"
                value={orgId}
                onChange={(event) => {
                  const value = event.target.value;
                  setOrgId(value);
                  if (value.trim().length) {
                    setActiveOrgId(value.trim());
                  }
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inviteEmail">Invite email</Label>
              <Input id="inviteEmail" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            </div>
            <Button onClick={inviteMember}>Invite member</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("org.recent")}</CardTitle>
          <CardDescription>Stored locally in this browser.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {recentOrgs.length === 0 ? <div className="text-sm text-muted">No recent orgs.</div> : null}
          {recentOrgs.map((id) => (
            <Button key={id} variant={id === orgId ? "accent" : "outline"} onClick={() => setActiveOrgId(id)}>
              {id.slice(0, 8)}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div>
        <Button variant="ghost" onClick={() => setShowDebug((v) => !v)}>
          {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
        </Button>
        {showDebug && result ? (
          <div className="mt-2">
            <CodeBlock value={result} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
