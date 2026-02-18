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

type MethodSupport = "supported_now" | "host_managed" | "official_not_supported_yet";

type EngineMethod = {
  key: string;
  support: MethodSupport;
  docsUrl?: string;
};

const ENGINE_METHODS: Record<EngineId, EngineMethod[]> = {
  "gateway.codex.v2": [
    { key: "executor_oauth", support: "supported_now", docsUrl: "https://developers.openai.com/codex/security-and-privacy/" },
    { key: "api_key", support: "supported_now", docsUrl: "https://developers.openai.com/codex/security-and-privacy/" },
  ],
  "gateway.claude.v2": [
    { key: "executor_oauth", support: "supported_now", docsUrl: "https://docs.anthropic.com/en/docs/claude-code/iam" },
    { key: "api_key", support: "supported_now", docsUrl: "https://support.anthropic.com/en/articles/12304248-managing-api-key-authentication-in-claude-code" },
    { key: "bedrock", support: "official_not_supported_yet", docsUrl: "https://docs.anthropic.com/en/docs/claude-code/iam" },
    { key: "vertex", support: "official_not_supported_yet", docsUrl: "https://docs.anthropic.com/en/docs/claude-code/iam" },
  ],
  "gateway.opencode.v2": [
    { key: "managed_api_key", support: "supported_now", docsUrl: "https://opencode.ai/docs/providers/" },
    { key: "executor_profile", support: "host_managed", docsUrl: "https://opencode.ai/docs/connect" },
  ],
};

const OPENCODE_PROVIDER_PRESETS = ["anthropic", "openai", "google", "openrouter"] as const;

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

