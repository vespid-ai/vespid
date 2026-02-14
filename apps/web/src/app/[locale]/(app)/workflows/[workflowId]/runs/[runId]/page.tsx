"use client";

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  BadgeX,
  CircleDot,
  Filter,
  FlaskConical,
  Hash,
  Search,
  Timer,
} from "lucide-react";
import { Badge } from "../../../../../../../components/ui/badge";
import { Button } from "../../../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { Chip } from "../../../../../../../components/ui/chip";
import { Input } from "../../../../../../../components/ui/input";
import { JsonExplorer } from "../../../../../../../components/ui/json-explorer";
import { ScrollArea } from "../../../../../../../components/ui/scroll-area";
import { Separator } from "../../../../../../../components/ui/separator";
import { useActiveOrgId } from "../../../../../../../lib/hooks/use-active-org-id";
import { useRun, useRunEvents, type WorkflowRunEvent } from "../../../../../../../lib/hooks/use-workflows";
import { addRecentRunId } from "../../../../../../../lib/recents";
import { groupEventsByAttempt } from "../../../../../../../lib/run-events";
import { cn } from "../../../../../../../lib/cn";

function eventKind(event: Record<string, unknown>): string {
  const type = typeof event.type === "string" ? event.type : null;
  const legacy = typeof event.event === "string" ? event.event : null;
  return type ?? legacy ?? "event";
}

function eventNodeId(event: Record<string, unknown>): string {
  const value = typeof event.nodeId === "string" ? event.nodeId : null;
  const legacy = typeof event.node_id === "string" ? event.node_id : null;
  return value ?? legacy ?? "";
}

function eventCreatedAt(event: Record<string, unknown>): string {
  const value = typeof event.createdAt === "string" ? event.createdAt : null;
  const legacy = typeof event.created_at === "string" ? event.created_at : null;
  return value ?? legacy ?? "";
}

function statusVariant(status: string): "ok" | "warn" | "danger" | "neutral" | "accent" {
  const normalized = status.toLowerCase();
  if (normalized === "succeeded") return "ok";
  if (normalized === "failed") return "danger";
  if (normalized === "running") return "accent";
  return "neutral";
}

function statusIcon(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "succeeded") return <BadgeCheck className="h-4 w-4" />;
  if (normalized === "failed") return <BadgeX className="h-4 w-4" />;
  if (normalized === "running") return <CircleDot className="h-4 w-4" />;
  return <FlaskConical className="h-4 w-4" />;
}

function durationMs(run: any): number | null {
  const startedAt = typeof run?.startedAt === "string" ? Date.parse(run.startedAt) : NaN;
  const endedAt = typeof run?.endedAt === "string" ? Date.parse(run.endedAt) : NaN;
  if (!Number.isFinite(startedAt)) return null;
  if (!Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round((s - m * 60) * 10) / 10;
  return `${m}m ${rem}s`;
}

const PINNED_PATHS_STORAGE = "vespid.ui.runReplay.pins";

function readPinnedPaths(): string[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
  const raw = window.localStorage.getItem(PINNED_PATHS_STORAGE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 12);
  } catch {
    return [];
  }
}

function writePinnedPaths(keys: string[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(PINNED_PATHS_STORAGE, JSON.stringify(keys));
}

function pickByPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const parts = trimmed
    .split(".")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let cursor: any = value;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;

    const match = /^([A-Za-z0-9_$-]+)(?:\\[(\\d+)\\])?$/.exec(part);
    if (!match) return undefined;
    const key = match[1] as string;
    const idx = match[2] ? Number(match[2]) : null;

    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as any)[key];
    if (idx !== null) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[idx];
    }
  }
  return cursor;
}

function formatInline(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  } catch {
    return String(value);
  }
}

