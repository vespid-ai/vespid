"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AuthRequiredState } from "../../../../../components/app/auth-required-state";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { Label } from "../../../../../components/ui/label";
import { Textarea } from "../../../../../components/ui/textarea";
import { useSession } from "../../../../../lib/hooks/use-session";
import {
  useCreateSharedWorkflowRun,
  useSharedWorkflow,
  useSharedWorkflowRunEvents,
  useSharedWorkflowRuns,
} from "../../../../../lib/hooks/use-workflow-shares";

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

export default function SharedWorkflowPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; shareId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const shareId = Array.isArray(params?.shareId) ? (params.shareId[0] ?? "") : (params?.shareId ?? "");
  const authSession = useSession();

  const sharedQuery = useSharedWorkflow(shareId || null);
  const runsQuery = useSharedWorkflowRuns(shareId || null);
  const createRun = useCreateSharedWorkflowRun(shareId || null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runInput, setRunInput] = useState("{}");
  const eventsQuery = useSharedWorkflowRunEvents(shareId || null, selectedRunId);

  const runs = runsQuery.data?.runs ?? [];
  const events = eventsQuery.data?.events ?? [];
  const workflow = sharedQuery.data?.workflow;
  const share = sharedQuery.data?.share;

  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0]!.id);
    }
  }, [runs, selectedRunId]);

  const pageTitle = useMemo(() => workflow?.name ?? t("workflows.share.shared.title"), [workflow?.name, t]);

  async function runSharedWorkflow() {
    if (!shareId) {
      toast.error(t("workflows.share.shared.invalidShare"));
      return;
    }
    if (workflow?.status !== "published") {
      toast.error(t("workflows.share.shared.notPublished"));
      return;
    }
    const parsed = safeParseJson(runInput);
    if (!parsed.ok) {
      toast.error(t("workflows.share.shared.invalidJson"));
      return;
    }
    try {
      const payload = await createRun.mutateAsync({ input: parsed.value });
      setSelectedRunId(payload.run.id);
      toast.success(t("workflows.share.shared.runCreated"));
    } catch {
      toast.error(t("common.unknownError"));
    }
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <AuthRequiredState
        locale={locale}
        onRetry={() => {
          void authSession.refetch();
        }}
      />
    );
  }

  if (sharedQuery.isLoading) {
    return <EmptyState title={t("common.loading")} />;
  }

  if (!workflow || !share) {
    return <EmptyState title={t("workflows.share.shared.notFound")} />;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{pageTitle}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.share.shared.subtitle")}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="accent">{t("workflows.share.shared.runnerRole")}</Badge>
            <Badge variant={workflow.status === "published" ? "ok" : "warn"}>{workflow.status ?? "unknown"}</Badge>
            <Badge variant="neutral">{share.id}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.share.shared.runTitle")}</CardTitle>
            <CardDescription>{t("workflows.share.shared.runDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="shared-run-input">{t("workflows.share.shared.runInputLabel")}</Label>
              <Textarea
                id="shared-run-input"
                rows={8}
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
              />
            </div>
            <Button variant="accent" onClick={runSharedWorkflow} disabled={createRun.isPending}>
              {createRun.isPending ? t("common.loading") : t("workflows.share.shared.runAction")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.share.shared.runsTitle")}</CardTitle>
            <CardDescription>{t("workflows.share.shared.runsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {runsQuery.isLoading ? (
              <div className="text-sm text-muted">{t("common.loading")}</div>
            ) : runs.length === 0 ? (
              <div className="text-sm text-muted">{t("workflows.share.shared.noRuns")}</div>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className="rounded-xl border border-borderSubtle/60 bg-panel/60 px-3 py-2 text-left transition hover:border-borderSubtle data-[active=true]:border-2 data-[active=true]:border-accent"
                  data-active={selectedRunId === run.id ? "true" : "false"}
                >
                  <div className="text-sm font-medium">{run.id}</div>
                  <div className="text-xs text-muted">
                    {run.status} · {run.createdAt ?? "-"}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("workflows.share.shared.eventsTitle")}</CardTitle>
          <CardDescription>{t("workflows.share.shared.eventsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {!selectedRunId ? (
            <div className="text-sm text-muted">{t("workflows.share.shared.selectRun")}</div>
          ) : eventsQuery.isLoading ? (
            <div className="text-sm text-muted">{t("common.loading")}</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-muted">{t("workflows.share.shared.noEvents")}</div>
          ) : (
            events.map((event, index) => {
              const id = typeof event.id === "string" ? event.id : `event-${index + 1}`;
              const eventType = typeof event.eventType === "string" ? event.eventType : typeof event.type === "string" ? event.type : "event";
              const message = typeof event.message === "string" ? event.message : "";
              const createdAt = typeof event.createdAt === "string" ? event.createdAt : "";
              return (
                <div key={id} className="rounded-xl border border-borderSubtle/60 bg-panel/60 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{eventType}</div>
                  {message ? <div className="mt-1 text-sm">{message}</div> : null}
                  {createdAt ? <div className="mt-1 text-xs text-muted">{createdAt}</div> : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
