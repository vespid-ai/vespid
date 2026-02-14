"use client";

import { Group, Panel, Separator as PanelSeparator } from "react-resizable-panels";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Filter, Search } from "lucide-react";
import { Badge } from "../../../../../../../components/ui/badge";
import { Button } from "../../../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { CodeBlock } from "../../../../../../../components/ui/code-block";
import { Input } from "../../../../../../../components/ui/input";
import { ScrollArea } from "../../../../../../../components/ui/scroll-area";
import { Separator } from "../../../../../../../components/ui/separator";
import { useActiveOrgId } from "../../../../../../../lib/hooks/use-active-org-id";
import { useRun, useRunEvents } from "../../../../../../../lib/hooks/use-workflows";
import { addRecentRunId } from "../../../../../../../lib/recents";
import { groupEventsByAttempt } from "../../../../../../../lib/run-events";
import { cn } from "../../../../../../../lib/cn";

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" | "accent" {
  const normalized = status.toLowerCase();
  if (normalized === "succeeded") return "ok";
  if (normalized === "failed") return "danger";
  if (normalized === "running") return "accent";
  return "neutral";
}

function eventTitle(event: Record<string, unknown>): string {
  const nodeId = typeof event.nodeId === "string" ? event.nodeId : "";
  const type = typeof event.type === "string" ? event.type : "event";
  return nodeId ? `${nodeId} · ${type}` : type;
}