function supportBadgeVariant(support: MethodSupport): "ok" | "neutral" {
  return support === "supported_now" ? "ok" : "neutral";
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
      toast.error(t("models.connections.apiKeyRequired"));
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
          <CardTitle>{t("models.connections.byonOnlyTitle")}</CardTitle>
          <CardDescription>{t("models.connections.byonOnlyDescription")}</CardDescription>
        </CardHeader>
      </Card>

      <Card data-testid="connection-matrix">
        <CardHeader>
          <CardTitle>{t("models.connections.matrix.title")}</CardTitle>
          <CardDescription>{t("models.connections.matrix.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="grid grid-cols-1 gap-2 text-xs font-medium text-muted md:grid-cols-4">
            <div>{t("models.connections.matrix.columns.engine")}</div>
            <div>{t("models.connections.matrix.columns.officialMethods")}</div>
            <div>{t("models.connections.matrix.columns.supportedNow")}</div>
            <div>{t("models.connections.matrix.columns.recommendedPath")}</div>
          </div>
          {engines
            .filter((engine) => isEngineId(engine.id))
            .map((engine) => {
              const methodDefs = ENGINE_METHODS[engine.id as EngineId] ?? [];
              const officialMethods = methodDefs.map((method) => t(`models.connections.methods.${method.key}.label`)).join(" · ");
              const supported = methodDefs
                .filter((method) => method.support === "supported_now" || method.support === "host_managed")
                .map((method) => t(`models.connections.methods.${method.key}.label`))
                .join(" · ");
              const recommendedKey = engine.id === "gateway.opencode.v2" ? "executor_profile" : "executor_oauth";
              return (
                <div key={`matrix:${engine.id}`} className="grid grid-cols-1 gap-2 rounded-md border border-borderSubtle/60 p-3 text-xs md:grid-cols-4">
                  <div className="font-medium text-text">{engine.displayName}</div>
                  <div className="text-muted">{officialMethods}</div>
                  <div className="text-muted">{supported}</div>
                  <div className="text-muted">{t(`models.connections.methods.${recommendedKey}.label`)}</div>
                </div>
              );
            })}
        </CardContent>
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
          const verifiedEngine = isOAuthVerifiedEngine(engine.id);
          const connected =
            mode === "api_key"
              ? Boolean(connectedSecret)
              : verifiedEngine
                ? (authStatus?.verifiedCount ?? 0) > 0
                : (authStatus?.onlineExecutors ?? 0) > 0;
          const draft = drafts[engine.id] ?? "";
          const methods = ENGINE_METHODS[engine.id] ?? [];

          return (
            <Card key={engine.id} data-testid={`engine-card-${engine.id}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{engine.displayName}</CardTitle>
                  <Badge variant={connected ? "ok" : "neutral"}>{connected ? t("models.connections.connected") : t("models.connections.notConnected")}</Badge>
                </div>
                <CardDescription>{engine.id}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="text-xs text-muted">
                  {t("models.connections.cliLabel")}: <code>{engine.cliCommand}</code>
                </div>
                <div className="text-xs text-muted">
                  {t("models.connections.defaultModelLabel")}: <code>{engine.defaultModel}</code>
                </div>
                <div className="text-xs text-muted">
                  {t("models.connections.secretConnectorLabel")}: <code>{engine.defaultSecretConnectorId}</code>
                </div>

                <div className="grid gap-1 rounded-md border border-borderSubtle/55 bg-panel/40 p-2 text-xs">
                  <div className="font-medium text-text">{t("models.connections.officialMethodsTitle")}</div>
                  {methods.map((method) => (
                    <div key={`${engine.id}:${method.key}`} className="flex items-start justify-between gap-2">
                      <div className="text-muted">{t(`models.connections.methods.${method.key}.label`)}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={supportBadgeVariant(method.support)}>{t(`models.connections.support.${method.support}`)}</Badge>
                        {method.docsUrl ? (
                          <a
                            href={method.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted underline underline-offset-2"
                          >
                            {t("models.connections.docsLink")}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2">
                  <Label>{t("models.connections.methodSelectorTitle")}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={mode === "oauth_executor" ? "accent" : "outline"}
                      onClick={() => void switchEngineMode(engine, "oauth_executor")}
                      disabled={updateOrgSettings.isPending}
                    >
                      {engine.id === "gateway.opencode.v2"
                        ? t("models.connections.methods.executor_profile.label")
                        : t("models.connections.methods.executor_oauth.label")}
                    </Button>
                    <Button
                      size="sm"
                      variant={mode === "api_key" ? "accent" : "outline"}
                      onClick={() => void switchEngineMode(engine, "api_key")}
                      disabled={updateOrgSettings.isPending}
                    >
                      {engine.id === "gateway.opencode.v2"
                        ? t("models.connections.methods.managed_api_key.label")
                        : t("models.connections.methods.api_key.label")}
                    </Button>
                  </div>
                </div>

                {mode === "api_key" ? (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor={`engine-secret-${engine.id}`}>{t("models.connections.apiKeyInputLabel")}</Label>
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
                    {engine.id === "gateway.opencode.v2" ? (
                      <div className="rounded-md border border-borderSubtle/55 bg-panel/45 p-2 text-xs text-muted">
                        {t("models.connections.opencode.apiKeyModeNote")}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="grid gap-2 rounded-md border border-borderSubtle/65 bg-panel/55 p-3 text-xs text-muted">
                    {engine.id === "gateway.opencode.v2" ? (
                      <>
                        <div>{t("models.connections.opencode.executorManagedNote")}</div>
                        <div>{t("models.connections.opencode.runtimeNoCustody")}</div>
                        <div>{t("models.connections.runtime.onlineExecutors", { count: authStatus?.onlineExecutors ?? 0 })}</div>
                        <div>{t("models.connections.runtime.verificationNotApplicable")}</div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                            {t("models.connections.recheck")}
                          </Button>
                        </div>
                        <div className="grid gap-1">
                          {OPENCODE_PROVIDER_PRESETS.map((providerKey) => (
                            <div key={`opencode-provider:${providerKey}`} className="rounded border border-borderSubtle/55 px-2 py-1">
                              <div className="font-medium text-text">{t(`models.connections.opencode.providers.${providerKey}.name`)}</div>
                              <div>{t(`models.connections.opencode.providers.${providerKey}.desc`)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div>{t("models.connections.runtime.loginOnExecutor", { command: `${engine.cliCommand} login` })}</div>
                        <div>
                          {t("models.connections.runtime.verifyCommands", {
                            commandA: `${engine.cliCommand} auth status`,
                            commandB: `${engine.cliCommand} whoami`,
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                            {t("models.connections.recheck")}
                          </Button>
                        </div>
                        <div>{t("models.connections.runtime.onlineExecutors", { count: authStatus?.onlineExecutors ?? 0 })}</div>
                        <div>{t("models.connections.runtime.verified", { count: authStatus?.verifiedCount ?? 0 })}</div>
                        <div>{t("models.connections.runtime.unverified", { count: authStatus?.unverifiedCount ?? 0 })}</div>
                        <div className="grid gap-1">
                          {(authStatus?.executors ?? []).map((executor) => (
                            <div key={`${engine.id}:${executor.executorId}`} className="rounded border border-borderSubtle/55 px-2 py-1">
                              <div className="font-medium text-text">{executor.name}</div>
                              <div>
                                {executor.verified
                                  ? t("models.connections.runtime.executorVerified")
                                  : t("models.connections.runtime.executorUnverified")}
                                {" · "}
                                {executor.reason}
                              </div>
                              <div>{new Date(executor.checkedAt).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      </>
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
