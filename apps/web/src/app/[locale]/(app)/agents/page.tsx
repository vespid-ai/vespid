"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { CommandBlock } from "../../../../components/ui/command-block";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Separator } from "../../../../components/ui/separator";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { useActiveOrgName } from "../../../../lib/hooks/use-active-org-name";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import {
  useAgents,
  useAgentInstaller,
  useCreatePairingToken,
  useDeleteAgent,
  useRevokeAgent,
  useUpdateAgentTags,
} from "../../../../lib/hooks/use-agents";
import { getApiBase, isUnauthorizedError } from "../../../../lib/api";

const DEFAULT_NODE_AGENT_CONNECT_TEMPLATE =
  'npx -y @vespid/node-agent@latest connect --pairing-token "<pairing-token>" --api-base "<api-base>"';
const DEFAULT_NODE_AGENT_START_COMMAND = "npx -y @vespid/node-agent@latest start";

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized.includes("active") || normalized.includes("online")) return "ok";
  if (normalized.includes("revoked") || normalized.includes("disabled")) return "danger";
  if (normalized.includes("stale") || normalized.includes("unknown")) return "warn";
  return "neutral";
}

function normalizeNodeAgentApiBase(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "localhost") {
      url.hostname = "127.0.0.1";
      return url.toString().replace(/\/$/, "");
    }
    return value;
  } catch {
    return value;
  }
}

function buildConnectCommand(input: { template: string; pairingToken: string; apiBase: string }): string {
  return input.template
    .replaceAll("<pairing-token>", input.pairingToken)
    .replaceAll("<api-base>", normalizeNodeAgentApiBase(input.apiBase));
}

