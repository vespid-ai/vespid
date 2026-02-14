"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Separator } from "../../../../components/ui/separator";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useAgents, useCreatePairingToken, useRevokeAgent } from "../../../../lib/hooks/use-agents";

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized.includes("active") || normalized.includes("online")) return "ok";
  if (normalized.includes("revoked") || normalized.includes("disabled")) return "danger";
  if (normalized.includes("stale") || normalized.includes("unknown")) return "warn";
  return "neutral";
}

export default function AgentsPage() {
  const t = useTranslations();
  const orgId = useActiveOrgId();

  const agentsQuery = useAgents(orgId);
  const pairing = useCreatePairingToken(orgId);
  const revoke = useRevokeAgent(orgId);

  const agents = agentsQuery.data?.agents ?? [];

  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const canOperate = Boolean(orgId);

  async function refresh() {
    if (!canOperate) {
      toast.error("Set an active org first.");
      return;
    }
    await agentsQuery.refetch();
  }

  async function createPairingToken() {
    if (!canOperate) {
      toast.error("Set an active org first.");
      return;
    }
    const payload = await pairing.mutateAsync();
    setPairingToken(payload.token);
    setPairingExpiresAt(payload.expiresAt);
    toast.success("Pairing token created");
  }

  const selectedForRevoke = useMemo(() => agents[0]?.id ?? "", [agents]);

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("agents.title")}</div>
        <div className="mt-1 text-sm text-muted">Remote execution agents paired to this organization.</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>List</CardTitle>
          <CardDescription>{orgId ? `Org: ${orgId}` : "Set an active org in the sidebar to load agents."}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refresh}>{t("common.refresh")}</Button>
            {selectedForRevoke ? (
              <ConfirmButton
                title="Revoke agent"
                description="This will prevent the agent from executing future jobs."
                confirmText={t("agents.revoke")}
                onConfirm={async () => {
                  await revoke.mutateAsync(selectedForRevoke);
                  toast.success("Agent revoked");
                }}
              >
                {t("agents.revoke")}
              </ConfirmButton>
            ) : null}
            <div className="ml-auto text-xs text-muted">
              {agentsQuery.isFetching ? t("common.loading") : `${agents.length} agent(s)`}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[1.2fr_0.6fr_0.8fr_0.8fr] gap-0 border-b border-border bg-panel/60 px-3 py-2 text-xs font-medium text-muted">
              <div>Name</div>
              <div>Status</div>
              <div>Last seen</div>
              <div>Created</div>
            </div>

            {agents.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted">No agents yet.</div>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id}
                  className="grid grid-cols-[1.2fr_0.6fr_0.8fr_0.8fr] gap-0 px-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-text">{agent.name}</div>
                    <div className="truncate text-xs text-muted">{agent.id}</div>
                  </div>
                  <div>
                    <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                  </div>
                  <div className="text-muted">{agent.lastSeenAt ?? "-"}</div>
                  <div className="text-muted">{agent.createdAt}</div>
                </div>
              ))
            )}
          </div>

          {agentsQuery.isError ? (
            <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              Failed to load agents.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("agents.pairing")}</CardTitle>
          <CardDescription>Tokens are displayed only once. They expire in 15 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button variant="accent" onClick={createPairingToken} disabled={!canOperate || pairing.isPending}>
            Create pairing token
          </Button>

          {pairingToken ? (
            <>
              <Separator />
              <CodeBlock value={{ token: pairingToken, expiresAt: pairingExpiresAt }} />
            </>
          ) : null}
        </CardContent>
      </Card>

      <div>
        <Button variant="ghost" onClick={() => setShowDebug((v) => !v)}>
          {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
        </Button>
        {showDebug ? (
          <div className="mt-2 grid gap-2">
            <CodeBlock value={{ orgId, agentsQuery: agentsQuery.data }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
