"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listAgentEngines, type AgentEngineMeta } from "@vespid/shared";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { apiFetchJson, isUnauthorizedError } from "../../../../lib/api";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useCreateSecret, useDeleteSecret, useRotateSecret, useSecrets } from "../../../../lib/hooks/use-secrets";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";

type EngineId = "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2";
type EngineAuthMode = "oauth_executor" | "api_key";

type EngineAuthStatusResponse = {
  organizationId: string;
  engines: Record<
    EngineId,
    {
      onlineExecutors: number;
      verifiedCount: number;
      unverifiedCount: number;
      executors: Array<{
        executorId: string;
        name: string;
        verified: boolean;
        checkedAt: string;
        reason: string;
      }>;
    }
  >;
};

function findDefaultSecret(
  secretsByConnector: Map<string, Array<{ id: string; name: string; connectorId: string }>>,
  connectorId: string
) {
  const all = secretsByConnector.get(connectorId) ?? [];
  return all.find((secret) => secret.name === "default") ?? all[0] ?? null;
}

function defaultEngineMode(engineId: EngineId): EngineAuthMode {
  return engineId === "gateway.opencode.v2" ? "api_key" : "oauth_executor";
}

function isEngineId(value: string): value is EngineId {
  return value === "gateway.codex.v2" || value === "gateway.claude.v2" || value === "gateway.opencode.v2";
}

