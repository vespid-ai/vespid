"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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

export default function SecretsPage() {
  const t = useTranslations();
  const orgId = useActiveOrgId();

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

  const canOperate = Boolean(orgId);

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
