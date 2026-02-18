"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { useActiveOrgName } from "../../../../lib/hooks/use-active-org-name";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import {
  useAgents,
  useAgentInstaller,
  useCreatePairingToken,
  useRevokeAgent,
  useUpdateAgentTags,
  type AgentInstallerArtifact,
} from "../../../../lib/hooks/use-agents";
import { getApiBase, isUnauthorizedError } from "../../../../lib/api";

type PlatformId = "darwin-arm64" | "linux-x64" | "windows-x64";

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized.includes("active") || normalized.includes("online")) return "ok";
  if (normalized.includes("revoked") || normalized.includes("disabled")) return "danger";
  if (normalized.includes("stale") || normalized.includes("unknown")) return "warn";
  return "neutral";
}

function detectPreferredPlatform(): PlatformId {
  if (typeof navigator === "undefined") {
    return "darwin-arm64";
  }
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac") || ua.includes("mac")) {
    if (platform.includes("arm") || ua.includes("arm64") || ua.includes("apple")) {
      return "darwin-arm64";
    }
    return "darwin-arm64";
  }
  if (platform.includes("win") || ua.includes("windows")) {
    return "windows-x64";
  }
  return "linux-x64";
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function buildDownloadCommand(artifact: AgentInstallerArtifact): string {
  if (artifact.platformId === "windows-x64") {
    return [
      `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${artifact.downloadUrl}' -OutFile '${artifact.fileName}'; Expand-Archive -Path '${artifact.fileName}' -DestinationPath . -Force"`,
    ].join("\n");
  }
  return [
    `curl -fsSL ${shellQuote(artifact.downloadUrl)} -o ${shellQuote(artifact.fileName)}`,
    `tar -xzf ${shellQuote(artifact.fileName)}`,
    "chmod +x ./vespid-agent",
  ].join("\n");
}

function buildConnectCommand(input: { artifact: AgentInstallerArtifact; pairingToken: string; apiBase: string }): string {
  const executable = input.artifact.platformId === "windows-x64" ? ".\\vespid-agent.exe" : "./vespid-agent";
  return `${executable} connect --pairing-token ${shellQuote(input.pairingToken)} --api-base ${shellQuote(input.apiBase)}`;
}

function buildStartCommand(artifact: AgentInstallerArtifact): string {
  const executable = artifact.platformId === "windows-x64" ? ".\\vespid-agent.exe" : "./vespid-agent";
  return `${executable} start`;
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
  const updateTags = useUpdateAgentTags(scopedOrgId);

  const agents = agentsQuery.data?.agents ?? [];

  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [platformId, setPlatformId] = useState<PlatformId>(() => detectPreferredPlatform());
  const [tagsDraftByAgentId, setTagsDraftByAgentId] = useState<Record<string, string>>({});

  const canOperate = Boolean(scopedOrgId);
  const apiBase = getApiBase();

  const pairingExpiresMs = pairingExpiresAt ? Date.parse(pairingExpiresAt) : NaN;
  const pairingTokenExpired =
    Boolean(pairingToken) && Number.isFinite(pairingExpiresMs) && pairingExpiresMs <= Date.now();
  const resolvedPairingToken = !pairingToken || pairingTokenExpired ? "<pairing-token>" : pairingToken;
  const hasUsablePairingToken = resolvedPairingToken !== "<pairing-token>";

  const installerArtifacts = installerQuery.data?.artifacts ?? [];
  const installerByPlatform = useMemo(() => {
    const map = new Map<PlatformId, AgentInstallerArtifact>();
    for (const artifact of installerArtifacts) {
      map.set(artifact.platformId, artifact);
    }
    return map;
  }, [installerArtifacts]);

  useEffect(() => {
    const hasSelected = installerByPlatform.has(platformId);
    if (hasSelected) {
      return;
    }
    const first = installerArtifacts[0];
    if (first) {
      setPlatformId(first.platformId);
    }
  }, [installerByPlatform, installerArtifacts, platformId]);

  const activeArtifact = installerByPlatform.get(platformId) ?? null;
  const showInstallerCommands = Boolean(activeArtifact);
  const showInstallerUnavailable = !installerQuery.isLoading && !showInstallerCommands;
  const downloadCommand = activeArtifact ? buildDownloadCommand(activeArtifact) : "";
  const connectCommand = activeArtifact
    ? buildConnectCommand({ artifact: activeArtifact, pairingToken: resolvedPairingToken, apiBase })
    : "";
  const startCommand = activeArtifact ? buildStartCommand(activeArtifact) : "";
  const isZh = locale.toLowerCase().startsWith("zh");
  const startCommandLabel = isZh ? "后续重启命令" : "Restart command";

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

            <Tabs value={platformId} onValueChange={(value) => setPlatformId(value as PlatformId)}>
              <TabsList>
                <TabsTrigger value="darwin-arm64">
                  {t("agents.installer.platforms.darwinArm64")}
                </TabsTrigger>
                <TabsTrigger value="linux-x64">
                  {t("agents.installer.platforms.linuxX64")}
                </TabsTrigger>
                <TabsTrigger value="windows-x64">
                  {t("agents.installer.platforms.windowsX64")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {installerQuery.isLoading ? (
              <div className="text-xs text-muted">{t("common.loading")}</div>
            ) : null}

            {showInstallerCommands ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{t("agents.installer.channel", { channel: installerQuery.data?.channel ?? "latest" })}</span>
                  {installerQuery.data?.checksumsUrl ? (
                    <a
                      href={installerQuery.data.checksumsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {t("agents.installer.checksums")}
                    </a>
                  ) : null}
                  {installerQuery.data?.docsUrl ? (
                    <a href={installerQuery.data.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {t("agents.installer.docs")}
                    </a>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted">{t("agents.installer.downloadCommand")}</div>
                  <CommandBlock command={downloadCommand} copyLabel={t("agents.installer.copyDownload")} />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted">{t("agents.installer.connectCommand")}</div>
                  <CommandBlock command={connectCommand} copyLabel={t("agents.installer.copyConnect")} />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted">{startCommandLabel}</div>
                  <CommandBlock command={startCommand} copyLabel={startCommandLabel} />
                </div>
                {activeArtifact ? (
                  <div className="flex justify-start">
                    <Button asChild size="sm" variant="outline">
                      <a href={activeArtifact.downloadUrl} target="_blank" rel="noreferrer">
                        {t("agents.installer.downloadButton")}
                      </a>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showInstallerUnavailable ? (
              <div className="grid gap-2 rounded-xl border border-borderSubtle bg-panel/35 p-3">
                <div className="text-xs font-medium text-text">{t("agents.installer.fallbackTitle")}</div>
                <div className="text-xs text-muted">{t("agents.installer.fallbackDescription")}</div>
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
