"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { CodeBlock } from "../../../../../components/ui/code-block";
import { DataTable } from "../../../../../components/ui/data-table";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../components/ui/tabs";
import { Textarea } from "../../../../../components/ui/textarea";
import { useActiveOrgId } from "../../../../../lib/hooks/use-active-org-id";
import {
  type WorkflowRun,
  useCreateWorkflowDraftFromWorkflow,
  usePublishWorkflow,
  useRunWorkflow,
  useRuns,
  useWorkflow,
} from "../../../../../lib/hooks/use-workflows";
import { addRecentRunId, addRecentWorkflowId, getRecentRunIds } from "../../../../../lib/recents";

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

export default function WorkflowDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; workflowId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const workflowId = Array.isArray(params?.workflowId) ? (params.workflowId[0] ?? "") : (params?.workflowId ?? "");

  const orgId = useActiveOrgId() ?? null;

  const workflowQuery = useWorkflow(orgId, workflowId);
  const runsQuery = useRuns(orgId, workflowId);

  const publish = usePublishWorkflow(orgId, workflowId);
  const createDraft = useCreateWorkflowDraftFromWorkflow(orgId, workflowId);
  const run = useRunWorkflow(orgId, workflowId);

  const [runInput, setRunInput] = useState("{\"issueKey\":\"ABC-123\"}");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (workflowId) {
      addRecentWorkflowId(workflowId);
    }
  }, [workflowId]);

  const recentRuns = useMemo(() => (workflowId ? getRecentRunIds(workflowId) : []), [workflowId, runsQuery.data]);
  const runs = runsQuery.data?.runs ?? [];

  const columns = useMemo(() => {
    return [
      {
        header: t("workflows.detail.table.run"),
        accessorKey: "id",
        cell: ({ row }: any) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-muted">{row.original.id}</div>
            <div className="text-xs text-muted">{row.original.createdAt ?? ""}</div>
          </div>
        ),
      },
      {
        header: t("workflows.detail.table.status"),
        accessorKey: "status",
        cell: ({ row }: any) => {
          const status = String(row.original.status ?? "");
          const variant =
            status === "succeeded" ? "ok" : status === "failed" ? "danger" : status === "running" ? "accent" : "neutral";
          return <Badge variant={variant as any}>{status}</Badge>;
        },
      },
      {
        header: t("workflows.detail.table.open"),
        id: "open",
        cell: ({ row }: any) => (
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/workflows/${workflowId}/runs/${row.original.id}`}>{t("workflows.detail.table.replay")}</Link>
          </Button>
        ),
      },
    ] as const;
  }, [locale, t, workflowId]);

  async function doPublish() {
    if (!orgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }
    await publish.mutateAsync();
    toast.success(t("workflows.detail.published"));
  }

  async function doCreateDraft() {
    if (!orgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }
    try {
      const payload = await createDraft.mutateAsync();
      const newId = payload.workflow.id;
      toast.success(t("workflows.detail.draftCreated"));
      router.push(`/${locale}/workflows/${newId}`);
    } catch {
      toast.error(t("workflows.detail.draftCreateFailed"));
    }
  }

  async function doRun() {
    if (!orgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }
    if (!workflowId) {
      toast.error(t("workflows.errors.workflowIdRequired"));
      return;
    }

    const status = workflowQuery.data?.workflow?.status ?? "unknown";
    if (status !== "published") {
      toast.error(t("workflows.detail.mustPublishToRun"));
      return;
    }

    const parsed = safeParseJson(runInput);
    if (!parsed.ok) {
      toast.error(t("workflows.detail.invalidJson"));
      return;
    }

    try {
      const payload = await run.mutateAsync({ input: parsed.value });
      const runId = payload.run.id;
      addRecentRunId(workflowId, runId);
      toast.success(t("workflows.detail.queued"));
      router.push(`/${locale}/workflows/${workflowId}/runs/${runId}`);
    } catch (err: any) {
      const code = err?.payload?.code;
      if (code === "QUEUE_UNAVAILABLE") {
        toast.error(t("workflows.detail.queueUnavailable"));
        return;
      }
      throw err;
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">
            {workflowQuery.data?.workflow?.name ?? workflowId.slice(0, 8) ?? "Workflow"}
          </div>
          <div className="mt-1 text-sm text-muted break-all">{workflowId}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {workflowQuery.data?.workflow?.status ? (
              <Badge variant={workflowQuery.data.workflow.status === "published" ? "ok" : "neutral"}>
                {workflowQuery.data.workflow.status}
              </Badge>
            ) : null}
            {workflowQuery.data?.workflow?.revision ? (
              <Badge variant="neutral" className="border-dashed">
                rev {workflowQuery.data.workflow.revision}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
          {workflowQuery.data?.workflow?.status === "published" ? (
            <Button variant="accent" onClick={doCreateDraft} disabled={createDraft.isPending}>
              {createDraft.isPending ? t("common.loading") : t("workflows.detail.createDraft")}
            </Button>
          ) : (
            <Button variant="accent" onClick={doPublish} disabled={publish.isPending}>
              {publish.isPending ? t("common.loading") : t("workflows.detail.publish")}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">{t("workflows.runs")}</TabsTrigger>
          <TabsTrigger value="overview">{t("workflows.detail.tabOverview")}</TabsTrigger>
          <TabsTrigger value="editor">{t("workflows.detail.tabEditor")}</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            <Card>
              <CardHeader>
                <CardTitle>{t("workflows.detail.runsTitle")}</CardTitle>
                <CardDescription>{runsQuery.isFetching ? t("common.loading") : t("workflows.detail.runsHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                {runsQuery.isLoading ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                ) : runs.length === 0 ? (
                  <EmptyState title={t("workflows.detail.noRunsTitle")} description={t("workflows.detail.noRunsHint")} />
                ) : (
                  <DataTable<WorkflowRun> data={runs} columns={columns as any} />
                )}

                {recentRuns.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-muted">{t("workflows.detail.recentRunsLocal")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recentRuns.map((id) => (
                        <Button key={id} variant="outline" size="sm" asChild>
                          <Link href={`/${locale}/workflows/${workflowId}/runs/${id}`}>{id.slice(0, 8)}</Link>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("workflows.detail.queueRunTitle")}</CardTitle>
                <CardDescription>{t("workflows.detail.queueRunHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="run-input">{t("workflows.detail.runInputLabel")}</Label>
                  <Textarea id="run-input" value={runInput} onChange={(e) => setRunInput(e.target.value)} rows={7} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="accent" onClick={doRun} disabled={run.isPending}>
                    {run.isPending ? t("common.loading") : t("workflows.detail.run")}
                  </Button>
                  <Button variant="outline" onClick={() => setShowDebug((v) => !v)}>
                    {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
                  </Button>
                </div>

                {showDebug ? (
                  <div className="grid gap-2">
                    <CodeBlock value={{ workflow: workflowQuery.data, runs: runsQuery.data }} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("workflows.detail.workflowTitle")}</CardTitle>
              <CardDescription>{t("workflows.detail.workflowHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {workflowQuery.isLoading ? (
                <div className="text-sm text-muted">{t("common.loading")}</div>
              ) : workflowQuery.data?.workflow ? (
                <div className="grid gap-3">
                  <div className="grid gap-1 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-muted">{t("workflows.detail.familyId")}:</span>
                      <span className="font-mono text-xs break-all">{workflowQuery.data.workflow.familyId ?? "-"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-muted">{t("workflows.detail.revision")}:</span>
                      <span className="font-mono text-xs">{String(workflowQuery.data.workflow.revision ?? "-")}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-muted">{t("workflows.detail.sourceWorkflowId")}:</span>
                      <span className="font-mono text-xs break-all">
                        {workflowQuery.data.workflow.sourceWorkflowId ?? "-"}
                      </span>
                    </div>
                  </div>
                  <CodeBlock value={workflowQuery.data.workflow} />
                </div>
              ) : (
                <div className="text-sm text-muted">{t("workflows.detail.noWorkflow")}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="editor" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("workflows.detail.editorStubTitle")}</CardTitle>
              <CardDescription>{t("workflows.detail.editorStubHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm text-muted">Graph editor (v3) is available.</div>
                <Button asChild size="sm" variant="accent">
                  <Link href={`/${locale}/workflows/${workflowId}/graph`}>Open Graph Editor</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
