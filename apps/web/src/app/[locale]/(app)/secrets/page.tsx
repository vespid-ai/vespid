"use client";

import { Suspense, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
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
import { isUnauthorizedError } from "../../../../lib/api";
import { useCreateSecret, useDeleteSecret, useRotateSecret, useSecrets } from "../../../../lib/hooks/use-secrets";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";

function SecretsPageContent() {
  const t = useTranslations();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const router = useRouter();

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const secretsQuery = useSecrets(scopedOrgId);
  const createSecret = useCreateSecret(scopedOrgId);
  const rotateSecret = useRotateSecret(scopedOrgId);
  const deleteSecret = useDeleteSecret(scopedOrgId);

  const [selectedId, setSelectedId] = useState<string>("");
  const [connectorId, setConnectorId] = useState("github");
  const [name, setName] = useState("default");
  const [value, setValue] = useState("");
  const [rotateValue, setRotateValue] = useState("");

  const secrets = secretsQuery.data?.secrets ?? [];
  const selected = useMemo(() => secrets.find((secret) => secret.id === selectedId) ?? null, [selectedId, secrets]);

  const columns = useMemo(() => {
    return [
      {
        header: t("secrets.table.connector"),
        accessorKey: "connectorId",
      },
      {
        header: t("secrets.table.name"),
        accessorKey: "name",
      },
      {
        header: t("secrets.table.id"),
        accessorKey: "id",
        cell: ({ row }: any) => <span className="font-mono text-xs text-muted">{String(row.original.id)}</span>,
      },
      {
        header: t("secrets.table.open"),
        id: "open",
        cell: ({ row }: any) => (
          <Button size="sm" variant={row.original.id === selectedId ? "accent" : "outline"} onClick={() => setSelectedId(row.original.id)}>
            {t("secrets.table.open")}
          </Button>
        ),
      },
    ] as const;
  }, [selectedId, t]);

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
        </div>
        <AuthRequiredState locale={locale} onRetry={() => void secretsQuery.refetch()} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
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

  if (secretsQuery.isError && isUnauthorizedError(secretsQuery.error)) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
        </div>
        <AuthRequiredState locale={locale} onRetry={() => void secretsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("secrets.modelConnectionsTitle")}</CardTitle>
          <CardDescription>{t("secrets.modelConnectionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => router.push(`/${locale}/models`)}>
            {t("secrets.openModelConnections")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.list")}</CardTitle>
          <CardDescription>{orgId ? `Org: ${orgId}` : t("org.requireActive")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => secretsQuery.refetch()}>{t("common.refresh")}</Button>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="accent">{t("common.create")}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("secrets.createSecret")}</DialogTitle>
                  <DialogDescription>{t("secrets.warning")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("secrets.connector")}</Label>
                    <Input value={connectorId} onChange={(e) => setConnectorId(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("secrets.name")}</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("secrets.value")}</Label>
                    <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("secrets.pasteToken")} />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="accent"
                      disabled={createSecret.isPending || value.trim().length === 0}
                      onClick={async () => {
                        try {
                          await createSecret.mutateAsync({ connectorId: connectorId.trim(), name: name.trim(), value: value.trim() });
                          setValue("");
                          toast.success(t("secrets.secretCreated"));
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                        }
                      }}
                    >
                      {t("common.create")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
                <div className="rounded-lg border border-borderSubtle bg-panel/45 p-3">
                  <div className="text-sm font-medium text-text">
                    {selected.connectorId}:{selected.name}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted">{selected.id}</div>
                </div>
                <div className="grid gap-2 rounded-lg border border-borderSubtle bg-panel/45 p-3">
                  <Label>{t("secrets.rotateValue")}</Label>
                  <Input value={rotateValue} onChange={(e) => setRotateValue(e.target.value)} placeholder={t("secrets.pasteToken")} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="accent"
                      disabled={rotateValue.trim().length === 0 || rotateSecret.isPending}
                      onClick={async () => {
                        try {
                          await rotateSecret.mutateAsync({ secretId: selected.id, value: rotateValue.trim() });
                          setRotateValue("");
                          toast.success(t("secrets.secretRotated"));
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                        }
                      }}
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
                        try {
                          await deleteSecret.mutateAsync(selected.id);
                          setSelectedId("");
                          toast.success(t("secrets.secretDeleted"));
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                        }
                      }}
                    >
                      {t("common.delete")}
                    </ConfirmButton>
                  </div>
                </div>
              </div>
            </>
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
        <div className="rounded-lg border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
          {t("common.loading")}
        </div>
      }
    >
      <SecretsPageContent />
    </Suspense>
  );
}
