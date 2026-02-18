"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  getDefaultConnectorIdForProvider,
  getLlmProviderMeta,
  isOAuthRequiredProvider,
  listLlmProviders,
  normalizeConnectorId,
  type LlmProviderApiKind,
  type LlmProviderId,
} from "@vespid/shared/llm/provider-registry";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { ProviderPicker } from "../../../../components/app/llm/provider-picker";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { apiFetchJson, isUnauthorizedError } from "../../../../lib/api";
import { useTestLlmProviderApiKey } from "../../../../lib/hooks/use-llm-provider-key-test";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { useCreateSecret, useDeleteSecret, useRotateSecret, useSecrets } from "../../../../lib/hooks/use-secrets";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";

const API_KIND_OPTIONS: Array<{ value: LlmProviderApiKind; label: string }> = [
  { value: "openai-compatible", label: "openai-compatible" },
  { value: "anthropic-compatible", label: "anthropic-compatible" },
  { value: "google", label: "google" },
  { value: "vertex", label: "vertex" },
  { value: "bedrock", label: "bedrock" },
  { value: "copilot", label: "copilot" },
  { value: "custom", label: "custom" },
];

type DeviceFlowDraft = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  token: string;
};

type ApiKeyDraft = {
  value: string;
  testStatus: "idle" | "testing" | "passed" | "failed";
  testedValue: string | null;
  error: string | null;
};

function connectorIdForProvider(providerId: LlmProviderId): string {
  const connectorId = getDefaultConnectorIdForProvider(providerId) ?? `llm.${providerId}`;
  return normalizeConnectorId(connectorId);
}

function fallbackMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const payload = (error as { payload?: { code?: unknown } }).payload;
  if (payload && typeof payload.code === "string") return payload.code;
  return null;
}

function buildEmptyApiKeyDraft(): ApiKeyDraft {
  return {
    value: "",
    testStatus: "idle",
    testedValue: null,
    error: null,
  };
}

export function redirectToProvider(url: string) {
  const opened = window.open(url, "_self");
  if (opened === null) {
    window.location.assign(url);
  }
}

