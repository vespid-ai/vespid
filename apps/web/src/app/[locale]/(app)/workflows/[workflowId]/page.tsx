"use client";

import "@xyflow/react/dist/style.css";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { CodeBlock } from "../../../../../components/ui/code-block";
import { DataTable } from "../../../../../components/ui/data-table";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { Label } from "../../../../../components/ui/label";
import { Sheet, SheetClose, SheetContent } from "../../../../../components/ui/sheet";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../components/ui/tabs";
import { Textarea } from "../../../../../components/ui/textarea";
import { WorkflowGraphEditor } from "../../../../../components/app/workflow-graph-editor";
import { AdvancedSection } from "../../../../../components/app/advanced-section";
import { AuthRequiredState } from "../../../../../components/app/auth-required-state";
import { useActiveOrgId } from "../../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../../lib/hooks/use-session";
import {
  type WorkflowRun,
  useClonePublishedWorkflowToDraft,
  useCreateWorkflowDraftFromWorkflow,
  usePublishWorkflow,
  useRunWorkflow,
  useRuns,
  useWorkflow,
  useWorkflowRevisions,
} from "../../../../../lib/hooks/use-workflows";
import { addRecentRunId, addRecentWorkflowId, getRecentRunIds } from "../../../../../lib/recents";
import { isUnauthorizedError } from "../../../../../lib/api";

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

function getDslInfo(dsl: unknown): { version: string; nodeCount: number | null } {
  if (!dsl || typeof dsl !== "object") {
    return { version: "unknown", nodeCount: null };
  }
  const v = (dsl as any).version;
  if (v === "v2") {
    const nodes = (dsl as any).nodes;
    return { version: "v2", nodeCount: Array.isArray(nodes) ? nodes.length : null };
  }
  if (v === "v3") {
    const graphNodes = (dsl as any)?.graph?.nodes;
    return { version: "v3", nodeCount: graphNodes && typeof graphNodes === "object" ? Object.keys(graphNodes).length : null };
  }
  return { version: typeof v === "string" ? v : "unknown", nodeCount: null };
}

