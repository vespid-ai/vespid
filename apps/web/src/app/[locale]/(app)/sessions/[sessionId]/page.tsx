"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Separator } from "../../../../../components/ui/separator";
import { AdvancedSection } from "../../../../../components/app/advanced-section";
import { cn } from "../../../../../lib/cn";
import { useActiveOrgId } from "../../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../../lib/hooks/use-session";
import { useSession, useSessionEvents, type AgentSessionEvent } from "../../../../../lib/hooks/use-sessions";

type GatewayClientMessage =
  | { type: "client_hello"; clientVersion?: string }
  | { type: "session_join"; sessionId: string }
  | { type: "session_send"; sessionId: string; message: string; idempotencyKey?: string }
  | { type: "session_reset_agent"; sessionId: string };

type GatewayServerMessage =
  | {
      type: "session_event_v2";
      sessionId: string;
      seq: number;
      eventType: string;
      level: "info" | "warn" | "error";
      payload?: any;
      createdAt: string;
    }
  | {
      type: "session_error";
      sessionId?: string;
      code: string;
      message: string;
    };

function gatewayWsBase(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_WS_BASE ?? "ws://localhost:3002";
}

function safeJsonParse(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function mergeBySeq(existing: AgentSessionEvent[], incoming: AgentSessionEvent[]): AgentSessionEvent[] {
  const map = new Map<number, AgentSessionEvent>();
  for (const e of existing) map.set(e.seq, e);
  for (const e of incoming) map.set(e.seq, e);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export default function SessionDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[]; sessionId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : params?.locale ?? "en";
  const sessionId = Array.isArray(params?.sessionId) ? (params.sessionId[0] ?? "") : params?.sessionId ?? "";

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();

  const sessionQuery = useSession(orgId, sessionId || null);
  const eventsQuery = useSessionEvents(orgId, sessionId || null);

  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string>("");
  const [message, setMessage] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const initial = eventsQuery.data?.events ?? [];
    if (!Array.isArray(initial) || initial.length === 0) {
      return;
    }
    setEvents((prev) => mergeBySeq(prev, initial));
  }, [eventsQuery.data?.events]);

  const canConnect = Boolean(orgId && sessionId);
  const wsUrl = useMemo(() => {
    if (!orgId) return null;
    const base = gatewayWsBase().replace(/\/+$/, "");
    return `${base}/ws/client?orgId=${encodeURIComponent(orgId)}`;
  }, [orgId]);

  const connectWs = () => {
    if (!wsUrl || !canConnect) return;
    if (!authSession.data?.session) {
      toast.error(t("sessions.ws.requiresLogin"));
      return;
    }

    setWsError("");
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const hello: GatewayClientMessage = { type: "client_hello", clientVersion: "web" };
        ws.send(JSON.stringify(hello));
        const join: GatewayClientMessage = { type: "session_join", sessionId };
        ws.send(JSON.stringify(join));
      };

      ws.onclose = () => {
        setConnected(false);
      };

      ws.onerror = () => {
        setWsError(t("sessions.ws.error"));
      };

      ws.onmessage = (evt) => {
        const raw = typeof evt.data === "string" ? evt.data : "";
        const msg = safeJsonParse(raw) as GatewayServerMessage | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "session_error") {
          toast.error(`${msg.code}: ${msg.message}`);
          return;
        }
        if (msg.type !== "session_event_v2") return;
        if (msg.sessionId !== sessionId) return;
        const e: AgentSessionEvent = {
          id: `${msg.sessionId}:${msg.seq}`,
          organizationId: orgId ?? "",
          sessionId: msg.sessionId,
          seq: msg.seq,
          eventType: msg.eventType,
          level: msg.level,
          payload: msg.payload ?? null,
          createdAt: msg.createdAt,
        };
        setEvents((prev) => mergeBySeq(prev, [e]));
      };
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!canConnect) return;
    connectWs();
    return () => {
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, canConnect]);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  const session = sessionQuery.data?.session ?? null;
  const pinnedAgentId = session?.pinnedAgentId ?? null;

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/sessions`)}>
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

  if (sessionQuery.isLoading && !session) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/sessions`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState title={t("common.loading")} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/sessions`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState title={t("common.notFound")} />
      </div>
    );
  }

  async function send() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error(t("sessions.ws.notConnected"));
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    setMessage("");
    const payload: GatewayClientMessage = {
      type: "session_send",
      sessionId,
      message: trimmed,
      idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    ws.send(JSON.stringify(payload));
  }

  function resetPin() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error(t("sessions.ws.notConnected"));
      return;
    }
    const payload: GatewayClientMessage = { type: "session_reset_agent", sessionId };
    ws.send(JSON.stringify(payload));
  }

  const headerTitle = session?.title?.trim().length ? session.title : t("sessions.untitled");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{headerTitle}</div>
          <div className="mt-1 text-xs text-muted">
            <span className="font-mono">{sessionId}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={cn("inline-flex items-center gap-2", connected ? "text-emerald-700" : "text-muted")}>
              <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted")} />
              {connected ? t("sessions.ws.connected") : t("sessions.ws.disconnected")}
            </span>
            {wsError ? <span className="text-red-700">{wsError}</span> : null}
            {pinnedAgentId ? (
              <span className="inline-flex items-center gap-2">
                <span>{t("sessions.pinnedAgent")}</span>
                <span className="font-mono">{pinnedAgentId.slice(0, 8)}…</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/sessions`)}>
            {t("common.back")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => connectWs()} disabled={!canConnect || connected}>
            {t("sessions.ws.reconnect")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => resetPin()} disabled={!canConnect || !connected}>
            {t("sessions.resetAgent")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.chat.title")}</CardTitle>
          <CardDescription>{t("sessions.chat.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="rounded-2xl border border-borderSubtle bg-panel/40 p-3 shadow-elev1">
            <div className="grid gap-2">
              {events.length === 0 ? (
                <EmptyState
                  title={t("sessions.chat.empty")}
                  action={
                    <Button size="sm" variant="outline" onClick={() => connectWs()} disabled={!canConnect || connected}>
                      {t("sessions.ws.reconnect")}
                    </Button>
                  }
                />
              ) : (
                events.map((e) => (
                  <div key={e.seq} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">#{e.seq}</span>
                        <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono">{e.eventType}</span>
                        <span className={cn("font-mono", e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-700" : "text-muted")}>
                          {e.level}
                        </span>
                      </div>
                      <span className="font-mono">{formatTime(e.createdAt)}</span>
                    </div>
                    {e.payload !== null && e.payload !== undefined ? (
                      <AdvancedSection
                        id={`session-event-payload-${e.seq}`}
                        title={t("advanced.title")}
                        labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
                      >
                        <pre className="max-h-56 overflow-auto rounded-xl border border-borderSubtle bg-panel/60 p-3 text-xs text-text">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </AdvancedSection>
                    ) : null}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-2">
            <Label>{t("sessions.chat.message")}</Label>
            <div className="flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("sessions.chat.placeholder")}
                disabled={!canConnect}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button variant="accent" disabled={!canConnect || !connected || message.trim().length === 0} onClick={() => void send()}>
                {t("sessions.chat.send")}
              </Button>
            </div>
            <div className="text-xs text-muted">{t("sessions.chat.sendHint")}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.details.title")}</CardTitle>
          <CardDescription>{t("sessions.details.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AdvancedSection
            id="session-detail-advanced"
            title={t("advanced.title")}
            description={t("advanced.description")}
            labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
          >
            <div className="grid gap-2 text-sm">
              <div className="grid gap-1 md:grid-cols-2">
                <div className="text-muted">{t("sessions.details.engine")}</div>
                <div className="font-mono">{session?.engineId ?? "-"}</div>
              </div>
              <div className="grid gap-1 md:grid-cols-2">
                <div className="text-muted">{t("sessions.details.llm")}</div>
                <div className="font-mono">{session ? `${session.llmProvider}:${session.llmModel}` : "-"}</div>
              </div>
              <div className="grid gap-1 md:grid-cols-2">
                <div className="text-muted">{t("sessions.details.toolset")}</div>
                <div className="font-mono">{session?.toolsetId ?? "-"}</div>
              </div>
              <div className="grid gap-1 md:grid-cols-2">
                <div className="text-muted">{t("sessions.details.selector")}</div>
                <div className="font-mono">
                  {session?.executorSelector?.executorId ??
                    session?.executorSelector?.tag ??
                    session?.executorSelector?.group ??
                    (Array.isArray(session?.executorSelector?.labels) && session?.executorSelector?.labels.length > 0
                      ? session?.executorSelector?.labels.join(",")
                      : "-")}
                </div>
              </div>
            </div>
          </AdvancedSection>
        </CardContent>
      </Card>
    </div>
  );
}
