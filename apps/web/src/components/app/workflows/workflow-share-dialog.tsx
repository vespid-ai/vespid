"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  useCreateWorkflowShareInvitation,
  useRevokeWorkflowShare,
  useWorkflowShares,
  type WorkflowShareInvitation,
} from "../../../lib/hooks/use-workflow-shares";

type WorkflowShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  orgId: string | null;
  workflowId: string | null;
  workflowName: string;
};

function toInviteUrl(locale: string, token: string): string {
  const path = `/${locale}/workflow-share/${encodeURIComponent(token)}`;
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

export function WorkflowShareDialog(props: WorkflowShareDialogProps) {
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const sharesQuery = useWorkflowShares(props.orgId, props.workflowId, {
    includeRevoked: false,
    enabled: props.open,
  });
  const createInvitation = useCreateWorkflowShareInvitation(props.orgId, props.workflowId);
  const revokeShare = useRevokeWorkflowShare(props.orgId, props.workflowId);

  const pendingInvitations = useMemo(
    () =>
      (sharesQuery.data?.invitations ?? []).filter(
        (item) => item.status === "pending" && new Date(item.expiresAt).getTime() > Date.now()
      ),
    [sharesQuery.data?.invitations]
  );

  async function copyInviteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("workflows.share.copied"));
    } catch {
      toast.error(t("errors.copyFailed"));
    }
  }

  async function createInvite() {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      toast.error(t("workflows.share.emailRequired"));
      return;
    }
    try {
      const payload = await createInvitation.mutateAsync({ email: normalized });
      setLatestInviteUrl(payload.inviteUrl);
      await copyInviteUrl(payload.inviteUrl);
      setEmail("");
      toast.success(t("workflows.share.inviteCreated"));
    } catch (error) {
      const code = (error as any)?.payload?.code;
      if (code === "WORKFLOW_SHARE_INVITATION_ALREADY_PENDING") {
        toast.error(t("workflows.share.pendingExists"));
        return;
      }
      toast.error(t("common.unknownError"));
    }
  }

  async function revoke(shareId: string) {
    try {
      await revokeShare.mutateAsync({ shareId });
      toast.success(t("workflows.share.revoked"));
    } catch {
      toast.error(t("common.unknownError"));
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("workflows.share.title")}</DialogTitle>
          <DialogDescription>
            {t("workflows.share.subtitle", {
              workflow: props.workflowName || props.workflowId || "-",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("workflows.share.createTitle")}</CardTitle>
              <CardDescription>{t("workflows.share.createDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="workflow-share-email">{t("workflows.share.emailLabel")}</Label>
                <Input
                  id="workflow-share-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="mangaohua@gmail.com"
                  autoComplete="email"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="accent" onClick={createInvite} disabled={createInvitation.isPending}>
                  {createInvitation.isPending ? t("common.loading") : t("workflows.share.createAction")}
                </Button>
              </div>
              {latestInviteUrl ? (
                <div className="rounded-xl border border-borderSubtle/70 bg-panel/70 p-3">
                  <div className="text-xs text-muted">{t("workflows.share.latestInvite")}</div>
                  <div className="mt-1 break-all font-mono text-xs text-text">{latestInviteUrl}</div>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() => copyInviteUrl(latestInviteUrl)}
                  >
                    {t("workflows.share.copyInvite")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("workflows.share.activeAccessTitle")}</CardTitle>
              <CardDescription>{t("workflows.share.activeAccessDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {sharesQuery.isLoading ? (
                <div className="text-sm text-muted">{t("common.loading")}</div>
              ) : (sharesQuery.data?.shares ?? []).length === 0 ? (
                <div className="text-sm text-muted">{t("workflows.share.noShares")}</div>
              ) : (
                sharesQuery.data!.shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-borderSubtle/60 bg-panel/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="break-all text-sm">{share.userId}</div>
                      <div className="text-xs text-muted">{share.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="accent">{share.accessRole}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => revoke(share.id)}
                        disabled={revokeShare.isPending}
                      >
                        {t("workflows.share.revoke")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("workflows.share.pendingInvitesTitle")}</CardTitle>
              <CardDescription>{t("workflows.share.pendingInvitesDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {pendingInvitations.length === 0 ? (
                <div className="text-sm text-muted">{t("workflows.share.noPendingInvites")}</div>
              ) : (
                pendingInvitations.map((invitation) => (
                  <PendingInviteRow
                    key={invitation.id}
                    invitation={invitation}
                    locale={props.locale}
                    onCopy={copyInviteUrl}
                    copyLabel={t("workflows.share.copyInvite")}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingInviteRow(props: {
  invitation: WorkflowShareInvitation;
  locale: string;
  copyLabel: string;
  onCopy: (url: string) => void;
}) {
  const inviteUrl = useMemo(() => toInviteUrl(props.locale, props.invitation.token), [props.locale, props.invitation.token]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-borderSubtle/60 bg-panel/60 px-3 py-2">
      <div className="min-w-0">
        <div className="break-all text-sm">{props.invitation.email}</div>
        <div className="text-xs text-muted">{props.invitation.expiresAt}</div>
      </div>
      <Button size="sm" variant="outline" onClick={() => props.onCopy(inviteUrl)}>
        {props.copyLabel}
      </Button>
    </div>
  );
}