export default function RunReplayPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{
    locale?: string | string[];
    workflowId?: string | string[];
    runId?: string | string[];
  }>();

  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");
  const workflowId = Array.isArray(params?.workflowId) ? (params.workflowId[0] ?? "") : (params?.workflowId ?? "");
  const runId = Array.isArray(params?.runId) ? (params.runId[0] ?? "") : (params?.runId ?? "");

  const orgId = useActiveOrgId() ?? null;

  const runQuery = useRun(orgId, workflowId, runId);
  const eventsQuery = useRunEvents(orgId, workflowId, runId);

  const events = eventsQuery.data?.events ?? [];

  useEffect(() => {
    if (workflowId && runId) {
      addRecentRunId(workflowId, runId);
    }
  }, [runId, workflowId]);

  const groups = useMemo(() => groupEventsByAttempt(events), [events]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    if (selectedKey) {
      return;
    }
    const first = events[0];
    if (first) {
      const id = typeof first.id === "string" ? first.id : "0";
      setSelectedKey(id);
    }
  }, [events, selectedKey]);

  const flat = useMemo(() => {
    return groups.flatMap((g) => g.events.map((e, idx) => ({ e, idx, attempt: g.attempt })));
  }, [groups]);

  const selectedEvent = useMemo(() => {
    if (!selectedKey) return null;
    return flat.find((x) => (typeof x.e.id === "string" ? x.e.id : String(x.idx)) === selectedKey)?.e ?? null;
  }, [flat, selectedKey]);

  const filtered = useMemo(() => {
    const normalizedType = typeFilter.trim().toLowerCase();
    const normalizedSearch = search.trim().toLowerCase();

    return flat.filter(({ e }) => {
      const type = typeof e.type === "string" ? e.type : "";
      if (normalizedType && !type.toLowerCase().includes(normalizedType)) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      try {
        return JSON.stringify(e).toLowerCase().includes(normalizedSearch);
      } catch {
        return false;
      }
    });
  }, [flat, search, typeFilter]);

  const eventKeys = useMemo(() => {
    return new Set(filtered.map((x) => (typeof x.e.id === "string" ? x.e.id : String(x.idx))));
  }, [filtered]);

  useEffect(() => {
    if (selectedKey && eventKeys.has(selectedKey)) {
      return;
    }
    const next = filtered[0];
    if (next) {
      setSelectedKey(typeof next.e.id === "string" ? next.e.id : String(next.idx));
    }
  }, [eventKeys, filtered, selectedKey]);

  function back() {
    router.push(`/${locale}/workflows/${workflowId}`);
  }

  function copyRunId() {
    navigator.clipboard
      .writeText(runId)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Copy failed"));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("runs.title")}</div>
            {runQuery.data?.run?.status ? <Badge variant={statusVariant(runQuery.data.run.status)}>{runQuery.data.run.status}</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono">{runId}</span>
            <Button size="sm" variant="ghost" onClick={copyRunId}>
              Copy
            </Button>
            <span>Org: {orgId ?? "-"}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={back} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button variant="outline" onClick={() => eventsQuery.refetch()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

        <div className="rounded-lg border border-border bg-panel/50 shadow-panel">
        <Group orientation="horizontal" className="h-[calc(100dvh-220px)] min-h-[520px]">
          <Panel defaultSize={28} minSize={18}>
            <div className="h-full">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.timeline")}</div>
                <div className="text-xs text-muted">{eventsQuery.isFetching ? t("common.loading") : `${events.length} events`}</div>
              </div>

              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <div className="flex items-center gap-2 rounded-md border border-border bg-panel/60 px-2 py-1 text-xs text-muted">
                  <Filter className="h-3.5 w-3.5" />
                  <input
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    placeholder="type"
                    className="w-24 bg-transparent outline-none placeholder:text-muted"
                  />
                </div>
                <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-panel/60 px-2 py-1 text-xs text-muted">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("runs.search")}
                    className="w-full bg-transparent outline-none placeholder:text-muted"
                  />
                </div>
              </div>

              <ScrollArea className="h-[calc(100%-104px)]">
                <div className="p-2">
                  {groups.length === 0 ? <div className="px-2 py-6 text-sm text-muted">No events yet.</div> : null}

                  {groups.map((group) => {
                    const label = group.attempt === null ? "Attempt ?" : `Attempt ${group.attempt}`;
                    return (
                      <div key={label} className="mb-4">
                        <div className="px-2 py-1 text-xs font-medium text-muted">{label}</div>
                        <div className="mt-1 grid gap-1">
                          {group.events.map((event, idx) => {
                            const key = typeof event.id === "string" ? event.id : String(idx);
                            if (!eventKeys.has(key)) {
                              return null;
                            }
                            const title = eventTitle(event as any);
                            const when = typeof event.createdAt === "string" ? event.createdAt : "";
                            const active = key === selectedKey;

                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setSelectedKey(key)}
                                className={cn(
                                  "w-full rounded-md border px-2 py-2 text-left",
                                  active
                                    ? "border-accent/40 bg-panelElev/70"
                                    : "border-border bg-panel/40 hover:bg-panel/70"
                                )}
                              >
                                <div className="truncate text-xs font-medium text-text">{title}</div>
                                <div className="mt-1 truncate text-[11px] text-muted">{when}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </Panel>

          <PanelSeparator className="w-px bg-border" />

          <Panel defaultSize={44} minSize={26}>
            <div className="h-full">
              <div className="border-b border-border px-4 py-3">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.details")}</div>
                <div className="mt-1 text-xs text-muted">Selected event payload and run status.</div>
              </div>

              <ScrollArea className="h-[calc(100%-52px)]">
                <div className="p-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Run</CardTitle>
                      <CardDescription>Live snapshot (auto-refreshed).</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {runQuery.data?.run ? <CodeBlock value={runQuery.data.run} /> : <div className="text-sm text-muted">No run loaded.</div>}
                    </CardContent>
                  </Card>

                  <Separator className="my-4" />

                  <Card>
                    <CardHeader>
                      <CardTitle>Event</CardTitle>
                      <CardDescription>{selectedEvent ? eventTitle(selectedEvent as any) : "Select an event"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {selectedEvent ? <CodeBlock value={selectedEvent} /> : <div className="text-sm text-muted">No event selected.</div>}
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          </Panel>

          <PanelSeparator className="w-px bg-border" />

          <Panel defaultSize={28} minSize={18}>
            <div className="h-full">
              <div className="border-b border-border px-4 py-3">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.inspector")}</div>
                <div className="mt-1 text-xs text-muted">Quick filters and pinned fields (stub).</div>
              </div>
              <ScrollArea className="h-[calc(100%-52px)]">
                <div className="p-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Search</CardTitle>
                      <CardDescription>Client-side search across event JSON.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <div className="grid gap-1.5">
                        <div className="text-xs font-medium text-muted">Type filter</div>
                        <Input value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="workflow.node.*" />
                      </div>
                      <div className="grid gap-1.5">
                        <div className="text-xs font-medium text-muted">Payload search</div>
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="error / nodeId / ..." />
                      </div>
                      <Button variant="outline" onClick={() => {
                        setTypeFilter("");
                        setSearch("");
                      }}>
                        Clear
                      </Button>
                    </CardContent>
                  </Card>

                  <Separator className="my-4" />

                  <Card>
                    <CardHeader>
                      <CardTitle>Health</CardTitle>
                      <CardDescription>Fetch errors, if any.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {eventsQuery.isError ? (
                        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">Failed to load events.</div>
                      ) : runQuery.isError ? (
                        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">Failed to load run.</div>
                      ) : (
                        <div className="text-sm text-muted">OK</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          </Panel>
        </Group>
      </div>

      <div className="text-xs text-muted">
        Tip: use Cmd+K for navigation. Runs replay is optimized for desktop.
      </div>
    </div>
  );
}
