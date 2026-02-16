"use client";

import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { isOAuthRequiredProvider, normalizeConnectorId } from "@vespid/shared/llm/provider-registry";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../../components/ui/dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Separator } from "../../../../components/ui/separator";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { useCreateSecret, useDeleteSecret, useRotateSecret, useSecrets } from "../../../../lib/hooks/use-secrets";
import { apiFetchJson } from "../../../../lib/api";
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { AdvancedSection } from "../../../../components/app/advanced-section";

function SecretsPageContent() {
  const t = useTranslations();
  const orgId = useActiveOrgId();
  const searchParams = useSearchParams();

  const secretsQuery = useSecrets(orgId);
  const createSecret = useCreateSecret(orgId);
  const rotateSecret = useRotateSecret(orgId);
  const deleteSecret = useDeleteSecret(orgId);
  const settingsQuery = useOrgSettings(orgId);
  const updateSettings = useUpdateOrgSettings(orgId);

  const secrets = secretsQuery.data?.secrets ?? [];

  const [selectedId, setSelectedId] = useState<string>("");

  const selected = useMemo(() => secrets.find((s) => s.id === selectedId) ?? null, [secrets, selectedId]);

  const [connectorId, setConnectorId] = useState("github");
  const [name, setName] = useState("token");
  const [value, setValue] = useState("");

  const [rotateValue, setRotateValue] = useState("");

  const [openAiValue, setOpenAiValue] = useState("");
  const [anthropicValue, setAnthropicValue] = useState("");
  const [geminiValue, setGeminiValue] = useState("");
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("us-central1");

  const canOperate = Boolean(orgId);

  const [defaultSessionLlm, setDefaultSessionLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-4.1-mini",
    secretId: null,
  });
  const [defaultWorkflowAgentRunLlm, setDefaultWorkflowAgentRunLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-4.1-mini",
    secretId: null,
  });
  const [defaultToolsetBuilderLlm, setDefaultToolsetBuilderLlm] = useState<LlmConfigValue>({
    providerId: "anthropic",
    modelId: "claude-3-5-sonnet-latest",
    secretId: null,
  });

  const llmDefaultsInitRef = useRef(false);
  useEffect(() => {
    if (llmDefaultsInitRef.current) return;
    const s = settingsQuery.data?.settings as any;
    if (!s) return;
    const d = s.llm?.defaults ?? null;
    if (!d || typeof d !== "object") return;

    const session = d.session ?? null;
    if (session && typeof session === "object") {
      if (typeof session.provider === "string") setDefaultSessionLlm((p) => ({ ...p, providerId: session.provider }));
      if (typeof session.model === "string") setDefaultSessionLlm((p) => ({ ...p, modelId: session.model }));
      if (typeof session.secretId === "string") setDefaultSessionLlm((p) => ({ ...p, secretId: session.secretId }));
    }

    const wf = d.workflowAgentRun ?? null;
    if (wf && typeof wf === "object") {
      setDefaultWorkflowAgentRunLlm((p) => ({
        ...p,
        ...(typeof wf.provider === "string" ? { providerId: wf.provider } : {}),
        ...(typeof wf.model === "string" ? { modelId: wf.model } : {}),
        ...(typeof wf.secretId === "string" ? { secretId: wf.secretId } : {}),
      }));
    }

    const tb = d.toolsetBuilder ?? null;
    if (tb && typeof tb === "object") {
      setDefaultToolsetBuilderLlm((p) => ({
        ...p,
        ...(typeof tb.provider === "string" ? { providerId: tb.provider } : {}),
        ...(typeof tb.model === "string" ? { modelId: tb.model } : {}),
        ...(typeof tb.secretId === "string" ? { secretId: tb.secretId } : {}),
      }));
    }

    llmDefaultsInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    const vertex = searchParams.get("vertex");
    if (vertex === "success") {
      toast.success(t("secrets.vertex.connected"));
    } else if (vertex === "error") {
      const code = searchParams.get("code") ?? "UNKNOWN";
      toast.error(`${t("secrets.vertex.failed")}: ${code}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presetSecrets = useMemo(() => {
    const find = (connector: string) => secrets.find((s) => s.connectorId === connector && s.name === "default") ?? null;
    return {
      openai: find("llm.openai"),
      anthropic: find("llm.anthropic"),
      gemini: find(normalizeConnectorId("llm.gemini")),
      vertex: find(normalizeConnectorId("llm.vertex.oauth")),
    };
  }, [secrets]);
  const vertexDefaultSecretId = presetSecrets.vertex?.id ?? null;

  const columns = useMemo(() => {
    return [
      {
        header: t("secrets.table.connector"),
        accessorKey: "connectorId",
        cell: ({ row }: any) => <span className="text-muted">{row.original.connectorId}</span>,
      },
      {
        header: t("secrets.table.name"),
        accessorKey: "name",
        cell: ({ row }: any) => <span className="font-medium text-text">{row.original.name}</span>,
      },
      {
        header: t("secrets.table.id"),
        accessorKey: "id",
        cell: ({ row }: any) => <span className="truncate font-mono text-xs text-muted">{row.original.id}</span>,
      },
      {
        header: t("secrets.table.open"),
        id: "open",
        cell: ({ row }: any) => (
          <Button
            size="sm"
            variant={row.original.id === selectedId ? "accent" : "outline"}
            onClick={() => setSelectedId(row.original.id)}
          >
            {t("secrets.table.open")}
          </Button>
        ),
      },
    ] as const;
  }, [selectedId]);

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("secrets.modelDefaults.title")}</CardTitle>
          <CardDescription>{t("secrets.modelDefaults.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">{t("secrets.modelDefaults.session")}</div>
              <div className="mt-3">
                <LlmConfigField orgId={orgId} mode="session" value={defaultSessionLlm} onChange={setDefaultSessionLlm} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    if (isOAuthRequiredProvider(defaultSessionLlm.providerId) && !defaultSessionLlm.secretId) {
                      toast.error("Selected provider requires secretId.");
                      return;
                    }
                    await updateSettings.mutateAsync({
                      llm: {
                        defaults: {
                          session: {
                            provider: defaultSessionLlm.providerId as any,
                            model: defaultSessionLlm.modelId.trim(),
                            secretId: defaultSessionLlm.secretId ?? null,
                          },
                        },
                      },
                    });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
              <AdvancedSection
                id="secrets-default-session-advanced"
                title={t("advanced.title")}
                description={t("advanced.description")}
                labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    await updateSettings.mutateAsync({ llm: { defaults: { session: {} } } });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.clearFilters")}
                </Button>
              </AdvancedSection>
            </div>

            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">{t("secrets.modelDefaults.workflowAgentRun")}</div>
              <div className="mt-3">
                <LlmConfigField orgId={orgId} mode="workflowAgentRun" value={defaultWorkflowAgentRunLlm} onChange={setDefaultWorkflowAgentRunLlm} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    if (isOAuthRequiredProvider(defaultWorkflowAgentRunLlm.providerId) && !defaultWorkflowAgentRunLlm.secretId) {
                      toast.error("Selected provider requires secretId.");
                      return;
                    }
                    await updateSettings.mutateAsync({
                      llm: {
                        defaults: {
                          workflowAgentRun: {
                            provider: defaultWorkflowAgentRunLlm.providerId as any,
                            model: defaultWorkflowAgentRunLlm.modelId.trim(),
                            secretId: defaultWorkflowAgentRunLlm.secretId ?? null,
                          },
                        },
                      },
                    });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
              <AdvancedSection
                id="secrets-default-workflow-advanced"
                title={t("advanced.title")}
                description={t("advanced.description")}
                labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    await updateSettings.mutateAsync({ llm: { defaults: { workflowAgentRun: {} } } });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.clearFilters")}
                </Button>
              </AdvancedSection>
            </div>

            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">{t("secrets.modelDefaults.toolsetBuilder")}</div>
              <div className="mt-3">
                <LlmConfigField orgId={orgId} mode="toolsetBuilder" value={defaultToolsetBuilderLlm} onChange={setDefaultToolsetBuilderLlm} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    if (!defaultToolsetBuilderLlm.secretId) {
                      toast.error(t("toolsets.ai.noSecretsHint"));
                      return;
                    }
                    await updateSettings.mutateAsync({
                      llm: {
                        defaults: {
                          toolsetBuilder: {
                            provider: defaultToolsetBuilderLlm.providerId as any,
                            model: defaultToolsetBuilderLlm.modelId.trim(),
                            secretId: defaultToolsetBuilderLlm.secretId ?? null,
                          },
                        },
                      },
                    });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
              <AdvancedSection
                id="secrets-default-toolset-advanced"
                title={t("advanced.title")}
                description={t("advanced.description")}
                labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOperate || updateSettings.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    await updateSettings.mutateAsync({ llm: { defaults: { toolsetBuilder: {} } } });
                    toast.success(t("common.saved"));
                  }}
                >
                  {t("common.clearFilters")}
                </Button>
              </AdvancedSection>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("secrets.presets.title")}</CardTitle>
          <CardDescription>{t("secrets.presets.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">OpenAI</div>
              <div className="mt-1 text-xs text-muted">{presetSecrets.openai ? t("secrets.presets.connected") : t("secrets.presets.notConnected")}</div>
              {presetSecrets.openai ? <div className="mt-2 break-all font-mono text-xs text-muted">{presetSecrets.openai.id}</div> : null}
              <div className="mt-3 grid gap-2">
                <Input value={openAiValue} onChange={(e) => setOpenAiValue(e.target.value)} placeholder={t("secrets.presets.pasteApiKey")} />
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!canOperate || openAiValue.trim().length === 0 || createSecret.isPending || rotateSecret.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    const value = openAiValue;
                    setOpenAiValue("");
                    if (!presetSecrets.openai) {
                      await createSecret.mutateAsync({ connectorId: "llm.openai", name: "default", value });
                      toast.success(t("secrets.presets.saved"));
                      return;
                    }
                    await rotateSecret.mutateAsync({ secretId: presetSecrets.openai.id, value });
                    toast.success(t("secrets.presets.rotated"));
                  }}
                >
                  {presetSecrets.openai ? t("common.rotate") : t("common.create")}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">Anthropic</div>
              <div className="mt-1 text-xs text-muted">{presetSecrets.anthropic ? t("secrets.presets.connected") : t("secrets.presets.notConnected")}</div>
              {presetSecrets.anthropic ? <div className="mt-2 break-all font-mono text-xs text-muted">{presetSecrets.anthropic.id}</div> : null}
              <div className="mt-3 grid gap-2">
                <Input value={anthropicValue} onChange={(e) => setAnthropicValue(e.target.value)} placeholder={t("secrets.presets.pasteApiKey")} />
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!canOperate || anthropicValue.trim().length === 0 || createSecret.isPending || rotateSecret.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    const value = anthropicValue;
                    setAnthropicValue("");
                    if (!presetSecrets.anthropic) {
                      await createSecret.mutateAsync({ connectorId: "llm.anthropic", name: "default", value });
                      toast.success(t("secrets.presets.saved"));
                      return;
                    }
                    await rotateSecret.mutateAsync({ secretId: presetSecrets.anthropic.id, value });
                    toast.success(t("secrets.presets.rotated"));
                  }}
                >
                  {presetSecrets.anthropic ? t("common.rotate") : t("common.create")}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
              <div className="text-sm font-medium text-text">Gemini</div>
              <div className="mt-1 text-xs text-muted">{presetSecrets.gemini ? t("secrets.presets.connected") : t("secrets.presets.notConnected")}</div>
              {presetSecrets.gemini ? <div className="mt-2 break-all font-mono text-xs text-muted">{presetSecrets.gemini.id}</div> : null}
              <div className="mt-3 grid gap-2">
                <Input value={geminiValue} onChange={(e) => setGeminiValue(e.target.value)} placeholder={t("secrets.presets.pasteApiKey")} />
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!canOperate || geminiValue.trim().length === 0 || createSecret.isPending || rotateSecret.isPending}
                  onClick={async () => {
                    if (!orgId) return;
                    const value = geminiValue;
                    setGeminiValue("");
                    if (!presetSecrets.gemini) {
                      await createSecret.mutateAsync({ connectorId: normalizeConnectorId("llm.gemini"), name: "default", value });
                      toast.success(t("secrets.presets.saved"));
                      return;
                    }
                    await rotateSecret.mutateAsync({ secretId: presetSecrets.gemini.id, value });
                    toast.success(t("secrets.presets.rotated"));
                  }}
                >
                  {presetSecrets.gemini ? t("common.rotate") : t("common.create")}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-borderSubtle bg-panel/40 p-4 shadow-elev1">
            <div className="text-sm font-medium text-text">{t("secrets.vertex.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("secrets.vertex.subtitle")}</div>
            {presetSecrets.vertex ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="break-all font-mono text-xs text-muted">{presetSecrets.vertex.id}</div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canOperate || !vertexDefaultSecretId}
                  onClick={async () => {
                    if (!orgId || !vertexDefaultSecretId) return;
                    await apiFetchJson(`/v1/orgs/${orgId}/llm/oauth/google-vertex/${vertexDefaultSecretId}`, { method: "DELETE" }, { orgScoped: true });
                    toast.success(t("secrets.vertex.disconnected"));
                    await secretsQuery.refetch();
                  }}
                >
                  {t("secrets.vertex.disconnect")}
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="vertex-project">{t("secrets.vertex.projectId")}</Label>
                  <Input id="vertex-project" value={vertexProjectId} onChange={(e) => setVertexProjectId(e.target.value)} placeholder="my-gcp-project" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="vertex-location">{t("secrets.vertex.location")}</Label>
                  <Input id="vertex-location" value={vertexLocation} onChange={(e) => setVertexLocation(e.target.value)} placeholder="us-central1" />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="accent"
                    disabled={!canOperate || vertexProjectId.trim().length === 0 || vertexLocation.trim().length === 0}
                    onClick={async () => {
                      if (!orgId) return;
                      const out = await apiFetchJson<{ authorizationUrl: string }>(
                        `/v1/orgs/${orgId}/llm/oauth/google-vertex/start`,
                        {
                          method: "POST",
                          body: JSON.stringify({ projectId: vertexProjectId.trim(), location: vertexLocation.trim(), mode: "json" }),
                        },
                        { orgScoped: true }
                      );
                      if (typeof out.authorizationUrl === "string" && out.authorizationUrl.length > 0) {
                        window.location.assign(out.authorizationUrl);
                      }
                    }}
                  >
                    {t("secrets.vertex.connect")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.list")}</CardTitle>
          <CardDescription>{orgId ? `Org: ${orgId}` : t("org.requireActive")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => secretsQuery.refetch()} disabled={!canOperate}>
              {t("common.refresh")}
            </Button>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="accent" disabled={!canOperate}>
                  {t("common.create")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("secrets.createSecret")}</DialogTitle>
                  <DialogDescription>{t("secrets.warning")}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="connector-id">{t("secrets.connector")}</Label>
                    <Input id="connector-id" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="secret-name">{t("secrets.name")}</Label>
                    <Input id="secret-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="secret-value">{t("secrets.value")}</Label>
                    <Input
                      id="secret-value"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={t("secrets.pasteToken")}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="accent"
                      onClick={async () => {
                        if (!orgId) {
                          toast.error(t("org.requireActive"));
                          return;
                        }
                        await createSecret.mutateAsync({ connectorId, name, value });
                        setValue("");
                        toast.success(t("secrets.secretCreated"));
                      }}
                      disabled={createSecret.isPending || value.trim().length === 0}
                    >
                      {createSecret.isPending ? t("common.loading") : t("common.create")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <div className="ml-auto text-xs text-muted">
              {secretsQuery.isFetching ? t("common.loading") : `${secrets.length} secret(s)`}
            </div>
          </div>

          <div className="mt-4">
            {secretsQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : secrets.length === 0 ? (
              <EmptyState title={t("secrets.noSecretsTitle")} description={t("secrets.warning")} />
            ) : (
              <DataTable data={secrets} columns={columns as any} />
            )}
          </div>

          {selected ? (
            <>
              <Separator className="my-4" />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-borderSubtle bg-panel/50 p-4 shadow-elev1">
                  <div className="text-sm font-medium text-text">{t("secrets.selected")}</div>
                  <div className="mt-1 text-sm text-muted">
                    {selected.connectorId}:{selected.name}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted">{selected.id}</div>
                </div>

                <div className="rounded-lg border border-borderSubtle bg-panel/50 p-4 shadow-elev1">
                  <div className="grid gap-2">
                    <Label htmlFor="rotate-value">{t("secrets.rotateValue")}</Label>
                    <Input
                      id="rotate-value"
                      value={rotateValue}
                      onChange={(e) => setRotateValue(e.target.value)}
                      placeholder={t("secrets.pasteToken")}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="accent"
                        onClick={async () => {
                          if (!orgId) {
                            toast.error(t("org.requireActive"));
                            return;
                          }
                          await rotateSecret.mutateAsync({ secretId: selected.id, value: rotateValue });
                          setRotateValue("");
                          toast.success(t("secrets.secretRotated"));
                        }}
                        disabled={rotateSecret.isPending || rotateValue.trim().length === 0}
                      >
                        {t("common.rotate")}
                      </Button>

                      <ConfirmButton
                        variant="danger"
                        title={t("secrets.deleteSecretTitle")}
                        description={t("secrets.deleteSecretDescription")}
                        confirmText={t("common.delete")}
                        disabled={deleteSecret.isPending}
                        onConfirm={async () => {
                          if (!orgId) {
                            toast.error(t("org.requireActive"));
                            return;
                          }
                          await deleteSecret.mutateAsync(selected.id);
                          setSelectedId("");
                          toast.success(t("secrets.secretDeleted"));
                        }}
                      >
                        {t("common.delete")}
                      </ConfirmButton>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {secretsQuery.isError ? (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              Failed to load secrets.
            </div>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}

export default function SecretsPage() {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("common.loading")}</div>
      }
    >
      <SecretsPageContent />
    </Suspense>
  );
}
