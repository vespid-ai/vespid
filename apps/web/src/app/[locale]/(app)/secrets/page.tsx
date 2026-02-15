"use client";

import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { DataTable } from "../../../../components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../../components/ui/dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Separator } from "../../../../components/ui/separator";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useCreateSecret, useDeleteSecret, useRotateSecret, useSecrets } from "../../../../lib/hooks/use-secrets";
import { apiFetchJson } from "../../../../lib/api";

function SecretsPageContent() {
  const t = useTranslations();
  const orgId = useActiveOrgId();
  const searchParams = useSearchParams();

  const secretsQuery = useSecrets(orgId);
  const createSecret = useCreateSecret(orgId);
  const rotateSecret = useRotateSecret(orgId);
  const deleteSecret = useDeleteSecret(orgId);

  const secrets = secretsQuery.data?.secrets ?? [];

  const [selectedId, setSelectedId] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);

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
      gemini: find("llm.gemini"),
      vertex: find("llm.vertex.oauth"),
    };
  }, [secrets]);

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
                      await createSecret.mutateAsync({ connectorId: "llm.gemini", name: "default", value });
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
                  disabled={!canOperate}
                  onClick={async () => {
                    if (!orgId) return;
                    await apiFetchJson(`/v1/orgs/${orgId}/llm/vertex`, { method: "DELETE" }, { orgScoped: true });
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
                    onClick={() => {
                      if (!orgId) return;
                      const url = new URL(`/api/proxy/v1/orgs/${orgId}/llm/vertex/start`, window.location.origin);
                      url.searchParams.set("projectId", vertexProjectId.trim());
                      url.searchParams.set("location", vertexLocation.trim());
                      window.location.assign(url.pathname + url.search);
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

      <div>
        <Button variant="ghost" onClick={() => setShowDebug((v) => !v)}>
          {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
        </Button>
        {showDebug ? (
          <div className="mt-2">
            <CodeBlock value={{ orgId, secrets: secretsQuery.data }} />
          </div>
        ) : null}
      </div>
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
