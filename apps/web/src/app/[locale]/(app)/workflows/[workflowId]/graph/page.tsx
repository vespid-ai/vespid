"use client";

import "@xyflow/react/dist/style.css";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActiveOrgId } from "../../../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../../../lib/hooks/use-session";
import { WorkflowGraphEditor } from "../../../../../../components/app/workflow-graph-editor";
import { EmptyState } from "../../../../../../components/ui/empty-state";
import { Button } from "../../../../../../components/ui/button";
import { AuthRequiredState } from "../../../../../../components/app/auth-required-state";

export default function WorkflowGraphEditorPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; workflowId?: string | string[] }>();
  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const workflowId = Array.isArray(params?.workflowId) ? (params.workflowId[0] ?? "") : (params?.workflowId ?? "");

  if (authSession.isLoading) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <EmptyState title={t("common.loading")} />
      </div>
    );
  }

  if (!authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <AuthRequiredState locale={locale} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
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

  return <WorkflowGraphEditor variant="full" locale={locale} workflowId={workflowId} />;
}
