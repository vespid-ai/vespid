"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../../components/ui/dialog";
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

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("secrets.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("secrets.warning")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>List</CardTitle>
          <CardDescription>{orgId ? `Org: ${orgId}` : "Set an active org in the sidebar to load secrets."}</CardDescription>
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
                  <DialogTitle>Create secret</DialogTitle>
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
                      placeholder="Paste token..."
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="accent"
                      onClick={async () => {
                        if (!orgId) {
                          toast.error("Set an active org first.");
                          return;
                        }
                        await createSecret.mutateAsync({ connectorId, name, value });
                        setValue("");
                        toast.success("Secret created");
                      }}
                      disabled={createSecret.isPending || value.trim().length === 0}
                    >
                      {createSecret.isPending ? t("common.loading") : "Create"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <div className="ml-auto text-xs text-muted">
              {secretsQuery.isFetching ? t("common.loading") : `${secrets.length} secret(s)`}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[0.9fr_1fr_1fr_120px] border-b border-border bg-panel/60 px-3 py-2 text-xs font-medium text-muted">
              <div>Connector</div>
              <div>Name</div>
              <div>ID</div>
              <div>Actions</div>
            </div>

            {secrets.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted">No secrets yet.</div>
            ) : (
              secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="grid grid-cols-[0.9fr_1fr_1fr_120px] items-center px-3 py-3 text-sm"
                >
                  <div className="text-muted">{secret.connectorId}</div>
                  <div className="font-medium text-text">{secret.name}</div>
                  <div className="truncate font-mono text-xs text-muted">{secret.id}</div>
                  <div>
                    <Button
                      size="sm"
                      variant={secret.id === selectedId ? "accent" : "outline"}
                      onClick={() => setSelectedId(secret.id)}
                    >
                      Select
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {selected ? (
            <>
              <Separator className="my-4" />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-panel/50 p-4">
                  <div className="text-sm font-medium text-text">Selected</div>
                  <div className="mt-1 text-sm text-muted">
                    {selected.connectorId}:{selected.name}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted">{selected.id}</div>
                </div>

                <div className="rounded-lg border border-border bg-panel/50 p-4">
                  <div className="grid gap-2">
                    <Label htmlFor="rotate-value">Rotate value</Label>
                    <Input
                      id="rotate-value"
                      value={rotateValue}
                      onChange={(e) => setRotateValue(e.target.value)}
                      placeholder="Paste new token..."
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="accent"
                        onClick={async () => {
                          if (!orgId) {
                            toast.error("Set an active org first.");
                            return;
                          }
                          await rotateSecret.mutateAsync({ secretId: selected.id, value: rotateValue });
                          setRotateValue("");
                          toast.success("Secret rotated");
                        }}
                        disabled={rotateSecret.isPending || rotateValue.trim().length === 0}
                      >
                        {t("common.rotate")}
                      </Button>

                      <ConfirmButton
                        variant="danger"
                        title="Delete secret"
                        description="This cannot be undone."
                        confirmText={t("common.delete")}
                        disabled={deleteSecret.isPending}
                        onConfirm={async () => {
                          if (!orgId) {
                            toast.error("Set an active org first.");
                            return;
                          }
                          await deleteSecret.mutateAsync(selected.id);
                          setSelectedId("");
                          toast.success("Secret deleted");
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