export default function ModelConnectionsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const secretsQuery = useSecrets(scopedOrgId);
  const createSecret = useCreateSecret(scopedOrgId);
  const rotateSecret = useRotateSecret(scopedOrgId);
  const deleteSecret = useDeleteSecret(scopedOrgId);
  const settingsQuery = useOrgSettings(scopedOrgId);
  const updateOrgSettings = useUpdateOrgSettings(scopedOrgId);

  const enginesQuery = useQuery({
    queryKey: ["agent-engines"],
    enabled: Boolean(scopedOrgId),
    queryFn: async () => {
      return apiFetchJson<{ engines: AgentEngineMeta[] }>("/v1/agent/engines", { method: "GET" });
    },
    staleTime: 60_000,
  });

  const engineAuthStatusQuery = useQuery({
    queryKey: ["engine-auth-status", scopedOrgId],
    enabled: Boolean(scopedOrgId),
    queryFn: async () => {
      return apiFetchJson<EngineAuthStatusResponse>(`/v1/orgs/${scopedOrgId}/engines/auth-status`, { method: "GET" }, { orgScoped: true });
    },
    refetchInterval: 30_000,
  });

  const engines = useMemo(() => {
    const remote = enginesQuery.data?.engines ?? [];
    return remote.length > 0 ? remote : listAgentEngines();
  }, [enginesQuery.data?.engines]);

  const secretsByConnector = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; connectorId: string }>>();
    for (const secret of secretsQuery.data?.secrets ?? []) {
      const existing = map.get(secret.connectorId) ?? [];
      existing.push({ id: secret.id, name: secret.name, connectorId: secret.connectorId });
      map.set(secret.connectorId, existing);
    }
    return map;
  }, [secretsQuery.data?.secrets]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const unauthorized =
    (secretsQuery.isError && isUnauthorizedError(secretsQuery.error)) ||
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error)) ||
    (engineAuthStatusQuery.isError && isUnauthorizedError(engineAuthStatusQuery.error));

  async function updateEngineDefaultMode(input: { engineId: EngineId; mode: EngineAuthMode; secretId: string | null }) {
    if (!scopedOrgId) return;
    await updateOrgSettings.mutateAsync({
      agents: {
        engineAuthDefaults: {
          [input.engineId]: {
            mode: input.mode,
            secretId: input.mode === "api_key" ? input.secretId : null,
          },
        },
      },
    } as any);
  }

  async function saveEngineSecret(engine: AgentEngineMeta) {
    if (!scopedOrgId || !isEngineId(engine.id)) return;
    const value = (drafts[engine.id] ?? "").trim();
    if (!value) {
      toast.error("API key is required.");
      return;
    }

    const connected = findDefaultSecret(secretsByConnector, engine.defaultSecretConnectorId);
    try {
      let savedSecretId = connected?.id ?? null;
      if (connected) {
        await rotateSecret.mutateAsync({ secretId: connected.id, value });
      } else {
        const created = (await createSecret.mutateAsync({
          connectorId: engine.defaultSecretConnectorId,
          name: "default",
          value,
        })) as { secret?: { id?: string } };
        savedSecretId = created?.secret?.id ?? null;
      }
      await updateEngineDefaultMode({
        engineId: engine.id,
        mode: "api_key",
        secretId: savedSecretId,
      });
      setDrafts((prev) => ({ ...prev, [engine.id]: "" }));
      await secretsQuery.refetch();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function disconnectEngineSecret(engine: AgentEngineMeta) {
    if (!isEngineId(engine.id)) return;
    const connected = findDefaultSecret(secretsByConnector, engine.defaultSecretConnectorId);
    if (!connected) return;
    try {
      await deleteSecret.mutateAsync(connected.id);
      await updateEngineDefaultMode({
        engineId: engine.id,
        mode: "api_key",
        secretId: null,
      });
      await secretsQuery.refetch();
      toast.success(t("common.deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function switchEngineMode(engine: AgentEngineMeta, mode: EngineAuthMode) {
    if (!isEngineId(engine.id)) return;
    const connected = findDefaultSecret(secretsByConnector, engine.defaultSecretConnectorId);
    try {
      await updateEngineDefaultMode({
        engineId: engine.id,
        mode,
        secretId: connected?.id ?? null,
      });
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
        </div>
        <AuthRequiredState locale={locale} onRetry={() => void secretsQuery.refetch()} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
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

  if (unauthorized) {
    return <AuthRequiredState locale={locale} onRetry={() => void secretsQuery.refetch()} />;
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>BYON only</CardTitle>
          <CardDescription>
            Sessions and workflows run only on BYON executors. Install and login with the corresponding CLI on each executor host.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {engines.map((engine) => {
          if (!isEngineId(engine.id)) {
            return null;
          }
          const connectedSecret = findDefaultSecret(secretsByConnector, engine.defaultSecretConnectorId);
          const configuredModeRaw = settingsQuery.data?.settings?.agents?.engineAuthDefaults?.[engine.id]?.mode;
          const mode: EngineAuthMode =
            configuredModeRaw === "api_key" || configuredModeRaw === "oauth_executor"
              ? configuredModeRaw
              : defaultEngineMode(engine.id);
          const authStatus = engineAuthStatusQuery.data?.engines?.[engine.id];
          const oauthConnected = (authStatus?.verifiedCount ?? 0) > 0;
          const connected = mode === "api_key" ? Boolean(connectedSecret) : oauthConnected;
          const draft = drafts[engine.id] ?? "";
          const oauthAvailable = engine.id === "gateway.codex.v2" || engine.id === "gateway.claude.v2";

          return (
            <Card key={engine.id} data-testid={`engine-card-${engine.id}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{engine.displayName}</CardTitle>
                  <Badge variant={connected ? "ok" : "neutral"}>
                    {connected ? t("models.connections.connected") : t("models.connections.notConnected")}
                  </Badge>
                </div>
                <CardDescription>{engine.id}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="text-xs text-muted">
                  CLI: <code>{engine.cliCommand}</code>
                </div>
                <div className="text-xs text-muted">
                  Default model: <code>{engine.defaultModel}</code>
                </div>
                <div className="text-xs text-muted">
                  Secret connector: <code>{engine.defaultSecretConnectorId}</code>
                </div>

                <div className="grid gap-2">
                  <Label>Auth mode</Label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={mode === "oauth_executor" ? "accent" : "outline"}
                      onClick={() => void switchEngineMode(engine, "oauth_executor")}
                      disabled={!oauthAvailable || updateOrgSettings.isPending}
                    >
                      OAuth account
                    </Button>
                    <Button
                      size="sm"
                      variant={mode === "api_key" ? "accent" : "outline"}
                      onClick={() => void switchEngineMode(engine, "api_key")}
                      disabled={updateOrgSettings.isPending}
                    >
                      API key
                    </Button>
                  </div>
                </div>

                {mode === "api_key" ? (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor={`engine-secret-${engine.id}`}>API key</Label>
                      <Input
                        id={`engine-secret-${engine.id}`}
                        type="password"
                        placeholder={t("models.connections.apiKeyPlaceholder")}
                        value={draft}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [engine.id]: event.target.value }))}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={() => void saveEngineSecret(engine)}
                        disabled={createSecret.isPending || rotateSecret.isPending || updateOrgSettings.isPending}
                      >
                        {connectedSecret ? t("common.rotate") : t("common.save")}
                      </Button>
                      {connectedSecret ? (
                        <Button variant="outline" size="sm" onClick={() => void disconnectEngineSecret(engine)} disabled={deleteSecret.isPending}>
                          {t("models.connections.disconnect")}
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2 rounded-md border border-borderSubtle/65 bg-panel/55 p-3 text-xs text-muted">
                    {oauthAvailable ? (
                      <>
                        <div>Login on each executor host: <code>{engine.cliCommand} login</code></div>
                        <div>Verification commands: <code>{engine.cliCommand} auth status</code> or <code>{engine.cliCommand} whoami</code></div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                            Recheck
                          </Button>
                        </div>
                        <div>Online executors: {authStatus?.onlineExecutors ?? 0}</div>
                        <div>Verified: {authStatus?.verifiedCount ?? 0}</div>
                        <div>Unverified: {authStatus?.unverifiedCount ?? 0}</div>
                        <div className="grid gap-1">
                          {(authStatus?.executors ?? []).map((executor) => (
                            <div key={`${engine.id}:${executor.executorId}`} className="rounded border border-borderSubtle/55 px-2 py-1">
                              <div className="font-medium text-text">{executor.name}</div>
                              <div>
                                {executor.verified ? "verified" : "unverified"} · {executor.reason}
                              </div>
                              <div>{new Date(executor.checkedAt).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div>OAuth executor verification is only supported for Codex and Claude Code.</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
