"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listAgentEngines, type AgentEngineMeta } from "@vespid/shared";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { ConnectionPathCards } from "../../../../components/app/models/connection-path-cards";
import { EngineConfigStepper } from "../../../../components/app/models/engine-config-stepper";
import { EngineRail } from "../../../../components/app/models/engine-rail";
import { EnterpriseEndpointForm } from "../../../../components/app/models/enterprise-endpoint-form";
import { ExecutorChecklist } from "../../../../components/app/models/executor-checklist";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
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

type EngineViewModel = {
  engine: AgentEngineMeta & { id: EngineId };
  mode: EngineAuthMode;
  runtimeBaseUrl: string | null;
  authStatus: EngineAuthStatusResponse["engines"][EngineId] | undefined;
  connectedSecret: { id: string; name: string; connectorId: string } | null;
  connected: boolean;
  recommendedPath: EngineAuthMode;
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

function isOAuthVerifiedEngine(engineId: EngineId): engineId is "gateway.codex.v2" | "gateway.claude.v2" {
  return engineId === "gateway.codex.v2" || engineId === "gateway.claude.v2";
}

function recommendedPathForEngine(engineId: EngineId): EngineAuthMode {
  return engineId === "gateway.opencode.v2" ? "oauth_executor" : "oauth_executor";
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
    refetchInterval: process.env.NODE_ENV === "test" ? false : 30_000,
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

  const [selectedEngineId, setSelectedEngineId] = useState<EngineId | null>(null);
  const [pathDrafts, setPathDrafts] = useState<Partial<Record<EngineId, EngineAuthMode>>>({});
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Partial<Record<EngineId, string>>>({});
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Partial<Record<EngineId, string>>>({});

  const unauthorized =
    (secretsQuery.isError && isUnauthorizedError(secretsQuery.error)) ||
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error)) ||
    (engineAuthStatusQuery.isError && isUnauthorizedError(engineAuthStatusQuery.error));

  const engineCards = useMemo<EngineViewModel[]>(() => {
    return engines
      .filter((engine): engine is AgentEngineMeta & { id: EngineId } => isEngineId(engine.id))
      .map((engine) => {
        const connectedSecret = findDefaultSecret(secretsByConnector, engine.defaultSecretConnectorId);
        const configuredModeRaw = settingsQuery.data?.settings?.agents?.engineAuthDefaults?.[engine.id]?.mode;
        const mode: EngineAuthMode =
          configuredModeRaw === "api_key" || configuredModeRaw === "oauth_executor"
            ? configuredModeRaw
            : defaultEngineMode(engine.id);
        const configuredBaseUrlRaw = settingsQuery.data?.settings?.agents?.engineRuntimeDefaults?.[engine.id]?.baseUrl;
        const runtimeBaseUrl = typeof configuredBaseUrlRaw === "string" ? configuredBaseUrlRaw : null;

        const authStatus = engineAuthStatusQuery.data?.engines?.[engine.id];
        const connected =
          mode === "api_key"
            ? Boolean(connectedSecret)
            : isOAuthVerifiedEngine(engine.id)
              ? (authStatus?.verifiedCount ?? 0) > 0
              : (authStatus?.onlineExecutors ?? 0) > 0;
        return {
          engine,
          mode,
          runtimeBaseUrl,
          authStatus,
          connectedSecret,
          connected,
          recommendedPath: recommendedPathForEngine(engine.id),
        };
      });
  }, [engines, secretsByConnector, settingsQuery.data?.settings?.agents, engineAuthStatusQuery.data?.engines]);

  useEffect(() => {
    if (selectedEngineId && engineCards.some((item) => item.engine.id === selectedEngineId)) {
      return;
    }
    const first = engineCards[0];
    if (first) {
      setSelectedEngineId(first.engine.id);
    }
  }, [selectedEngineId, engineCards]);

  useEffect(() => {
    if (engineCards.length === 0) return;
    setPathDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const card of engineCards) {
        if (!next[card.engine.id]) {
          next[card.engine.id] = card.mode;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setBaseUrlDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const card of engineCards) {
        if (next[card.engine.id] === undefined) {
          next[card.engine.id] = card.runtimeBaseUrl ?? "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [engineCards]);

  const overview = useMemo(() => {
    const connectedEngines = engineCards.filter((item) => item.connected).length;
    const uniqueExecutors = new Set<string>();
    for (const item of engineCards) {
      for (const executor of item.authStatus?.executors ?? []) {
        uniqueExecutors.add(executor.executorId);
      }
    }
    return {
      connectedEngines,
      totalEngines: engineCards.length,
      onlineExecutors: uniqueExecutors.size,
      pendingItems: Math.max(engineCards.length - connectedEngines, 0),
    };
  }, [engineCards]);

  const orderedEngineIds = useMemo(() => engineCards.map((item) => item.engine.id), [engineCards]);
  const selectedEngine = useMemo(
    () => engineCards.find((item) => item.engine.id === selectedEngineId) ?? engineCards[0] ?? null,
    [engineCards, selectedEngineId]
  );

  function selectedMode(engineId: EngineId): EngineAuthMode {
    return pathDrafts[engineId] ?? defaultEngineMode(engineId);
  }

  async function updateEngineDefaults(input: {
    engineId: EngineId;
    mode: EngineAuthMode;
    secretId: string | null;
    baseUrl: string | null;
  }) {
    if (!scopedOrgId) return;
    await updateOrgSettings.mutateAsync({
      agents: {
        engineAuthDefaults: {
          [input.engineId]: {
            mode: input.mode,
            secretId: input.mode === "api_key" ? input.secretId : null,
          },
        },
        engineRuntimeDefaults: {
          [input.engineId]: {
            baseUrl: input.baseUrl,
          },
        },
      },
    } as any);
  }

  async function saveEngineConfiguration(engineId: EngineId) {
    const item = engineCards.find((card) => card.engine.id === engineId);
    if (!item || !scopedOrgId) return false;

    const mode = selectedMode(engineId);
    const draftApiKey = (apiKeyDrafts[engineId] ?? "").trim();
    const runtimeBaseUrl = (baseUrlDrafts[engineId] ?? "").trim();
    const normalizedBaseUrl = runtimeBaseUrl.length > 0 ? runtimeBaseUrl : null;

    try {
      if (mode === "api_key") {
        const connected = findDefaultSecret(secretsByConnector, item.engine.defaultSecretConnectorId);
        let resolvedSecretId = connected?.id ?? null;

        if (draftApiKey.length > 0) {
          if (connected) {
            await rotateSecret.mutateAsync({ secretId: connected.id, value: draftApiKey });
            resolvedSecretId = connected.id;
          } else {
            const created = (await createSecret.mutateAsync({
              connectorId: item.engine.defaultSecretConnectorId,
              name: "default",
              value: draftApiKey,
            })) as { secret?: { id?: string } };
            resolvedSecretId = created?.secret?.id ?? null;
          }
          setApiKeyDrafts((prev) => ({ ...prev, [engineId]: "" }));
          await secretsQuery.refetch();
        } else if (!connected) {
          toast.error(t("models.connections.apiKeyRequired"));
          return false;
        }

        await updateEngineDefaults({
          engineId,
          mode: "api_key",
          secretId: resolvedSecretId,
          baseUrl: normalizedBaseUrl,
        });
      } else {
        await updateEngineDefaults({
          engineId,
          mode: "oauth_executor",
          secretId: null,
          baseUrl: normalizedBaseUrl,
        });
      }

      toast.success(t("common.saved"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
      return false;
    }
  }

  async function disconnectEngineSecret(engineId: EngineId) {
    const item = engineCards.find((card) => card.engine.id === engineId);
    if (!item) return;
    const connected = findDefaultSecret(secretsByConnector, item.engine.defaultSecretConnectorId);
    if (!connected) return;

    const runtimeBaseUrl = (baseUrlDrafts[engineId] ?? "").trim();
    const normalizedBaseUrl = runtimeBaseUrl.length > 0 ? runtimeBaseUrl : null;

    try {
      await deleteSecret.mutateAsync(connected.id);
      await updateEngineDefaults({
        engineId,
        mode: "api_key",
        secretId: null,
        baseUrl: normalizedBaseUrl,
      });
      await secretsQuery.refetch();
      toast.success(t("common.deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function saveAndSelectNext(engineId: EngineId) {
    const ok = await saveEngineConfiguration(engineId);
    if (!ok) return;
    const currentIdx = orderedEngineIds.findIndex((id) => id === engineId);
    const nextId = currentIdx >= 0 ? orderedEngineIds[currentIdx + 1] : null;
    if (nextId) {
      setSelectedEngineId(nextId);
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

  if (!selectedEngine) {
    return (
      <div className="grid gap-4">
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
        <Card>
          <CardContent className="pt-5 text-sm text-muted">Loading...</CardContent>
        </Card>
      </div>
    );
  }

  const currentMode = selectedMode(selectedEngine.engine.id);
  const selectedEngineIndex = Math.max(orderedEngineIds.findIndex((id) => id === selectedEngine.engine.id), 0);
  const currentApiKey = apiKeyDrafts[selectedEngine.engine.id] ?? "";
  const currentBaseUrl = baseUrlDrafts[selectedEngine.engine.id] ?? selectedEngine.runtimeBaseUrl ?? "";
  const pathRecommended = selectedEngine.recommendedPath;
  const isOauthMode = currentMode === "oauth_executor";
  const isApiKeyMode = currentMode === "api_key";

  const step1Done = true;
  const step2Done = isApiKeyMode ? Boolean(selectedEngine.connectedSecret) : true;
  const step3Done = selectedEngine.connected;

  const steps = [
    {
      id: "select",
      title: t("models.connections.wizard.steps.selectEngine.title"),
      description: t("models.connections.wizard.steps.selectEngine.desc"),
      status: (step1Done ? "done" : "current") as "done" | "current" | "pending",
    },
    {
      id: "config",
      title: t("models.connections.wizard.steps.configure.title"),
      description: t("models.connections.wizard.steps.configure.desc"),
      status: (step2Done ? "done" : "current") as "done" | "current" | "pending",
    },
    {
      id: "verify",
      title: t("models.connections.wizard.steps.verify.title"),
      description: t("models.connections.wizard.steps.verify.desc"),
      status: (step3Done ? "done" : "current") as "done" | "current" | "pending",
    },
  ];

  const executorLines =
    selectedEngine.engine.id === "gateway.opencode.v2"
      ? [
          t("models.connections.opencode.executorManagedNote"),
          t("models.connections.opencode.runtimeNoCustody"),
          t("models.connections.runtime.verificationNotApplicable"),
        ]
      : [
          t("models.connections.runtime.loginOnExecutor", { command: `${selectedEngine.engine.cliCommand} login` }),
          t("models.connections.runtime.verifyCommands", {
            commandA: `${selectedEngine.engine.cliCommand} auth status`,
            commandB: `${selectedEngine.engine.cliCommand} whoami`,
          }),
          t("models.connections.wizard.executorOauthOnly"),
        ];

  const pathItems =
    selectedEngine.engine.id === "gateway.opencode.v2"
      ? [
          {
            id: "oauth_executor" as const,
            title: t("models.connections.methods.executor_profile.label"),
            description: t("models.connections.opencode.executorManagedNote"),
            recommended: pathRecommended === "oauth_executor",
          },
          {
            id: "api_key" as const,
            title: t("models.connections.methods.managed_api_key.label"),
            description: t("models.connections.opencode.apiKeyModeNote"),
            recommended: pathRecommended === "api_key",
          },
        ]
      : [
          {
            id: "oauth_executor" as const,
            title: t("models.connections.methods.executor_oauth.label"),
            description: t("models.connections.wizard.path.oauthDescription"),
            recommended: pathRecommended === "oauth_executor",
          },
          {
            id: "api_key" as const,
            title: t("models.connections.methods.api_key.label"),
            description: t("models.connections.wizard.path.apiKeyDescription"),
            recommended: pathRecommended === "api_key",
          },
        ];

  return (
    <div className="grid gap-5 lg:gap-6" data-testid="model-connections-wizard">
      <Card className="border-borderStrong/55 bg-gradient-to-br from-panel to-panel/70 shadow-elev2">
        <CardHeader className="grid gap-1">
          <CardTitle className="text-2xl">{t("models.connections.wizard.heroTitle")}</CardTitle>
          <CardDescription>{t("models.connections.wizard.heroSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
          <div className="rounded-lg border border-borderSubtle/60 bg-panel/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{t("models.connections.overview.connectedEngines")}</div>
            <div className="mt-1 text-2xl font-semibold text-text">
              {overview.connectedEngines}/{overview.totalEngines}
            </div>
          </div>
          <div className="rounded-lg border border-borderSubtle/60 bg-panel/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{t("models.connections.overview.onlineExecutors")}</div>
            <div className="mt-1 text-2xl font-semibold text-text">{overview.onlineExecutors}</div>
          </div>
          <div className="rounded-lg border border-borderSubtle/60 bg-panel/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{t("models.connections.wizard.pendingItems")}</div>
            <div className="mt-1 text-2xl font-semibold text-text">{overview.pendingItems}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardContent className="pt-5">
            <EngineRail
              items={engineCards.map((item) => ({
                id: item.engine.id,
                displayName: item.engine.displayName,
                recommendedPath:
                  item.engine.id === "gateway.opencode.v2"
                    ? t("models.connections.methods.executor_profile.label")
                    : t("models.connections.methods.executor_oauth.label"),
                connected: item.connected,
                detail: `${item.engine.cliCommand} · ${item.engine.defaultModel}`,
              }))}
              selectedId={selectedEngine.engine.id}
              onSelect={(engineId) => setSelectedEngineId(engineId as EngineId)}
              labels={{
                title: t("models.connections.wizard.engineRailTitle"),
                recommended: t("models.connections.matrix.columns.recommendedPath"),
                connected: t("models.connections.connected"),
                notConnected: t("models.connections.notConnected"),
              }}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card data-testid={`engine-wizard-${selectedEngine.engine.id}`}>
            <CardHeader className="pb-3">
              <div className="grid gap-1">
                <CardTitle className="flex items-center gap-2">
                  {selectedEngine.engine.displayName}
                  <Badge variant={selectedEngine.connected ? "ok" : "neutral"}>
                    {selectedEngine.connected ? t("models.connections.connected") : t("models.connections.notConnected")}
                  </Badge>
                </CardTitle>
                <CardDescription>{selectedEngine.engine.id}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 border-t border-borderSubtle/60 pt-4">
              <EngineConfigStepper steps={steps} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{t("models.connections.wizard.steps.selectEngine.title")}</CardTitle>
              <CardDescription>{t("models.connections.wizard.path.subtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="border-t border-borderSubtle/60 pt-4">
              <ConnectionPathCards
                value={currentMode}
                items={pathItems}
                onChange={(next) => setPathDrafts((prev) => ({ ...prev, [selectedEngine.engine.id]: next }))}
                labels={{
                  recommended: t("models.connections.wizard.recommended"),
                  selected: t("models.connections.wizard.selected"),
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{t("models.connections.wizard.steps.configure.title")}</CardTitle>
              <CardDescription>{t("models.connections.wizard.steps.configure.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 border-t border-borderSubtle/60 pt-4">
              {isApiKeyMode ? (
                <EnterpriseEndpointForm
                  engineId={selectedEngine.engine.id}
                  apiKeyLabel={t("models.connections.apiKeyInputLabel")}
                  apiKeyPlaceholder={t("models.connections.apiKeyPlaceholder")}
                  baseUrlLabel={t("models.connections.baseUrl")}
                  baseUrlPlaceholder={t("models.connections.wizard.baseUrlPlaceholder")}
                  apiKeyValue={currentApiKey}
                  baseUrlValue={currentBaseUrl}
                  onApiKeyChange={(next) => setApiKeyDrafts((prev) => ({ ...prev, [selectedEngine.engine.id]: next }))}
                  onBaseUrlChange={(next) => setBaseUrlDrafts((prev) => ({ ...prev, [selectedEngine.engine.id]: next }))}
                  onSave={() => void saveEngineConfiguration(selectedEngine.engine.id)}
                  onDisconnect={() => void disconnectEngineSecret(selectedEngine.engine.id)}
                  saveLabel={selectedEngine.connectedSecret ? t("common.rotate") : t("common.save")}
                  disconnectLabel={t("models.connections.disconnect")}
                  saveDisabled={createSecret.isPending || rotateSecret.isPending || updateOrgSettings.isPending}
                  showDisconnect={Boolean(selectedEngine.connectedSecret)}
                  helperText={t("models.connections.wizard.baseUrlExecutorScoped")}
                />
              ) : (
                <>
                  <ExecutorChecklist
                    lines={executorLines}
                    onlineExecutors={selectedEngine.authStatus?.onlineExecutors ?? 0}
                    verifiedCount={selectedEngine.authStatus?.verifiedCount ?? 0}
                    unverifiedCount={selectedEngine.authStatus?.unverifiedCount ?? 0}
                    onRecheck={() => void engineAuthStatusQuery.refetch()}
                    labels={{
                      onlineExecutors: t("models.connections.runtime.onlineExecutors", { count: "{count}" }),
                      verified: t("models.connections.runtime.verified", { count: "{count}" }),
                      unverified: t("models.connections.runtime.unverified", { count: "{count}" }),
                      recheck: t("models.connections.recheck"),
                    }}
                  />

                  {selectedEngine.engine.id === "gateway.opencode.v2" ? (
                    <div className="grid gap-2 rounded-xl border border-borderSubtle/60 bg-panel/45 p-3">
                      <div className="text-sm font-medium text-text">{t("models.connections.wizard.opencodeTemplateTitle")}</div>
                      <div className="text-xs text-muted">{t("models.connections.wizard.opencodeTemplateSubtitle")}</div>
                      <pre className="overflow-x-auto rounded-lg border border-borderSubtle/60 bg-panel/70 p-2 text-xs text-muted">{`{
  "name": "My Provider",
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "http://127.0.0.1:8045/v1",
    "apiKey": "\${ENV_KEY}"
  },
  "models": {
    "custom-model": { "name": "custom-model" }
  }
}`}</pre>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{t("models.connections.wizard.steps.verify.title")}</CardTitle>
              <CardDescription>{t("models.connections.wizard.verifySubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 border-t border-borderSubtle/60 pt-4">
              <div className="rounded-lg border border-borderSubtle/60 bg-panel/55 p-3 text-sm text-muted">
                {isOauthMode ? t("models.connections.wizard.oauthUsesExecutor") : t("models.connections.wizard.apiKeyUsesExecutor")}
              </div>

              {currentBaseUrl.trim().length > 0 ? (
                <div className="rounded-lg border border-borderSubtle/60 bg-panel/55 p-3 text-sm text-muted">
                  {t("models.connections.wizard.currentBaseUrl")}: <code>{currentBaseUrl.trim()}</code>
                  <div className="mt-1 text-xs">{t("models.connections.wizard.baseUrlExecutorScoped")}</div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="accent"
                  onClick={() => void saveEngineConfiguration(selectedEngine.engine.id)}
                  disabled={updateOrgSettings.isPending || createSecret.isPending || rotateSecret.isPending}
                >
                  {t("models.connections.wizard.saveCurrent")}
                </Button>
                {selectedEngineIndex < orderedEngineIds.length - 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveAndSelectNext(selectedEngine.engine.id)}
                    disabled={updateOrgSettings.isPending || createSecret.isPending || rotateSecret.isPending}
                  >
                    {t("models.connections.wizard.saveAndNext")}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                  {t("models.connections.recheck")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
