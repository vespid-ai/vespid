"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  getDefaultConnectorIdForProvider,
  isOAuthRequiredProvider,
  listLlmProviders,
  normalizeConnectorId,
  type LlmProviderApiKind,
  type LlmProviderId,
} from "@vespid/shared/llm/provider-registry";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { apiFetchJson, isUnauthorizedError } from "../../../../lib/api";
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

function connectorIdForProvider(providerId: LlmProviderId): string {
  const connectorId = getDefaultConnectorIdForProvider(providerId) ?? `llm.${providerId}`;
  return normalizeConnectorId(connectorId);
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

  const [primaryLlm, setPrimaryLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    secretId: null,
  });
  const [primaryInitDone, setPrimaryInitDone] = useState(false);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [deviceFlows, setDeviceFlows] = useState<Record<string, DeviceFlowDraft>>({});
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("us-central1");

  const allProviderMeta = useMemo(() => listLlmProviders({ context: "session" }), []);
  const connectionProviderMeta = useMemo(() => {
    return allProviderMeta.filter((provider) => {
      if (provider.authMode === "oauth") return true;
      return provider.id === "openai" || provider.id === "anthropic" || provider.id === "google";
    });
  }, [allProviderMeta]);

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

  const unauthorized =
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error)) ||
    (secretsQuery.isError && isUnauthorizedError(secretsQuery.error));

  useEffect(() => {
    if (primaryInitDone) return;
    const defaults = settingsQuery.data?.settings?.llm?.defaults?.primary as any;
    if (!defaults || typeof defaults !== "object") return;
    setPrimaryLlm((prev) => ({
      ...prev,
      ...(typeof defaults.provider === "string" ? { providerId: defaults.provider } : {}),
      ...(typeof defaults.model === "string" ? { modelId: defaults.model } : {}),
      ...(typeof defaults.secretId === "string" ? { secretId: defaults.secretId } : {}),
    }));
    setPrimaryInitDone(true);
  }, [primaryInitDone, settingsQuery.data?.settings]);

  useEffect(() => {
    const providerOverrides = settingsQuery.data?.settings?.llm?.providers ?? {};
    const current = (providerOverrides as any)?.[overrideProviderId] ?? null;
    setOverrideBaseUrl(typeof current?.baseUrl === "string" ? current.baseUrl : "");
    setOverrideApiKind(typeof current?.apiKind === "string" ? current.apiKind : "");
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
          description={t("onboarding.subtitle")}
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
                  toast.error(error instanceof Error ? error.message : t("common.unknownError"));
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
        <CardContent className="grid gap-3 md:grid-cols-2">
          {connectionProviderMeta.map((provider) => {
            const connectorId = connectorIdForProvider(provider.id);
            const connectedSecret = (secretsByConnector.get(connectorId) ?? []).find((secret) => secret.name === "default")
              ?? (secretsByConnector.get(connectorId) ?? [])[0]
              ?? null;
            const keyDraft = apiKeyDrafts[provider.id] ?? "";
            const flow = deviceFlows[provider.id] ?? null;

            if (provider.authMode === "oauth") {
              return (
                <div key={provider.id} className="grid gap-3 rounded-lg border border-borderSubtle bg-panel/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-text">{provider.displayName}</div>
                    <div className="text-xs text-muted">
                      {connectedSecret ? t("models.connections.connected") : t("models.connections.notConnected")}
                    </div>
                  </div>

                  {provider.id === "google-vertex" ? (
                    <div className="grid gap-2">
                      <div className="grid gap-1.5">
                        <Label>{t("models.connections.vertexProjectId")}</Label>
                        <Input value={vertexProjectId} onChange={(e) => setVertexProjectId(e.target.value)} placeholder="my-gcp-project" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>{t("models.connections.vertexLocation")}</Label>
                        <Input value={vertexLocation} onChange={(e) => setVertexLocation(e.target.value)} placeholder="us-central1" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="accent"
                          disabled={vertexProjectId.trim().length === 0 || vertexLocation.trim().length === 0}
                          onClick={async () => {
                            try {
                              const result = await apiFetchJson<{ authorizationUrl: string }>(
                                `/v1/orgs/${orgId}/llm/oauth/google-vertex/start`,
                                {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({
                                    projectId: vertexProjectId.trim(),
                                    location: vertexLocation.trim(),
                                    mode: "json",
                                  }),
                                },
                                { orgScoped: true }
                              );
                              if (typeof result.authorizationUrl === "string" && result.authorizationUrl.length > 0) {
                                window.location.assign(result.authorizationUrl);
                              }
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                            }
                          }}
                        >
                          {t("models.connections.connect")}
                        </Button>
                        {connectedSecret ? (
                          <Button
                            variant="outline"
                            onClick={async () => {
                              try {
                                await apiFetchJson(`/v1/orgs/${orgId}/llm/oauth/google-vertex/${connectedSecret.id}`, { method: "DELETE" }, { orgScoped: true });
                                await secretsQuery.refetch();
                                toast.success(t("common.deleted"));
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                              }
                            }}
                          >
                            {t("models.connections.disconnect")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {!flow ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              const started = await apiFetchJson<{
                                deviceCode: string;
                                userCode: string;
                                verificationUri: string;
                              }>(
                                `/v1/orgs/${orgId}/llm/oauth/${provider.id}/device/start`,
                                { method: "POST" },
                                { orgScoped: true }
                              );
                              setDeviceFlows((prev) => ({
                                ...prev,
                                [provider.id]: {
                                  deviceCode: started.deviceCode,
                                  userCode: started.userCode,
                                  verificationUri: started.verificationUri,
                                  token: "",
                                },
                              }));
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                            }
                          }}
                        >
                          {t("models.connections.startDeviceFlow")}
                        </Button>
                      ) : (
                        <div className="grid gap-2">
                          <div className="text-xs text-muted">{t("models.connections.userCode", { code: flow.userCode })}</div>
                          <a href={flow.verificationUri} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
                            {flow.verificationUri}
                          </a>
                          <Input
                            type="password"
                            value={flow.token}
                            onChange={(e) =>
                              setDeviceFlows((prev) => ({
                                ...prev,
                                [provider.id]: { ...flow, token: e.target.value },
                              }))
                            }
                            placeholder={t("models.connections.oauthTokenPlaceholder")}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="accent"
                              disabled={flow.token.trim().length === 0}
                              onClick={async () => {
                                try {
                                  const result = await apiFetchJson<{ status: "pending" | "connected" }>(
                                    `/v1/orgs/${orgId}/llm/oauth/${provider.id}/device/poll`,
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
                                      delete next[provider.id];
                                      return next;
                                    });
                                    toast.success(t("common.saved"));
                                  } else {
                                    toast.message(t("models.connections.pending"));
                                  }
                                } catch (error) {
                                  toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                                }
                              }}
                            >
                              {t("models.connections.completeConnection")}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setDeviceFlows((prev) => {
                                  const next = { ...prev };
                                  delete next[provider.id];
                                  return next;
                                });
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                          </div>
                        </div>
                      )}
                      {connectedSecret ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await apiFetchJson(`/v1/orgs/${orgId}/llm/oauth/${provider.id}/${connectedSecret.id}`, { method: "DELETE" }, { orgScoped: true });
                              await secretsQuery.refetch();
                              toast.success(t("common.deleted"));
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                            }
                          }}
                        >
                          {t("models.connections.disconnect")}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={provider.id} className="grid gap-3 rounded-lg border border-borderSubtle bg-panel/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-text">{provider.displayName}</div>
                  <div className="text-xs text-muted">
                    {connectedSecret ? t("models.connections.connected") : t("models.connections.notConnected")}
                  </div>
                </div>
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) =>
                    setApiKeyDrafts((prev) => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))
                  }
                  placeholder={t("models.connections.apiKeyPlaceholder")}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="accent"
                    disabled={keyDraft.trim().length === 0}
                    onClick={async () => {
                      try {
                        const value = keyDraft.trim();
                        if (!connectedSecret) {
                          await createSecret.mutateAsync({
                            connectorId,
                            name: "default",
                            value,
                          });
                        } else {
                          await rotateSecret.mutateAsync({ secretId: connectedSecret.id, value });
                        }
                        setApiKeyDrafts((prev) => ({ ...prev, [provider.id]: "" }));
                        await secretsQuery.refetch();
                        toast.success(t("common.saved"));
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                      }
                    }}
                  >
                    {connectedSecret ? t("common.rotate") : t("models.connections.connect")}
                  </Button>
                  {connectedSecret ? (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await deleteSecret.mutateAsync(connectedSecret.id);
                          await secretsQuery.refetch();
                          toast.success(t("common.deleted"));
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                        }
                      }}
                    >
                      {t("models.connections.disconnect")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
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
              <Select value={overrideProviderId} onValueChange={(next) => setOverrideProviderId(next as LlmProviderId)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allProviderMeta.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                }
              }}
            >
              {t("common.save")}
            </Button>
          </div>
          {providerMetaById[overrideProviderId] ? (
            <div className="text-xs text-muted">
              {t("models.connections.runtimeHint", { provider: providerMetaById[overrideProviderId].displayName })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