export default function ModelConnectionsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const searchParams = useSearchParams();

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const settingsQuery = useOrgSettings(scopedOrgId);
  const updateSettings = useUpdateOrgSettings(scopedOrgId);
  const secretsQuery = useSecrets(scopedOrgId);
  const createSecret = useCreateSecret(scopedOrgId);
  const rotateSecret = useRotateSecret(scopedOrgId);
  const deleteSecret = useDeleteSecret(scopedOrgId);
  const testProviderKey = useTestLlmProviderApiKey(scopedOrgId);

  const [primaryLlm, setPrimaryLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    secretId: null,
  });
  const [primaryInitDone, setPrimaryInitDone] = useState(false);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, ApiKeyDraft>>({});
  const [deviceFlows, setDeviceFlows] = useState<Record<string, DeviceFlowDraft>>({});
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("us-central1");

  const [apiKeyDialogProviderId, setApiKeyDialogProviderId] = useState<LlmProviderId | null>(null);
  const [oauthDialogProviderId, setOauthDialogProviderId] = useState<LlmProviderId | null>(null);

  const allProviderMeta = useMemo(() => listLlmProviders({ context: "session" }), []);
  const connectionProviderMeta = useMemo(() => {
    return allProviderMeta.filter((provider) => {
      if (provider.authMode === "oauth") return true;
      return provider.id === "openai" || provider.id === "anthropic" || provider.id === "google";
    });
  }, [allProviderMeta]);
  const apiKeyConnectionProviderMeta = useMemo(() => {
    return connectionProviderMeta.filter((provider) => provider.authMode !== "oauth");
  }, [connectionProviderMeta]);
  const oauthConnectionProviderMeta = useMemo(() => {
    return connectionProviderMeta.filter((provider) => provider.authMode === "oauth");
  }, [connectionProviderMeta]);

  const providerMetaById = useMemo(() => {
    return Object.fromEntries(allProviderMeta.map((provider) => [provider.id, provider])) as Record<LlmProviderId, (typeof allProviderMeta)[number]>;
  }, [allProviderMeta]);

  const [overrideProviderId, setOverrideProviderId] = useState<LlmProviderId>("openai");
  const [overrideBaseUrl, setOverrideBaseUrl] = useState("");
  const [overrideApiKind, setOverrideApiKind] = useState<LlmProviderApiKind | "">("");

  const secretsByConnector = useMemo(() => {
    const map = new Map<string, Array<{ id: string; connectorId: string; name: string }>>();
    for (const secret of secretsQuery.data?.secrets ?? []) {
      const connectorId = normalizeConnectorId(secret.connectorId);
      const existing = map.get(connectorId) ?? [];
      existing.push(secret);
      map.set(connectorId, existing);
    }
    return map;
  }, [secretsQuery.data?.secrets]);

  const overrideProviderItems = useMemo(() => {
    return allProviderMeta.map((provider) => {
      const connectorId = connectorIdForProvider(provider.id);
      const connected = (secretsByConnector.get(connectorId) ?? []).length > 0;
      return {
        id: provider.id,
        label: provider.displayName,
        recommended: provider.tags.includes("recommended") || provider.tags.includes("popular"),
        connected,
        oauth: provider.authMode === "oauth",
      };
    });
  }, [allProviderMeta, secretsByConnector]);

  const unauthorized =
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error)) ||
    (secretsQuery.isError && isUnauthorizedError(secretsQuery.error));

  useEffect(() => {
    if (primaryInitDone) return;
    const defaults = settingsQuery.data?.settings?.llm?.defaults?.primary as {
      provider?: string;
      model?: string;
      secretId?: string;
    } | null;
    if (!defaults || typeof defaults !== "object") return;
    setPrimaryLlm((prev) => ({
      ...prev,
      ...(typeof defaults.provider === "string" ? { providerId: defaults.provider as LlmProviderId } : {}),
      ...(typeof defaults.model === "string" ? { modelId: defaults.model } : {}),
      ...(typeof defaults.secretId === "string" ? { secretId: defaults.secretId } : {}),
    }));
    setPrimaryInitDone(true);
  }, [primaryInitDone, settingsQuery.data?.settings]);

  useEffect(() => {
    const providerOverrides = settingsQuery.data?.settings?.llm?.providers ?? {};
    const current = (providerOverrides as Record<string, { baseUrl?: string; apiKind?: string }>)[overrideProviderId] ?? null;
    setOverrideBaseUrl(typeof current?.baseUrl === "string" ? current.baseUrl : "");
    setOverrideApiKind(typeof current?.apiKind === "string" ? (current.apiKind as LlmProviderApiKind) : "");
  }, [overrideProviderId, settingsQuery.data?.settings]);

  useEffect(() => {
    const vertex = searchParams.get("vertex");
    if (vertex === "success") {
      toast.success(t("models.connections.vertexConnected"));
    } else if (vertex === "error") {
      const code = searchParams.get("code") ?? "UNKNOWN";
      toast.error(`${t("models.connections.vertexFailed")}: ${code}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getConnectedSecret = (providerId: LlmProviderId) => {
    const connectorId = connectorIdForProvider(providerId);
    const all = secretsByConnector.get(connectorId) ?? [];
    return all.find((secret) => secret.name === "default") ?? all[0] ?? null;
  };

  const getApiKeyDraft = (providerId: LlmProviderId): ApiKeyDraft => {
    return apiKeyDrafts[providerId] ?? buildEmptyApiKeyDraft();
  };

  const updateApiKeyDraft = (providerId: LlmProviderId, updater: (current: ApiKeyDraft) => ApiKeyDraft) => {
    setApiKeyDrafts((prev) => {
      const current = prev[providerId] ?? buildEmptyApiKeyDraft();
      return {
        ...prev,
        [providerId]: updater(current),
      };
    });
  };

  const apiKeyDialogProvider = apiKeyDialogProviderId ? providerMetaById[apiKeyDialogProviderId] ?? null : null;
  const oauthDialogProvider = oauthDialogProviderId ? providerMetaById[oauthDialogProviderId] ?? null : null;
  const oauthDeviceFlow = oauthDialogProvider ? deviceFlows[oauthDialogProvider.id] ?? null : null;

  async function startDeviceFlow(providerId: LlmProviderId) {
    if (!orgId) return;
    try {
      const started = await apiFetchJson<{
        deviceCode: string;
        userCode: string;
        verificationUri: string;
      }>(
        `/v1/orgs/${orgId}/llm/oauth/${providerId}/device/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "default" }),
        },
        { orgScoped: true }
      );

      setOauthDialogProviderId(providerId);
      setDeviceFlows((prev) => ({
        ...prev,
        [providerId]: {
          deviceCode: started.deviceCode,
          userCode: started.userCode,
          verificationUri: started.verificationUri,
          token: "",
        },
      }));

      if (typeof window !== "undefined") {
        window.open(started.verificationUri, "_blank", "noopener,noreferrer");
      }
      toast.success(t("models.connections.oauthOpened"));
    } catch (error) {
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function startOauth(providerId: LlmProviderId, input?: { projectId?: string; location?: string }) {
    if (!orgId) return;
    setOauthDialogProviderId(providerId);

    try {
      const started = await apiFetchJson<{ authorizationUrl: string }>(
        `/v1/orgs/${orgId}/llm/oauth/${providerId}/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(input?.projectId ? { projectId: input.projectId } : {}),
            ...(input?.location ? { location: input.location } : {}),
            mode: "json",
          }),
        },
        { orgScoped: true }
      );

      if (typeof started.authorizationUrl === "string" && started.authorizationUrl.length > 0) {
        toast.message(t("models.connections.redirecting"));
        redirectToProvider(started.authorizationUrl);
        return;
      }
      toast.error(t("common.unknownError"));
    } catch (error) {
      if (getErrorCode(error) === "LLM_OAUTH_USE_DEVICE_FLOW") {
        await startDeviceFlow(providerId);
        return;
      }
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function disconnectOauth(providerId: LlmProviderId) {
    if (!orgId) return;
    const connectedSecret = getConnectedSecret(providerId);
    if (!connectedSecret) return;
    try {
      await apiFetchJson(`/v1/orgs/${orgId}/llm/oauth/${providerId}/${connectedSecret.id}`, { method: "DELETE" }, { orgScoped: true });
      await secretsQuery.refetch();
      toast.success(t("common.deleted"));
    } catch (error) {
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function completeDeviceFlow(providerId: LlmProviderId) {
    if (!orgId) return;
    const flow = deviceFlows[providerId] ?? null;
    if (!flow) return;

    try {
      const result = await apiFetchJson<{ status: "pending" | "connected" }>(
        `/v1/orgs/${orgId}/llm/oauth/${providerId}/device/poll`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deviceCode: flow.deviceCode,
            token: flow.token.trim(),
            name: "default",
          }),
        },
        { orgScoped: true }
      );

      if (result.status === "connected") {
        await secretsQuery.refetch();
        setDeviceFlows((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        toast.success(t("common.saved"));
      } else {
        toast.message(t("models.connections.pending"));
      }
    } catch (error) {
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function testApiKey(providerId: LlmProviderId) {
    const provider = getLlmProviderMeta(providerId);
    if (!provider) return;

    const draft = getApiKeyDraft(providerId);
    const value = draft.value.trim();
    if (!value) return;

    updateApiKeyDraft(providerId, (current) => ({
      ...current,
      testStatus: "testing",
      error: null,
      testedValue: null,
    }));

    try {
      await testProviderKey.mutateAsync({
        providerId,
        value,
        model: provider.defaultModelId,
      });
      updateApiKeyDraft(providerId, (current) => ({
        ...current,
        testStatus: "passed",
        testedValue: value,
        error: null,
      }));
      toast.success(t("models.connections.testPassed"));
    } catch (error) {
      updateApiKeyDraft(providerId, (current) => ({
        ...current,
        testStatus: "failed",
        testedValue: null,
        error: fallbackMessage(error, t("common.unknownError")),
      }));
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function saveApiKey(providerId: LlmProviderId) {
    const connectedSecret = getConnectedSecret(providerId);
    const draft = getApiKeyDraft(providerId);
    const value = draft.value.trim();
    const canSave = draft.testStatus === "passed" && draft.testedValue === value && value.length > 0;

    if (!canSave) {
      toast.error(t("models.connections.testRequired"));
      return;
    }

    try {
      const connectorId = connectorIdForProvider(providerId);
      if (!connectedSecret) {
        await createSecret.mutateAsync({
          connectorId,
          name: "default",
          value,
        });
      } else {
        await rotateSecret.mutateAsync({ secretId: connectedSecret.id, value });
      }

      updateApiKeyDraft(providerId, () => buildEmptyApiKeyDraft());
      await secretsQuery.refetch();
      toast.success(t("common.saved"));
      setApiKeyDialogProviderId(null);
    } catch (error) {
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  async function deleteApiKey(providerId: LlmProviderId) {
    const connectedSecret = getConnectedSecret(providerId);
    if (!connectedSecret) return;

    try {
      await deleteSecret.mutateAsync(connectedSecret.id);
      await secretsQuery.refetch();
      updateApiKeyDraft(providerId, () => buildEmptyApiKeyDraft());
      toast.success(t("common.deleted"));
    } catch (error) {
      toast.error(fallbackMessage(error, t("common.unknownError")));
    }
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void settingsQuery.refetch();
            void secretsQuery.refetch();
          }}
        />
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
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void settingsQuery.refetch();
            void secretsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("models.connections.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("models.connections.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.connections.primaryTitle")}</CardTitle>
          <CardDescription>{t("models.connections.primarySubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <LlmConfigField orgId={scopedOrgId} mode="primary" value={primaryLlm} onChange={setPrimaryLlm} />
          {isOAuthRequiredProvider(primaryLlm.providerId) && !primaryLlm.secretId ? (
            <div className="text-xs text-warn">{t("models.connections.oauthRequired")}</div>
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="accent"
              disabled={updateSettings.isPending || primaryLlm.modelId.trim().length === 0}
              onClick={async () => {
                try {
                  await updateSettings.mutateAsync({
                    llm: {
                      defaults: {
                        primary: {
                          provider: primaryLlm.providerId,
                          model: primaryLlm.modelId.trim(),
                          secretId: primaryLlm.secretId ?? null,
                        },
                      },
                    },
                  });
                  toast.success(t("common.saved"));
                } catch (error) {
                  toast.error(fallbackMessage(error, t("common.unknownError")));
                }
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.connections.providersTitle")}</CardTitle>
          <CardDescription>{t("models.connections.providersSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Tabs defaultValue="api-key" className="grid gap-3">
            <TabsList>
              <TabsTrigger value="api-key">{t("models.connections.tabs.apiKey")}</TabsTrigger>
              <TabsTrigger value="oauth">{t("models.connections.tabs.oauth")}</TabsTrigger>
            </TabsList>

            <TabsContent value="api-key" className="grid gap-2">
              <div className="text-xs text-muted">{t("models.connections.apiKeyGroupDescription")}</div>
              <div className="grid gap-2">
                {apiKeyConnectionProviderMeta.map((provider) => {
                  const connectedSecret = getConnectedSecret(provider.id);
                  return (
                    <div
                      key={provider.id}
                      data-testid={`provider-row-${provider.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borderSubtle/70 bg-panel/55 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-text">{provider.displayName}</div>
                        <Badge variant={connectedSecret ? "ok" : "neutral"}>
                          {connectedSecret ? t("models.connections.connected") : t("models.connections.notConnected")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => setApiKeyDialogProviderId(provider.id)}
                        >
                          {connectedSecret ? t("models.connections.reconnect") : t("models.connections.connect")}
                        </Button>
                        {connectedSecret ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void deleteApiKey(provider.id);
                            }}
                          >
                            {t("models.connections.disconnect")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="oauth" className="grid gap-2">
              <div className="text-xs text-muted">{t("models.connections.oauthGroupDescription")}</div>
              <div className="grid gap-2">
                {oauthConnectionProviderMeta.map((provider) => {
                  const connectedSecret = getConnectedSecret(provider.id);
                  return (
                    <div
                      key={provider.id}
                      data-testid={`provider-row-${provider.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borderSubtle/70 bg-panel/55 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-text">{provider.displayName}</div>
                        <Badge variant={connectedSecret ? "ok" : "neutral"}>
                          {connectedSecret ? t("models.connections.connected") : t("models.connections.notConnected")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => {
                            if (provider.id === "google-vertex") {
                              setOauthDialogProviderId(provider.id);
                              return;
                            }
                            void startOauth(provider.id);
                          }}
                        >
                          {connectedSecret ? t("models.connections.reconnect") : t("models.connections.connect")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOauthDialogProviderId(provider.id)}>
                          {t("models.connections.manage")}
                        </Button>
                        {connectedSecret ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void disconnectOauth(provider.id);
                            }}
                          >
                            {t("models.connections.disconnect")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.connections.runtimeTitle")}</CardTitle>
          <CardDescription>{t("models.connections.runtimeSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>{t("models.connections.provider")}</Label>
              <ProviderPicker
                value={overrideProviderId}
                items={overrideProviderItems}
                onChange={setOverrideProviderId}
                labels={{
                  title: t("providerPicker.title"),
                  connected: t("providerPicker.filterConnected"),
                  recommended: t("providerPicker.filterRecommended"),
                  all: t("providerPicker.filterAll"),
                  searchPlaceholder: t("providerPicker.searchProvider"),
                  noResults: t("providerPicker.noResults"),
                  badgeConnected: t("providerPicker.badgeConnected"),
                  badgeRecommended: t("providerPicker.badgeRecommended"),
                  badgeOauth: t("providerPicker.badgeOauth"),
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("models.connections.baseUrl")}</Label>
              <Input value={overrideBaseUrl} onChange={(e) => setOverrideBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("models.connections.apiKind")}</Label>
              <Select value={overrideApiKind || "__default__"} onValueChange={(next) => setOverrideApiKind(next === "__default__" ? "" : (next as LlmProviderApiKind))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t("models.connections.apiKindDefault")}</SelectItem>
                  {API_KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="accent"
              disabled={updateSettings.isPending}
              onClick={async () => {
                try {
                  await updateSettings.mutateAsync({
                    llm: {
                      providers: {
                        [overrideProviderId]: {
                          baseUrl: overrideBaseUrl.trim().length > 0 ? overrideBaseUrl.trim() : null,
                          apiKind: overrideApiKind || null,
                        },
                      },
                    },
                  });
                  toast.success(t("common.saved"));
                } catch (error) {
                  toast.error(fallbackMessage(error, t("common.unknownError")));
                }
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(apiKeyDialogProvider)} onOpenChange={(open) => (!open ? setApiKeyDialogProviderId(null) : null)}>
        <DialogContent>
          {apiKeyDialogProvider ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("models.connections.apiKeyDialogTitle", { provider: apiKeyDialogProvider.displayName })}</DialogTitle>
                <DialogDescription>{t("models.connections.apiKeyDialogDescription")}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <Input
                  type="password"
                  value={getApiKeyDraft(apiKeyDialogProvider.id).value}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    updateApiKeyDraft(apiKeyDialogProvider.id, () => ({
                      value: nextValue,
                      testStatus: "idle",
                      testedValue: null,
                      error: null,
                    }));
                  }}
                  placeholder={t("models.connections.apiKeyPlaceholder")}
                />

                {getApiKeyDraft(apiKeyDialogProvider.id).testStatus === "passed" ? (
                  <div className="text-xs text-ok">{t("models.connections.testPassed")}</div>
                ) : null}
                {getApiKeyDraft(apiKeyDialogProvider.id).testStatus === "failed" ? (
                  <div className="text-xs text-danger">{getApiKeyDraft(apiKeyDialogProvider.id).error ?? t("common.unknownError")}</div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    data-testid="api-key-test-button"
                    variant="outline"
                    disabled={getApiKeyDraft(apiKeyDialogProvider.id).value.trim().length === 0 || getApiKeyDraft(apiKeyDialogProvider.id).testStatus === "testing"}
                    onClick={() => {
                      void testApiKey(apiKeyDialogProvider.id);
                    }}
                  >
                    {getApiKeyDraft(apiKeyDialogProvider.id).testStatus === "testing" ? t("common.working") : t("models.connections.testKey")}
                  </Button>
                  <Button
                    data-testid="api-key-save-button"
                    variant="accent"
                    disabled={(() => {
                      const draft = getApiKeyDraft(apiKeyDialogProvider.id);
                      const value = draft.value.trim();
                      return !(draft.testStatus === "passed" && draft.testedValue === value && value.length > 0);
                    })()}
                    onClick={() => {
                      void saveApiKey(apiKeyDialogProvider.id);
                    }}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(oauthDialogProvider)} onOpenChange={(open) => (!open ? setOauthDialogProviderId(null) : null)}>
        <DialogContent>
          {oauthDialogProvider ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("models.connections.oauthDialogTitle", { provider: oauthDialogProvider.displayName })}</DialogTitle>
                <DialogDescription>{t("models.connections.oauthDialogDescription")}</DialogDescription>
              </DialogHeader>

              {oauthDialogProvider.id === "google-vertex" ? (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("models.connections.vertexProjectId")}</Label>
                    <Input value={vertexProjectId} onChange={(e) => setVertexProjectId(e.target.value)} placeholder="my-gcp-project" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("models.connections.vertexLocation")}</Label>
                    <Input value={vertexLocation} onChange={(e) => setVertexLocation(e.target.value)} placeholder="us-central1" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="accent"
                      disabled={vertexProjectId.trim().length === 0 || vertexLocation.trim().length === 0}
                      onClick={() => {
                        void startOauth("google-vertex", {
                          projectId: vertexProjectId.trim(),
                          location: vertexLocation.trim(),
                        });
                      }}
                    >
                      {t("models.connections.startAuthorization")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3">
                  {oauthDeviceFlow ? (
                    <>
                      <div className="rounded-md border border-borderSubtle/70 bg-panel/50 p-3 text-xs text-text">
                        {t("models.connections.userCode", { code: oauthDeviceFlow.userCode })}
                      </div>
                      <a
                        href={oauthDeviceFlow.verificationUri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline underline-offset-2"
                      >
                        {oauthDeviceFlow.verificationUri}
                      </a>
                      <Input
                        type="password"
                        value={oauthDeviceFlow.token}
                        onChange={(e) => {
                          const nextToken = e.target.value;
                          setDeviceFlows((prev) => {
                            const current = prev[oauthDialogProvider.id];
                            if (!current) return prev;
                            return {
                              ...prev,
                              [oauthDialogProvider.id]: {
                                ...current,
                                token: nextToken,
                              },
                            };
                          });
                        }}
                        placeholder={t("models.connections.oauthTokenPlaceholder")}
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(oauthDeviceFlow.userCode);
                              toast.success(t("common.copied"));
                            } catch {
                              toast.error(t("errors.copyFailed"));
                            }
                          }}
                        >
                          {t("models.connections.copyCode")}
                        </Button>
                        <Button
                          variant="accent"
                          disabled={oauthDeviceFlow.token.trim().length === 0}
                          onClick={() => {
                            void completeDeviceFlow(oauthDialogProvider.id);
                          }}
                        >
                          {t("models.connections.completeConnection")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="accent"
                        onClick={() => {
                          void startOauth(oauthDialogProvider.id);
                        }}
                      >
                        {t("models.connections.startAuthorization")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
