"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";
import { getActiveOrgId, setActiveOrgId, subscribeActiveOrg } from "../../../../lib/org-context";
import { useMe } from "../../../../lib/hooks/use-me";
import { useSession } from "../../../../lib/hooks/use-session";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";

type CreateOrgResponse = {
  organization?: { id: string; slug: string; name: string };
};

function formatApiError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as any;
    const code = typeof obj.code === "string" ? obj.code : null;
    const message = typeof obj.message === "string" ? obj.message : null;
    if (code && message) {
      return `${code}: ${message}`;
    }
    if (message) {
      return message;
    }
  }
  return `Request failed (HTTP ${status})`;
}

export default function OrganizationPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const authSession = useSession();
  const meQuery = useMe(Boolean(authSession.data?.session));

  const [orgName, setOrgName] = useState("Acme");
  // Avoid hydration mismatches by not using Date.now() during initial render.
  const [orgSlug, setOrgSlug] = useState("acme");
  const [inviteEmail, setInviteEmail] = useState("member@example.com");
  const [activeOrgId, setActiveOrgIdState] = useState("");

  // Avoid reading localStorage during the server render / initial hydration pass.
  const [recentOrgs, setRecentOrgs] = useState<Array<{ id: string; name: string }>>([]);

  const canManageOrganizations = Boolean(meQuery.data?.orgPolicy?.canManageOrganizations);
  const orgNameById = new Map((meQuery.data?.orgs ?? []).map((org) => [org.id, org.name]));
  const activeOrgName = activeOrgId ? orgNameById.get(activeOrgId) ?? "" : "";

  useEffect(() => {
    // Generate a default slug after hydration. Keep user edits intact.
    setOrgSlug((prev) => (prev === "acme" ? `acme-${Date.now()}` : prev));

    const current = getActiveOrgId();
    if (current) {
      setActiveOrgIdState(current);
    }

    return subscribeActiveOrg((value) => {
      if (value) {
        setActiveOrgIdState(value);
      }
    });
  }, []);

  useEffect(() => {
    const orgs = meQuery.data?.orgs ?? [];
    if (orgs.length > 0) {
      setRecentOrgs(orgs.map((org) => ({ id: org.id, name: org.name })));
      return;
    }
    setRecentOrgs([]);
  }, [meQuery.data?.orgs]);

  useEffect(() => {
    const defaultOrgId = meQuery.data?.defaultOrgId ?? null;
    if (!activeOrgId && defaultOrgId) {
      setActiveOrgId(defaultOrgId);
    }
  }, [activeOrgId, meQuery.data?.defaultOrgId]);

  useEffect(() => {
    if (!authSession.data?.session || !meQuery.data) {
      return;
    }
    if (!canManageOrganizations) {
      router.replace(`/${locale}/conversations`);
    }
  }, [authSession.data?.session, canManageOrganizations, locale, meQuery.data, router]);

  async function createOrganization() {
    const response = await apiFetch("/v1/orgs", {
      method: "POST",
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });
    const payload = (await response.json()) as CreateOrgResponse;

    if (!response.ok) {
      toast.error(formatApiError(payload, response.status));
      return;
    }

    const createdOrgId = payload.organization?.id;
    if (createdOrgId) {
      setActiveOrgIdState(createdOrgId);
      setActiveOrgId(createdOrgId);
      toast.success(t("common.created"));
      void meQuery.refetch();
    }
  }

  async function inviteMember() {
    if (!activeOrgId) {
      toast.error(t("org.requireActive"));
      return;
    }

    const response = await apiFetch(
      `/v1/orgs/${activeOrgId}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, roleKey: "member" }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();

    if (!response.ok) {
      toast.error(formatApiError(payload, response.status));
      return;
    }
    toast.success("Invitation sent");
  }

  if (authSession.data?.session && meQuery.data && !canManageOrganizations) {
    return (
      <div className="grid gap-4">
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("nav.org")}</div>
        <div className="text-sm text-muted">{t("home.redirecting")}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("nav.org")}</div>
        <div className="mt-1 text-sm text-muted">{t("org.subtitle")}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("org.createTitle")}</CardTitle>
            <CardDescription>{t("org.createDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="orgName">{t("org.nameLabel")}</Label>
              <Input id="orgName" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="orgSlug">{t("org.slugLabel")}</Label>
              <Input id="orgSlug" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
            </div>
            <Button variant="accent" onClick={createOrganization}>
              {t("org.createAction")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("org.inviteTitle")}</CardTitle>
            <CardDescription>{t("org.inviteDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="orgNameActive">{t("org.active")}</Label>
              <Input id="orgNameActive" value={activeOrgName || t("org.noActive")} readOnly />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inviteEmail">{t("org.inviteEmailLabel")}</Label>
              <Input id="inviteEmail" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            </div>
            <Button onClick={inviteMember}>{t("org.inviteAction")}</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("org.recent")}</CardTitle>
          <CardDescription>{t("org.recentDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {recentOrgs.length === 0 ? <div className="text-sm text-muted">{t("org.noRecent")}</div> : null}
          {recentOrgs.map((org) => (
            <Button key={org.id} variant={org.id === activeOrgId ? "accent" : "outline"} onClick={() => setActiveOrgId(org.id)}>
              {org.name}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