function enumeratePaths(value: unknown, maxDepth = 3, maxPaths = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function push(path: string) {
    if (out.length >= maxPaths) return;
    if (seen.has(path)) return;
    seen.add(path);
    out.push(path);
  }

  function walk(node: unknown, prefix: string, depth: number) {
    if (out.length >= maxPaths) return;
    if (node === null || node === undefined) return;
    if (depth > maxDepth) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) return;

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${key}` : key;
      push(next);
      walk(child, next, depth + 1);
    }
  }

  walk(value, "", 1);
  return out;
}

function pickAny(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const v = pickByPath(value, path);
    if (v !== undefined) return v;
  }
  return undefined;
}

export default function RunReplayPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{
    locale?: string | string[];
    workflowId?: string | string[];
    runId?: string | string[];
  }>();

  const locale = (Array.isArray(params?.locale) ? params.locale[0] : params?.locale) ?? "en";
  const workflowId = (Array.isArray(params?.workflowId) ? params.workflowId[0] : params?.workflowId) ?? "";
  const runId = (Array.isArray(params?.runId) ? params.runId[0] : params?.runId) ?? "";

  const orgId = useActiveOrgId();

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

  const [openAttempts, setOpenAttempts] = useState<Record<string, boolean>>({});

  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [pinDraft, setPinDraft] = useState("");

  useEffect(() => {
    setPinnedPaths(readPinnedPaths());
  }, []);

  useEffect(() => {
    if (groups.length === 0) return;
    setOpenAttempts((prev) => {
      if (Object.keys(prev).length) return prev;
      const next: Record<string, boolean> = {};
      for (const g of groups) {
        const key = g.attempt === null ? "unknown" : String(g.attempt);
        next[key] = true;
      }
      return next;
    });
  }, [groups]);

  const flat = useMemo(() => {
    return groups.flatMap((g) => g.events.map((e, idx) => ({ e, idx, attempt: g.attempt })));
  }, [groups]);

  const filtered = useMemo(() => {
    const normalizedType = typeFilter.trim().toLowerCase();
    const normalizedSearch = search.trim().toLowerCase();

    return flat.filter(({ e }) => {
      const kind = eventKind(e as any);
      if (normalizedType && !kind.toLowerCase().includes(normalizedType)) {
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
    return new Set(filtered.map((x) => (typeof (x.e as any).id === "string" ? (x.e as any).id : String(x.idx))));
  }, [filtered]);

  useEffect(() => {
    if (selectedKey && eventKeys.has(selectedKey)) {
      return;
    }
    const next = filtered[0];
    if (next) {
      setSelectedKey(typeof (next.e as any).id === "string" ? (next.e as any).id : String(next.idx));
    }
  }, [eventKeys, filtered, selectedKey]);

  const selectedEvent = useMemo(() => {
    if (!selectedKey) return null;
    return (
      flat.find((x) => (typeof (x.e as any).id === "string" ? (x.e as any).id : String(x.idx)) === selectedKey)?.e ?? null
    );
  }, [flat, selectedKey]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of flat) {
      const kind = eventKind(item.e as any);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([kind]) => kind);
  }, [flat]);

  function back() {
    router.push(`/${locale}/workflows/${workflowId}`);
  }

  function copyRunId() {
    navigator.clipboard
      .writeText(runId)
      .then(() => toast.success(t("common.copied")))
      .catch(() => toast.error(t("errors.copyFailed")));
  }

  function toggleAttempt(key: string) {
    setOpenAttempts((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  function addPin() {
    const key = pinDraft.trim();
    if (!key) return;
    addPinPath(key);
    setPinDraft("");
  }

  function addPinPath(path: string) {
    const key = path.trim();
    if (!key) return;
    setPinnedPaths((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, 12);
      writePinnedPaths(next);
      return next;
    });
  }

  function removePin(key: string) {
    setPinnedPaths((prev) => {
      const next = prev.filter((k) => k !== key);
      writePinnedPaths(next);
      return next;
    });
  }

  const run = runQuery.data?.run as any;
  const dur = durationMs(run);

  const suggestedPins = useMemo(() => {
    if (!selectedEvent) return [];
    const preferred = [
      "nodeId",
      "type",
      "event",
      "status",
      "createdAt",
      "message",
      "payload.input",
      "payload.output",
      "payload.error",
      "error",
    ];
    const present = preferred.filter((p) => pickByPath(selectedEvent, p) !== undefined);
    const discovered = enumeratePaths(selectedEvent, 3, 40)
      .filter((p) => p.startsWith("payload.") || p === "nodeId" || p === "type" || p === "status")
      .slice(0, 10);
    return Array.from(new Set([...present, ...discovered])).slice(0, 10);
  }, [selectedEvent]);

  const why = useMemo(() => {
    if (!selectedEvent) return null;
    return {
      type: eventKind(selectedEvent as any),
      nodeId: eventNodeId(selectedEvent as any),
      createdAt: eventCreatedAt(selectedEvent as any),
      status: (selectedEvent as any).status ?? (selectedEvent as any).state ?? null,
      attempt: (selectedEvent as any).attemptCount ?? null,
      message: (selectedEvent as any).message ?? null,
    };
  }, [selectedEvent]);

  const sectionInputs = useMemo(() => {
    return (
      pickAny(selectedEvent, ["inputs", "input", "payload.inputs", "payload.input"]) ??
      pickAny(run, ["inputs", "input", "payload.inputs", "payload.input"])
    );
  }, [run, selectedEvent]);

  const sectionOutputs = useMemo(() => {
    return (
      pickAny(selectedEvent, ["outputs", "output", "result", "payload.outputs", "payload.output", "payload.result"]) ??
      pickAny(run, ["outputs", "output", "result", "payload.outputs", "payload.output", "payload.result"])
    );
  }, [run, selectedEvent]);

  const sectionErrors = useMemo(() => {
    return (
      pickAny(selectedEvent, ["error", "errors", "payload.error", "payload.errors", "exception"]) ??
      pickAny(run, ["error", "errors", "payload.error", "payload.errors", "exception"])
    );
  }, [run, selectedEvent]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">{t("runs.title")}</div>
            {run?.status ? (
              <Badge variant={statusVariant(run.status)} className="gap-1.5">
                {statusIcon(run.status)}
                {run.status}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Hash className="h-3.5 w-3.5" />
            <span className="font-mono">{runId}</span>
            <Button size="sm" variant="ghost" onClick={copyRunId}>
              {t("common.copy")}
            </Button>
            <span>Org: {orgId ?? "-"}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={back} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Button>
          <Button variant="outline" onClick={() => eventsQuery.refetch()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-borderSubtle bg-panel/40 shadow-elev2">
        <PanelGroup orientation="horizontal" className="h-[calc(100dvh-220px)] min-h-[560px]">
          <Panel defaultSize={28} minSize={18}>
            <div className="h-full">
              <div className="flex items-center justify-between gap-2 border-b border-borderSubtle px-4 py-3 group-data-[density=compact]:py-2">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.timeline")}</div>
                <div className="text-xs text-muted">
                  {eventsQuery.isFetching ? t("common.loading") : t("runs.eventsCount", { count: events.length })}
                </div>
              </div>

              <div className="flex items-center gap-2 border-b border-borderSubtle px-4 py-2">
                <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-borderSubtle bg-panel/45 px-2 py-1 text-xs text-muted shadow-elev1">
                  <Filter className="h-3.5 w-3.5" />
                  <input
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    placeholder={t("runs.filterType")}
                    className="w-28 bg-transparent outline-none placeholder:text-muted"
                  />
                </div>
                <div className="flex flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-borderSubtle bg-panel/45 px-2 py-1 text-xs text-muted shadow-elev1">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("runs.search")}
                    className="w-full bg-transparent outline-none placeholder:text-muted"
                  />
                </div>
              </div>

              <div className="border-b border-borderSubtle px-4 py-2">
                <div className="flex flex-wrap gap-2">
                  <Chip active={!typeFilter} onClick={() => setTypeFilter("")}>
                    {t("common.all")}
                  </Chip>
                  {typeOptions.map((opt) => (
                    <Chip key={opt} active={typeFilter === opt} onClick={() => setTypeFilter(opt)}>
                      {opt}
                    </Chip>
                  ))}
                </div>
              </div>

              <ScrollArea className="h-[calc(100%-156px)]">
                <div className="p-2">
                  {groups.length === 0 ? <div className="px-2 py-6 text-sm text-muted">{t("runs.noEvents")}</div> : null}

                  {groups.map((group) => {
                    const attemptKey = group.attempt === null ? "unknown" : String(group.attempt);
                    const label =
                      group.attempt === null ? t("runs.attemptUnknown") : t("runs.attemptNumber", { count: group.attempt });
                    const open = openAttempts[attemptKey] ?? true;

                    return (
                      <div key={attemptKey} className="mb-4">
                        <button
                          type="button"
                          onClick={() => toggleAttempt(attemptKey)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-borderSubtle bg-panel/35 px-2 py-2 text-left shadow-elev1",
                            "transition-[box-shadow,background-color,border-color] duration-200 hover:bg-panel/45 hover:shadow-elev2"
                          )}
                        >
                          <span className="text-xs font-medium text-muted">{label}</span>
                          <span className="text-xs text-muted">{open ? t("common.hide") : t("common.show")}</span>
                        </button>

                        {open ? (
                          <div className="mt-2 grid gap-1">
                            {group.events.map((event, idx) => {
                              const key = typeof (event as any).id === "string" ? (event as any).id : String(idx);
                              if (!eventKeys.has(key)) {
                                return null;
                              }
                              const kind = eventKind(event as any);
                              const node = eventNodeId(event as any);
                              const when = eventCreatedAt(event as any);
                              const active = key === selectedKey;

                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setSelectedKey(key)}
                                  className={cn(
                                    "w-full rounded-[var(--radius-sm)] border px-2 py-2 text-left",
                                    "transition-[box-shadow,background-color,border-color] duration-200",
                                    active
                                      ? "border-accent/25 bg-accent/10 shadow-elev2"
                                      : "border-borderSubtle bg-panel/25 hover:bg-panel/45 hover:shadow-elev1"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-xs font-medium text-text">{node ? `${node} · ${kind}` : kind}</span>
                                  </div>
                                  <div className="mt-1 truncate text-[11px] text-muted">{when}</div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-borderSubtle transition-colors hover:bg-borderStrong" />

          <Panel defaultSize={44} minSize={26}>
            <div className="h-full">
              <div className="border-b border-borderSubtle px-4 py-3 group-data-[density=compact]:py-2">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.details")}</div>
                <div className="mt-1 text-xs text-muted">{t("runs.detailsHint")}</div>
              </div>

              <ScrollArea className="h-[calc(100%-52px)]">
                <div className="p-4 group-data-[density=compact]:p-3">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("runs.summaryTitle")}</CardTitle>
                      <CardDescription>{t("runs.summaryHint")}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <Timer className="h-3.5 w-3.5" /> {t("runs.duration")}
                          </div>
                          <div className="mt-1 font-medium text-text">{dur === null ? "-" : formatMs(dur)}</div>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                          <div className="text-xs text-muted">{t("runs.attempts")}</div>
                          <div className="mt-1 font-medium text-text">{groups.length || "-"}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Separator className="my-4" />

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("runs.runTitle")}</CardTitle>
                      <CardDescription>{t("runs.runHint")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {run ? (
                        <JsonExplorer value={run} pinnedPaths={pinnedPaths} onPinPath={addPinPath} />
                      ) : (
                        <div className="text-sm text-muted">{t("runs.noRun")}</div>
                      )}
                    </CardContent>
                  </Card>

                  <Separator className="my-4" />

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("runs.eventTitle")}</CardTitle>
                      <CardDescription>{selectedEvent ? eventKind(selectedEvent as any) : t("runs.selectEvent")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {selectedEvent ? (
                        <JsonExplorer value={selectedEvent} pinnedPaths={pinnedPaths} onPinPath={addPinPath} />
                      ) : (
                        <div className="text-sm text-muted">{t("runs.noEvent")}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-borderSubtle transition-colors hover:bg-borderStrong" />

          <Panel defaultSize={28} minSize={18}>
            <div className="h-full">
              <div className="border-b border-borderSubtle px-4 py-3 group-data-[density=compact]:py-2">
                <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("runs.inspector")}</div>
                <div className="mt-1 text-xs text-muted">{t("runs.inspectorHint")}</div>
              </div>
              <ScrollArea className="h-[calc(100%-52px)]">
                <div className="p-4 group-data-[density=compact]:p-3">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("runs.trustTitle")}</CardTitle>
                      <CardDescription>{t("runs.trustHint")}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <div className="grid gap-3">
                        <div className="text-xs font-medium text-muted">{t("runs.sectionWhy")}</div>
                        <div className="rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                          {why ? (
                            <div className="grid gap-1 text-sm">
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                                <span>{why.nodeId ? `node: ${why.nodeId}` : "node: -"}</span>
                                <span>{`type: ${why.type}`}</span>
                                <span>{why.status ? `status: ${String(why.status)}` : "status: -"}</span>
                                <span>{why.createdAt ? `at: ${why.createdAt}` : "at: -"}</span>
                                <span>{why.attempt ? `attempt: ${String(why.attempt)}` : "attempt: -"}</span>
                              </div>
                              {why.message ? <div className="mt-1 text-xs text-text">{String(why.message)}</div> : null}
                            </div>
                          ) : (
                            <div className="text-sm text-muted">{t("runs.selectEvent")}</div>
                          )}
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <div className="text-xs font-medium text-muted">{t("runs.sectionInputs")}</div>
                            <div className="mt-2 rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                              {sectionInputs === undefined ? (
                                <div className="text-sm text-muted">-</div>
                              ) : (
                                <JsonExplorer value={sectionInputs} pinnedPaths={pinnedPaths} onPinPath={addPinPath} />
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-muted">{t("runs.sectionOutputs")}</div>
                            <div className="mt-2 rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                              {sectionOutputs === undefined ? (
                                <div className="text-sm text-muted">-</div>
                              ) : (
                                <JsonExplorer value={sectionOutputs} pinnedPaths={pinnedPaths} onPinPath={addPinPath} />
                              )}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-muted">{t("runs.sectionErrors")}</div>
                          <div className="mt-2 rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-3 shadow-elev1">
                            {sectionErrors === undefined ? (
                              <div className="text-sm text-muted">-</div>
                            ) : (
                              <JsonExplorer value={sectionErrors} pinnedPaths={pinnedPaths} onPinPath={addPinPath} />
                            )}
                          </div>
                        </div>
                      </div>

                      <Separator />

                      <div className="grid gap-1.5">
                        <div className="text-xs font-medium text-muted">{t("runs.pinsTitle")}</div>
                        <div className="flex gap-2">
                          <Input value={pinDraft} onChange={(e) => setPinDraft(e.target.value)} placeholder={t("runs.pinPlaceholder")} />
                          <Button variant="outline" onClick={addPin}>{t("common.add")}</Button>
                        </div>
                        {suggestedPins.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {suggestedPins.map((path) => (
                              <Chip key={path} onClick={() => addPinPath(path)}>
                                {path}
                              </Chip>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-2 grid gap-2">
                          {pinnedPaths.length === 0 ? <div className="text-sm text-muted">{t("runs.noPins")}</div> : null}
                          {pinnedPaths.map((key) => (
                            <div
                              key={key}
                              className="flex items-center justify-between rounded-[var(--radius-sm)] border border-borderSubtle bg-panel/35 px-2 py-2 shadow-elev1"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-text">{key}</div>
                                <div className="mt-0.5 truncate font-mono text-xs text-muted">
                                  {selectedEvent ? formatInline(pickByPath(selectedEvent, key)) : "-"}
                                </div>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => removePin(key)}>{t("common.remove")}</Button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <Separator />

                      <div className="grid gap-2">
                        <div className="text-xs font-medium text-muted">{t("runs.quickActions")}</div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setTypeFilter("");
                            setSearch("");
                          }}
                        >
                          {t("common.clearFilters")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Separator className="my-4" />

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("runs.healthTitle")}</CardTitle>
                      <CardDescription>{t("runs.healthHint")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {eventsQuery.isError ? (
                        <div className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{t("runs.healthEventsError")}</div>
                      ) : runQuery.isError ? (
                        <div className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{t("runs.healthRunError")}</div>
                      ) : (
                        <div className="text-sm text-muted">OK</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <div className="text-xs text-muted">{t("runs.tip")}</div>
    </div>
  );
}