export default function WorkflowDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; workflowId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const workflowId = Array.isArray(params?.workflowId) ? (params.workflowId[0] ?? "") : (params?.workflowId ?? "");

  const orgId = useActiveOrgId() ?? null;
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const workflowQuery = useWorkflow(scopedOrgId, workflowId);
  const runsQuery = useRuns(scopedOrgId, workflowId);
  const revisionsQuery = useWorkflowRevisions(scopedOrgId, workflowId);

  const publish = usePublishWorkflow(scopedOrgId, workflowId);
  const createDraft = useCreateWorkflowDraftFromWorkflow(scopedOrgId, workflowId);
  const clonePublished = useClonePublishedWorkflowToDraft(scopedOrgId);
  const run = useRunWorkflow(scopedOrgId, workflowId);

  const [runInput, setRunInput] = useState("{\"issueKey\":\"ABC-123\"}");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSection, setDetailSection] = useState<"summary" | "history">("summary");
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (workflowId) {
      addRecentWorkflowId(workflowId);
    }
  }, [workflowId]);

  const recentRuns = useMemo(() => (workflowId ? getRecentRunIds(workflowId) : []), [workflowId, runsQuery.data]);
  const runs = runsQuery.data?.runs ?? [];
  const revisions = revisionsQuery.data?.workflows ?? [];
  const revisionCount = revisions.length;

  const loadedWorkflow = workflowQuery.data?.workflow ?? null;
  const dslInfo = useMemo(() => getDslInfo(loadedWorkflow?.dsl), [loadedWorkflow?.dsl]);
  const createdAtShort = String(loadedWorkflow?.createdAt ?? "").slice(0, 19);
  const updatedAtShort = String(loadedWorkflow?.updatedAt ?? "").slice(0, 19);

  useEffect(() => {
    if (!detailOpen) return;
    if (detailSection === "history") {
      historyRef.current?.scrollIntoView({ block: "start" });
      return;
    }
    summaryRef.current?.scrollIntoView({ block: "start" });
  }, [detailOpen, detailSection]);

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

  async function copyToClipboard(input: { label: string; value: string }) {
    try {
      await navigator.clipboard.writeText(input.value);
      toast.success(t("workflows.detail.sheet.copied", { label: input.label }));
    } catch {
      toast.error(t("errors.copyFailed"));
    }
  }

  function openDetails(section: "summary" | "history") {
    setDetailSection(section);
    setDetailOpen(true);
  }

  async function doPublish() {
    if (!scopedOrgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }
    await publish.mutateAsync();
    toast.success(t("workflows.detail.published"));
  }

  async function doCreateDraft() {
    if (!scopedOrgId) {
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
    if (!scopedOrgId) {
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

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("workflows.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
          </div>
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void workflowQuery.refetch();
            void runsQuery.refetch();
            void revisionsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("workflows.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
          </div>
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
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

  const unauthorized =
    (workflowQuery.isError && isUnauthorizedError(workflowQuery.error)) ||
    (runsQuery.isError && isUnauthorizedError(runsQuery.error)) ||
    (revisionsQuery.isError && isUnauthorizedError(revisionsQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("workflows.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
          </div>
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void workflowQuery.refetch();
            void runsQuery.refetch();
            void revisionsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (workflowQuery.isLoading && !loadedWorkflow) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("workflows.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
          </div>
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState title={t("common.loading")} />
      </div>
    );
  }

  if (!loadedWorkflow) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("workflows.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
          </div>
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState title={t("common.notFound")} />
      </div>
    );
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
          <Button variant="outline" onClick={() => openDetails("summary")}>
            {t("workflows.detail.infoButton")}
          </Button>
          {revisionCount >= 2 ? (
            <Button variant="outline" onClick={() => openDetails("history")}>
              {t("workflows.detail.historyButton", { count: revisionCount })}
            </Button>
          ) : null}
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

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="runs">{t("workflows.runs")}</TabsTrigger>
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
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="editor" className="mt-4" forceMount>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-text">{t("workflows.detail.tabEditor")}</div>
              <div className="text-xs text-muted">{t("workflows.detail.sheet.title")}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openDetails("summary")}>
                {t("workflows.detail.infoButton")}
              </Button>
              {revisionCount >= 2 ? (
                <Button variant="outline" size="sm" onClick={() => openDetails("history")}>
                  {t("workflows.detail.historyButton", { count: revisionCount })}
                </Button>
              ) : null}
            </div>
          </div>
          <WorkflowGraphEditor variant="embedded" locale={locale} workflowId={workflowId} />
        </TabsContent>
      </Tabs>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent
          side="right"
          title={t("workflows.detail.sheet.title")}
          className="w-[min(92vw,540px)]"
        >
          <div className="flex h-dvh flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-borderSubtle/60 px-5 py-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text">{t("workflows.detail.sheet.title")}</div>
                <div className="mt-1 truncate text-xs text-muted">{loadedWorkflow?.name ?? workflowId.slice(0, 8)}</div>
              </div>
              <SheetClose asChild>
                <Button size="sm" variant="outline">
                  {t("common.close")}
                </Button>
              </SheetClose>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <div ref={summaryRef} />
              <div className="text-xs uppercase tracking-[0.28em] text-muted">{t("workflows.detail.sheet.summaryTitle")}</div>
              <div className="mt-3 grid gap-3 rounded-2xl border border-borderSubtle/70 bg-panel/60 p-4 text-sm shadow-inset">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.name")}</div>
                  <div className="text-muted">{loadedWorkflow?.name ?? "-"}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.status")}</div>
                  <div className="text-muted">{String(loadedWorkflow?.status ?? "-")}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.dslVersion")}</div>
                  <div className="font-mono text-xs text-muted">{dslInfo.version}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.nodeCount")}</div>
                  <div className="font-mono text-xs text-muted">{dslInfo.nodeCount ?? "-"}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.revision")}</div>
                  <div className="font-mono text-xs text-muted">{String(loadedWorkflow?.revision ?? "-")}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.workflowId")}</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted">{workflowId.slice(0, 8)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard({ label: "workflowId", value: workflowId })}
                    >
                      {t("workflows.detail.sheet.copy")}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.familyId")}</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted">{String(loadedWorkflow?.familyId ?? "-").slice(0, 8)}</span>
                    {loadedWorkflow?.familyId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard({ label: "familyId", value: String(loadedWorkflow.familyId) })}
                      >
                        {t("workflows.detail.sheet.copy")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.sourceId")}</div>
                  <div className="font-mono text-xs text-muted">{String(loadedWorkflow?.sourceWorkflowId ?? "-").slice(0, 8)}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.createdAt")}</div>
                  <div className="font-mono text-xs text-muted">{createdAtShort || "-"}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-text">{t("workflows.detail.sheet.fields.updatedAt")}</div>
                  <div className="font-mono text-xs text-muted">{updatedAtShort || "-"}</div>
                </div>
              </div>

              <div className="mt-6" ref={historyRef} />
              <div className="flex items-end justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.28em] text-muted">{t("workflows.detail.sheet.historyTitle")}</div>
                {revisionCount >= 2 ? (
                  <div className="text-xs text-muted">{t("workflows.detail.historyButton", { count: revisionCount })}</div>
                ) : (
                  <div className="text-xs text-muted">—</div>
                )}
              </div>

              {revisionsQuery.isLoading ? (
                <div className="mt-3 text-sm text-muted">{t("common.loading")}</div>
              ) : revisionCount < 2 ? (
                <div className="mt-3 rounded-2xl border border-borderSubtle/70 bg-panel/60 p-4 text-sm text-muted shadow-inset">
                  {t("workflows.detail.sheet.historyEmpty")}
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {[...revisions]
                    .sort((a: any, b: any) => Number(b.revision ?? 0) - Number(a.revision ?? 0))
                    .map((wf: any) => (
                      <div key={wf.id} className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-4 shadow-inset">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-text">
                              rev {String(wf.revision ?? "-")} · {String(wf.status ?? "-")}
                            </div>
                            <div className="mt-1 font-mono text-xs text-muted">{String(wf.updatedAt ?? "").slice(0, 19) || "-"}</div>
                            <div className="mt-1 font-mono text-xs text-muted">{String(wf.id ?? "").slice(0, 12)}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/workflows/${wf.id}`)}>
                              {t("workflows.list.open")}
                            </Button>
                            {wf.status === "published" ? (
                              <Button
                                size="sm"
                                variant="accent"
                                disabled={clonePublished.isPending}
                                onClick={async () => {
                                  try {
                                    const payload = await clonePublished.mutateAsync({ workflowId: wf.id });
                                    toast.success(t("workflows.detail.draftCreated"));
                                    router.push(`/${locale}/workflows/${payload.workflow.id}`);
                                  } catch {
                                    toast.error(t("workflows.detail.draftCreateFailed"));
                                  }
                                }}
                              >
                                {clonePublished.isPending ? t("common.loading") : t("workflows.detail.createDraft")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-6">
                <AdvancedSection
                  id="workflow-detail-advanced-json"
                  title={t("workflows.detail.sheet.advancedTitle")}
                  labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
                >
                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-3 shadow-inset">
                      <div className="text-xs font-semibold text-muted">workflow</div>
                      <CodeBlock value={workflowQuery.data?.workflow ?? null} />
                    </div>
                    <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-3 shadow-inset">
                      <div className="text-xs font-semibold text-muted">revisions</div>
                      <CodeBlock value={revisionsQuery.data?.workflows ?? []} />
                    </div>
                    <div className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-3 shadow-inset">
                      <div className="text-xs font-semibold text-muted">runs</div>
                      <CodeBlock value={runsQuery.data?.runs ?? []} />
                    </div>
                  </div>
                </AdvancedSection>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