export default function AgentsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const { orgId, orgName } = useActiveOrgName();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const agentsQuery = useAgents(scopedOrgId);
  const installerQuery = useAgentInstaller();
  const pairing = useCreatePairingToken(scopedOrgId);
  const revoke = useRevokeAgent(scopedOrgId);
  const deleteAgent = useDeleteAgent(scopedOrgId);
  const updateTags = useUpdateAgentTags(scopedOrgId);

  const agents = agentsQuery.data?.agents ?? [];

  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [tagsDraftByAgentId, setTagsDraftByAgentId] = useState<Record<string, string>>({});

  const canOperate = Boolean(scopedOrgId);
  const apiBase = getApiBase();

  const pairingExpiresMs = pairingExpiresAt ? Date.parse(pairingExpiresAt) : NaN;
  const pairingTokenExpired =
    Boolean(pairingToken) && Number.isFinite(pairingExpiresMs) && pairingExpiresMs <= Date.now();
  const resolvedPairingToken = !pairingToken || pairingTokenExpired ? "<pairing-token>" : pairingToken;
  const hasUsablePairingToken = resolvedPairingToken !== "<pairing-token>";

  const installerCommands = installerQuery.data?.commands ?? null;
  const showInstallerUnavailable = !installerQuery.isLoading && !installerCommands;
  const connectCommand = buildConnectCommand({
    template: installerCommands?.connect ?? DEFAULT_NODE_AGENT_CONNECT_TEMPLATE,
    pairingToken: resolvedPairingToken,
    apiBase,
  });
  const startCommand = installerCommands?.start ?? DEFAULT_NODE_AGENT_START_COMMAND;
  const isZh = locale.toLowerCase().startsWith("zh");
  const startCommandLabel = isZh ? "后续重启命令" : "Restart command";
  const installerDeliveryText =
    installerQuery.data?.delivery === "local-dev" ? t("agents.installer.deliveryLocalDev") : t("agents.installer.deliveryNpm");

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
          const isRevoked = typeof agent.revokedAt === "string" || String(agent.status).toLowerCase() === "revoked";
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
              {!isRevoked ? (
                <ConfirmButton
                  title="Revoke worker node"
                  description="This will prevent the worker node from executing future jobs."
                  confirmText={t("agents.revoke")}
                  onConfirm={async () => {
                    await revoke.mutateAsync(agent.id);
                    toast.success(t("agents.agentRevoked"));
                  }}
                >
                  {t("agents.revoke")}
                </ConfirmButton>
              ) : null}
              {isRevoked ? (
                <ConfirmButton
                  title="Delete revoked worker node"
                  description="This permanently removes the revoked worker node from this organization."
                  confirmText={t("common.delete")}
                  onConfirm={async () => {
                    await deleteAgent.mutateAsync(agent.id);
                    toast.success(t("agents.agentDeleted"));
                  }}
                >
                  {t("common.delete")}
                </ConfirmButton>
              ) : null}
            </div>
          );
        },
      },
    ] as const;
  }, [canOperate, deleteAgent, revoke, scopedOrgId, t, tagsDraftByAgentId, updateTags]);

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
              <div className="grid gap-2 rounded-xl border border-borderSubtle bg-panel/35 p-3">
                <div className="text-xs font-medium text-text">{t("agents.pairing")}</div>
                <div className="font-mono text-xs leading-5 text-text break-all">{pairingToken}</div>
                {pairingExpiresAt ? <div className="text-xs text-muted">{pairingExpiresAt}</div> : null}
              </div>
            </>
          ) : null}

          <Separator />

          <div className="grid gap-3">
            <div>
              <div className="text-sm font-semibold text-text">{t("agents.installer.title")}</div>
              <div className="mt-1 text-xs text-muted">{t("agents.installer.subtitle")}</div>
            </div>

            {installerQuery.isLoading ? (
              <div className="text-xs text-muted">{t("common.loading")}</div>
            ) : null}

            {!installerQuery.isLoading ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{`${installerQuery.data?.packageName ?? "@vespid/node-agent"}@${installerQuery.data?.distTag ?? "latest"}`}</span>
                  {installerQuery.data?.docsUrl ? (
                    <a href={installerQuery.data.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {t("agents.installer.docs")}
                    </a>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted">{t("agents.installer.connectCommand")}</div>
                  <CommandBlock command={connectCommand} copyLabel={t("agents.installer.copyConnect")} />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted">{startCommandLabel}</div>
                  <CommandBlock command={startCommand} copyLabel={startCommandLabel} />
                </div>
                <div className="rounded-md border border-borderSubtle/70 bg-panel/45 p-2 text-xs text-muted">{installerDeliveryText}</div>
                {installerQuery.data?.fallbackReason ? (
                  <div className="text-xs text-muted">{`fallback: ${installerQuery.data.fallbackReason}`}</div>
                ) : null}
              </div>
            ) : null}

            {showInstallerUnavailable ? (
              <div className="grid gap-2 rounded-xl border border-borderSubtle bg-panel/35 p-3">
                <div className="text-xs font-medium text-text">{t("agents.installer.fallbackTitle")}</div>
                <div className="text-xs text-muted">{t("agents.installer.fallbackDescription")}</div>
                <div className="text-xs text-muted">{t("agents.installer.fallbackUsingDefaults")}</div>
                {installerQuery.data?.docsUrl ? (
                  <a
                    href={installerQuery.data.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline underline-offset-2"
                  >
                    {t("agents.installer.docs")}
                  </a>
                ) : null}
              </div>
            ) : null}

            {!hasUsablePairingToken ? (
              <div className="rounded-md border border-warn/35 bg-warn/10 p-2 text-xs text-warn">
                {pairingTokenExpired ? t("agents.installer.tokenExpired") : t("agents.installer.tokenMissing")}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("common.list")}</CardTitle>
          <CardDescription>{orgName ?? t("org.requireActive")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refresh}>{t("common.refresh")}</Button>
            <div className="ml-auto text-xs text-muted">
              {agentsQuery.isFetching ? t("common.loading") : `${agents.length} worker node(s)`}
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
              Failed to load worker nodes.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
