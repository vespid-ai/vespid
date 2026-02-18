"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { useSession } from "../../../../lib/hooks/use-session";
import { useMe } from "../../../../lib/hooks/use-me";
import { apiFetchJson, ApiError } from "../../../../lib/api";

type AdminTab = "governance" | "risk" | "observability" | "tickets";

export default function AdminPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const authSession = useSession();
  const meQuery = useMe(Boolean(authSession.data?.session));
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<AdminTab>("governance");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [riskPolicyText, setRiskPolicyText] = useState("{}");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketContent, setTicketContent] = useState("");

  const canAccess = Boolean(meQuery.data?.account?.isSystemAdmin);

  useEffect(() => {
    if (authSession.isLoading || meQuery.isLoading) return;
    if (!authSession.data?.session || !canAccess) {
      router.replace(`/${locale}/conversations`);
    }
  }, [authSession.data?.session, authSession.isLoading, canAccess, locale, meQuery.isLoading, router]);

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    enabled: canAccess,
    queryFn: () => apiFetchJson<{ settings: Array<{ key: string; value: unknown }> }>("/v1/admin/platform/settings"),
  });

  const systemAdminsQuery = useQuery({
    queryKey: ["admin", "system-admins"],
    enabled: canAccess,
    queryFn: () =>
      apiFetchJson<{ systemAdmins: Array<{ userId: string; user: { email: string } | null }> }>("/v1/admin/system-admins"),
  });

  const riskPoliciesQuery = useQuery({
    queryKey: ["admin", "risk-policies"],
    enabled: canAccess && tab === "risk",
    queryFn: () => apiFetchJson<{ policy: unknown }>("/v1/admin/risk/policies"),
  });

  const riskIncidentsQuery = useQuery({
    queryKey: ["admin", "risk-incidents"],
    enabled: canAccess && tab === "risk",
    queryFn: () => apiFetchJson<{ incidents: unknown }>("/v1/admin/risk/incidents"),
  });

  const healthQuery = useQuery({
    queryKey: ["admin", "health"],
    enabled: canAccess && tab === "observability",
    queryFn: () => apiFetchJson<{ services: Array<{ name: string; status: string }> }>("/v1/admin/observability/health"),
  });

  const metricsQuery = useQuery({
    queryKey: ["admin", "metrics"],
    enabled: canAccess && tab === "observability",
    queryFn: () => apiFetchJson<{ metrics: unknown }>("/v1/admin/observability/metrics"),
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "logs"],
    enabled: canAccess && tab === "observability",
    queryFn: () => apiFetchJson<{ logs: unknown }>("/v1/admin/observability/logs"),
  });

  const ticketsQuery = useQuery({
    queryKey: ["admin", "tickets"],
    enabled: canAccess && tab === "tickets",
    queryFn: () => apiFetchJson<{ tickets: Array<{ id: string; subject: string; status: string; priority: string; updatedAt: string }> }>("/v1/admin/tickets"),
  });

  const addAdminMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiFetchJson<{ role: { userId: string } }>("/v1/admin/system-admins", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      setNewAdminEmail("");
      toast.success(t("common.saved"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "system-admins"] });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.payload?.message ?? error.message : t("common.unknownError");
      toast.error(message);
    },
  });

  const saveRiskPolicyMutation = useMutation({
    mutationFn: async (raw: string) => {
      const parsed = JSON.parse(raw);
      return apiFetchJson("/v1/admin/risk/policies", {
        method: "PUT",
        body: JSON.stringify(parsed),
      });
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "risk-policies"] });
    },
    onError: () => toast.error(t("common.unknownError")),
  });

  const createTicketMutation = useMutation({
    mutationFn: async (input: { subject: string; content: string }) => {
      return apiFetchJson("/v1/admin/tickets", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      setTicketSubject("");
      setTicketContent("");
      toast.success(t("common.created"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "tickets"] });
    },
    onError: () => toast.error(t("common.unknownError")),
  });

  useEffect(() => {
    if (riskPoliciesQuery.data) {
      setRiskPolicyText(JSON.stringify(riskPoliciesQuery.data.policy ?? {}, null, 2));
    }
  }, [riskPoliciesQuery.data]);

  const settingsByKey = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const row of settingsQuery.data?.settings ?? []) {
      map.set(row.key, row.value);
    }
    return map;
  }, [settingsQuery.data?.settings]);

  if (!authSession.data?.session || !canAccess) {
    return (
      <div className="grid gap-4">
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("admin.title")}</div>
        <div className="text-sm text-muted">{t("home.redirecting")}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("admin.title")}</div>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as AdminTab)} className="grid gap-4">
        <TabsList className="grid w-full grid-cols-2 gap-2 md:grid-cols-4">
          <TabsTrigger value="governance">{t("admin.tabs.governance")}</TabsTrigger>
          <TabsTrigger value="risk">{t("admin.tabs.risk")}</TabsTrigger>
          <TabsTrigger value="observability">{t("admin.tabs.observability")}</TabsTrigger>
          <TabsTrigger value="tickets">{t("admin.tabs.tickets")}</TabsTrigger>
        </TabsList>

        <TabsContent value="governance" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.governance.orgPolicy")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              <pre className="overflow-auto rounded border border-borderSubtle bg-panel/40 p-3">
                {JSON.stringify(settingsByKey.get("org_policy") ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("admin.governance.systemAdmins")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  value={newAdminEmail}
                  onChange={(event) => setNewAdminEmail(event.target.value)}
                  placeholder={t("admin.governance.adminEmailPlaceholder")}
                />
                <Button
                  variant="accent"
                  onClick={() => addAdminMutation.mutate(newAdminEmail.trim())}
                  disabled={newAdminEmail.trim().length === 0 || addAdminMutation.isPending}
                >
                  {t("common.add")}
                </Button>
              </div>
              <div className="grid gap-1 text-sm">
                {(systemAdminsQuery.data?.systemAdmins ?? []).map((admin) => (
                  <div key={admin.userId} className="rounded border border-borderSubtle bg-panel/30 px-3 py-2">
                    {admin.user?.email ?? admin.userId}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.risk.policies")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Textarea value={riskPolicyText} rows={10} onChange={(event) => setRiskPolicyText(event.target.value)} />
              <div className="flex justify-end">
                <Button variant="accent" onClick={() => saveRiskPolicyMutation.mutate(riskPolicyText)} disabled={saveRiskPolicyMutation.isPending}>
                  {t("common.save")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("admin.risk.incidents")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
                {JSON.stringify(riskIncidentsQuery.data?.incidents ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="observability" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.observability.health")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {(healthQuery.data?.services ?? []).map((svc) => (
                <div key={svc.name} className="flex items-center justify-between rounded border border-borderSubtle bg-panel/30 px-3 py-2">
                  <span>{svc.name}</span>
                  <span className="text-muted">{svc.status}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("admin.observability.metrics")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
                {JSON.stringify(metricsQuery.data?.metrics ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("admin.observability.logs")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
                {JSON.stringify(logsQuery.data?.logs ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tickets" className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.tickets.create")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Input value={ticketSubject} onChange={(event) => setTicketSubject(event.target.value)} placeholder={t("admin.tickets.subject")} />
              <Textarea value={ticketContent} onChange={(event) => setTicketContent(event.target.value)} rows={5} placeholder={t("admin.tickets.content")} />
              <div className="flex justify-end">
                <Button
                  variant="accent"
                  onClick={() => createTicketMutation.mutate({ subject: ticketSubject.trim(), content: ticketContent.trim() })}
                  disabled={ticketSubject.trim().length === 0 || ticketContent.trim().length === 0 || createTicketMutation.isPending}
                >
                  {t("common.create")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("admin.tickets.list")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {(ticketsQuery.data?.tickets ?? []).map((ticket) => (
                <div key={ticket.id} className="rounded border border-borderSubtle bg-panel/30 px-3 py-2">
                  <div className="font-medium">{ticket.subject}</div>
                  <div className="text-xs text-muted">
                    {ticket.status} / {ticket.priority}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
