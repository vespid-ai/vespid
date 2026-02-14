"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { CodeBlock } from "../../../../../components/ui/code-block";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../components/ui/tabs";
import { Textarea } from "../../../../../components/ui/textarea";
import { useActiveOrgId } from "../../../../../lib/hooks/use-active-org-id";
import { usePublishWorkflow, useRunWorkflow, useRuns, useWorkflow } from "../../../../../lib/hooks/use-workflows";
import { addRecentRunId, addRecentWorkflowId, getRecentRunIds } from "../../../../../lib/recents";

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, message: "Run input must be valid JSON." };
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
  const run = useRunWorkflow(orgId, workflowId);

  const [runInput, setRunInput] = useState("{\"issueKey\":\"ABC-123\"}");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (workflowId) {
      addRecentWorkflowId(workflowId);
    }
  }, [workflowId]);

  const recentRuns = useMemo(() => (workflowId ? getRecentRunIds(workflowId) : []), [workflowId, runsQuery.data]);

  async function doPublish() {
    if (!orgId) {
      toast.error("Set an active org first.");
      return;
    }
    await publish.mutateAsync();
    toast.success("Workflow published");
  }

  async function doRun() {
    if (!orgId) {
      toast.error("Set an active org first.");
      return;
    }
    if (!workflowId) {
      toast.error("Workflow ID required");
      return;
    }

    const parsed = safeParseJson(runInput);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return;
    }

    try {
      const payload = await run.mutateAsync({ input: parsed.value });
      const runId = payload.run.id;
      addRecentRunId(workflowId, runId);
      toast.success("Run queued");
      router.push(`/${locale}/workflows/${workflowId}/runs/${runId}`);
    } catch (err: any) {
      const code = err?.payload?.code;
      if (code === "QUEUE_UNAVAILABLE") {
        toast.error("Queue unavailable. Ensure Redis is running.");
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push(`/${locale}/workflows`)}>
            Back
          </Button>
          <Button variant="accent" onClick={doPublish} disabled={publish.isPending}>
            {publish.isPending ? t("common.loading") : "Publish"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">{t("workflows.runs")}</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            <Card>
              <CardHeader>
                <CardTitle>Runs</CardTitle>
                <CardDescription>{runsQuery.isFetching ? t("common.loading") : "Latest runs for this workflow."}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-[1fr_140px_120px] border-b border-border bg-panel/60 px-3 py-2 text-xs font-medium text-muted">
                    <div>Run</div>
                    <div>Status</div>
                    <div>Open</div>
                  </div>

                  {(runsQuery.data?.runs ?? []).length === 0 ? (
                    <div className="px-3 py-6 text-sm text-muted">No runs yet.</div>
                  ) : (
                    (runsQuery.data?.runs ?? []).map((r) => (
                      <div key={r.id} className="grid grid-cols-[1fr_140px_120px] items-center px-3 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-muted">{r.id}</div>
                          <div className="text-xs text-muted">{r.createdAt ?? ""}</div>
                        </div>
                        <div className="text-muted">{r.status}</div>
                        <div>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/${locale}/workflows/${workflowId}/runs/${r.id}`}>Replay</Link>
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {recentRuns.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-muted">Recent runs (local)</div>
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
                <CardTitle>Queue run</CardTitle>
                <CardDescription>POST /runs must succeed only when enqueue succeeds.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="run-input">Run input (JSON)</Label>
                  <Textarea id="run-input" value={runInput} onChange={(e) => setRunInput(e.target.value)} rows={7} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="accent" onClick={doRun} disabled={run.isPending}>
                    {run.isPending ? t("common.loading") : "Run"}
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
              <CardTitle>Workflow</CardTitle>
              <CardDescription>Read-only view of the workflow definition.</CardDescription>
            </CardHeader>
            <CardContent>
              {workflowQuery.isLoading ? (
                <div className="text-sm text-muted">{t("common.loading")}</div>
              ) : workflowQuery.data?.workflow ? (
                <CodeBlock value={workflowQuery.data.workflow} />
              ) : (
                <div className="text-sm text-muted">No workflow loaded.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="editor" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Editor (stub)</CardTitle>
              <CardDescription>Phase 2 will introduce a canvas editor via @xyflow/react.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted">Not implemented yet.</div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
