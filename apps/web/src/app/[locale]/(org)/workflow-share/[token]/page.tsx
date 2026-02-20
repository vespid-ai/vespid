"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { useSession } from "../../../../../lib/hooks/use-session";
import { useAcceptWorkflowShareInvitation } from "../../../../../lib/hooks/use-workflow-shares";

function readErrorCode(error: unknown): string | null {
  const code = (error as any)?.payload?.code;
  return typeof code === "string" ? code : null;
}

export default function WorkflowShareAcceptPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; token?: string | string[] }>();
  const authSession = useSession();
  const acceptInvitation = useAcceptWorkflowShareInvitation();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const tokenRaw = Array.isArray(params?.token) ? (params.token[0] ?? "") : (params?.token ?? "");
  const token = useMemo(() => {
    try {
      return decodeURIComponent(tokenRaw);
    } catch {
      return tokenRaw;
    }
  }, [tokenRaw]);

  const acceptedShareId = acceptInvitation.data?.share?.id ?? null;
  const authHref = `/${locale}/auth`;

  async function doAccept() {
    if (!token) {
      setErrorCode("BAD_REQUEST");
      return;
    }
    setErrorCode(null);
    try {
      const payload = await acceptInvitation.mutateAsync({ token });
      router.push(`/${locale}/shared-workflows/${payload.share.id}`);
    } catch (error) {
      setErrorCode(readErrorCode(error) ?? "UNKNOWN");
    }
  }

  function renderErrorMessage() {
    if (!errorCode) {
      return null;
    }
    if (errorCode === "WORKFLOW_SHARE_INVITATION_EMAIL_MISMATCH") {
      return t("workflows.share.accept.errors.emailMismatch");
    }
    if (errorCode === "WORKFLOW_SHARE_INVITATION_EXPIRED") {
      return t("workflows.share.accept.errors.expired");
    }
    if (errorCode === "WORKFLOW_SHARE_INVITATION_NOT_PENDING") {
      return t("workflows.share.accept.errors.notPending");
    }
    if (errorCode === "WORKFLOW_SHARE_INVITATION_NOT_FOUND") {
      return t("workflows.share.accept.errors.notFound");
    }
    if (errorCode === "UNAUTHORIZED") {
      return t("workflows.share.accept.errors.loginRequired");
    }
    return t("common.unknownError");
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.share.accept.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("workflows.share.accept.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant={token ? "accent" : "warn"}>{token ? t("workflows.share.accept.token") : t("common.error")}</Badge>
            <CardTitle>{t("workflows.share.accept.cardTitle")}</CardTitle>
          </div>
          <CardDescription className="break-all">{token || t("workflows.share.accept.missingToken")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!authSession.data?.session ? (
            <div className="rounded-xl border border-borderSubtle/70 bg-panel/60 p-3 text-sm text-muted">
              {t("workflows.share.accept.loginHint")}
            </div>
          ) : null}

          {renderErrorMessage() ? (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{renderErrorMessage()}</div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="accent"
              onClick={doAccept}
              disabled={!token || acceptInvitation.isPending || !authSession.data?.session}
            >
              {acceptInvitation.isPending ? t("common.loading") : t("workflows.share.accept.acceptAction")}
            </Button>
            <Button asChild variant="outline">
              <Link href={authHref}>{t("workflows.share.accept.goAuth")}</Link>
            </Button>
            {acceptedShareId ? (
              <Button asChild variant="outline">
                <Link href={`/${locale}/shared-workflows/${acceptedShareId}`}>{t("workflows.share.accept.openSharedWorkflow")}</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
