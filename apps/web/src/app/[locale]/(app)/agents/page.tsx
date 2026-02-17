"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Separator } from "../../../../components/ui/separator";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useAgents, useCreatePairingToken, useRevokeAgent, useUpdateAgentTags } from "../../../../lib/hooks/use-agents";
import { isUnauthorizedError } from "../../../../lib/api";

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized.includes("active") || normalized.includes("online")) return "ok";
  if (normalized.includes("revoked") || normalized.includes("disabled")) return "danger";
  if (normalized.includes("stale") || normalized.includes("unknown")) return "warn";
  return "neutral";
}

export default function AgentsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const agentsQuery = useAgents(scopedOrgId);
  const pairing = useCreatePairingToken(scopedOrgId);
  const revoke = useRevokeAgent(scopedOrgId);
  const updateTags = useUpdateAgentTags(scopedOrgId);

  const agents = agentsQuery.data?.agents ?? [];

  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [tagsDraftByAgentId, setTagsDraftByAgentId] = useState<Record<string, string>>({});

  const canOperate = Boolean(scopedOrgId);

  const columns = useMemo(() => {
    return [
      {
        header: t("agents.table.agent"),
        accessorKey: "id",
        cell: ({ row }: any) => {
          const agent = row.original;
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-text">{agent.name ?? agent.id.slice(0, 8)}</div>
              <div className="truncate font-mono text-xs text-muted">{agent.id}</div>
              {agent.reportedTags && agent.reportedTags.length > 0 ? (
                <div className="mt-1 truncate text-[11px] text-muted">reported: {agent.reportedTags.join(", ")}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        header: t("agents.table.status"),
        accessorKey: "status",
        cell: ({ row }: any) => <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge>,
      },
      {
        header: t("agents.table.lastSeen"),
        accessorKey: "lastSeenAt",
        cell: ({ row }: any) => <span className="text-muted">{row.original.lastSeenAt ?? "-"}</span>,
      },
      {
        header: t("agents.table.created"),
        accessorKey: "createdAt",
        cell: ({ row }: any) => <span className="text-muted">{row.original.createdAt ?? "-"}</span>,
      },
      {
        header: t("agents.table.tags"),
        id: "tags",
        cell: ({ row }: any) => {
          const agent = row.original;
          const draft = tagsDraftByAgentId[agent.id] ?? (agent.tags ?? []).join(",");
          return (
            <div className="flex min-w-[340px] flex-wrap items-center gap-2">
              <Input
                className="h-8 text-xs"
                placeholder="e.g. west,group:alpha"
                value={draft}
                onChange={(e) =>
                  setTagsDraftByAgentId((prev) => ({
                    ...prev,
                    [agent.id]: e.target.value,
                  }))
                }
              />
              <Button
                size="sm"
                onClick={async () => {
                  if (!scopedOrgId) return;
                  const raw = (tagsDraftByAgentId[agent.id] ?? (agent.tags ?? []).join(",")).trim();
                  const tags = raw
                    .split(",")
                    .map((tag: string) => tag.trim())
                    .filter((tag: string) => tag.length > 0);
                  await updateTags.mutateAsync({ agentId: agent.id, tags });
                  toast.success(t("agents.tagsUpdated"));
                }}
                disabled={!canOperate || updateTags.isPending}
              >
                {t("common.save")}
              </Button>
              <ConfirmButton
                title="Revoke agent"
                description="This will prevent the agent from executing future jobs."
                confirmText={t("agents.revoke")}
                onConfirm={async () => {
                  await revoke.mutateAsync(agent.id);
                  toast.success(t("agents.agentRevoked"));
                }}
              >
                {t("agents.revoke")}
              </ConfirmButton>
            </div>
          );
        },
      },
    ] as const;
  }, [canOperate, revoke, scopedOrgId, t, tagsDraftByAgentId, updateTags]);

  async function refresh() {
    if (!canOperate) {
      toast.error(t("org.requireActive"));
      return;
    }
    await agentsQuery.refetch();
  }

  async function createPairingToken() {
    if (!canOperate) {
      toast.error(t("org.requireActive"));
      return;
    }
    const payload = await pairing.mutateAsync();
    setPairingToken(payload.token);
    setPairingExpiresAt(payload.expiresAt);
    toast.success(t("agents.pairingCreated"));
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("agents.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("agents.subtitle")}</div>
        </div>
        <AuthRequiredState locale={locale} onRetry={() => void agentsQuery.refetch()} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("agents.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("agents.subtitle")}</div>
        </div>
        <EmptyState
          title={t("org.requireActive")}
          action={
            <Button variant="accent" onClick={() => router.push(`/${locale}/org`)}>
              {t("onboarding.goOrg")}
            </Button>
          }
        />
      </div>
    );
  }

  if (agentsQuery.isError && isUnauthorizedError(agentsQuery.error)) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("agents.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("agents.subtitle")}</div>
        </div>
        <AuthRequiredState locale={locale} onRetry={() => void agentsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("agents.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("agents.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("agents.pairing")}</CardTitle>
          <CardDescription>{t("agents.pairingHint")}</CardDescription>
        </CardHeader>
          <CardContent className="grid gap-3">
          <div className="grid gap-2 rounded-xl border border-borderSubtle bg-panel/35 p-3">
            <div className="text-sm font-medium text-text">{t("agents.pairingSteps.step1")}</div>
            <div className="text-xs text-muted">{t("agents.pairingSteps.step2")}</div>
            <div className="text-xs text-muted">{t("agents.pairingSteps.step3")}</div>
          </div>
          <Button variant="accent" onClick={createPairingToken} disabled={!canOperate || pairing.isPending}>
            {t("agents.createPairingToken")}
          </Button>
          {pairingToken ? (
            <>
              <Separator />
              <CodeBlock value={{ token: pairingToken, expiresAt: pairingExpiresAt }} />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.list")}</CardTitle>
          <CardDescription>{orgId ? `Org: ${orgId}` : t("org.requireActive")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refresh}>{t("common.refresh")}</Button>
            <div className="ml-auto text-xs text-muted">
              {agentsQuery.isFetching ? t("common.loading") : `${agents.length} agent(s)`}
            </div>
          </div>

          <div className="mt-4">
            {agentsQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : agents.length === 0 ? (
              <EmptyState
                title={t("agents.noAgentsTitle")}
                description={t("agents.noAgentsDescription")}
                action={
                  <Button variant="accent" onClick={createPairingToken} disabled={!canOperate || pairing.isPending}>
                    {t("agents.createPairingToken")}
                  </Button>
                }
              />
            ) : (
              <DataTable data={agents} columns={columns as any} />
            )}
          </div>

          {agentsQuery.isError ? (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              Failed to load agents.
            </div>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}
