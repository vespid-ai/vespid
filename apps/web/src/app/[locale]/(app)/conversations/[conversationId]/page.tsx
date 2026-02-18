"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { Textarea } from "../../../../../components/ui/textarea";
import { AuthRequiredState } from "../../../../../components/app/auth-required-state";
import { cn } from "../../../../../lib/cn";
import { isUnauthorizedError } from "../../../../../lib/api";
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
      type: "session_ack";
      sessionId: string;
    }
  | {
      type: "agent_delta";
      sessionId: string;
      seq: number;
      content: string;
      createdAt: string;
    }
  | {
      type: "agent_final";
      sessionId: string;
      seq: number;
      content: string;
      payload?: any;
      createdAt: string;
    }
  | {
      type: "agent_handoff";
      sessionId: string;
      seq: number;
      fromAgentId: string | null;
      toAgentId: string;
      reason?: string | null;
      createdAt: string;
    }
  | {
      type: "session_state";
      sessionId: string;
      pinnedExecutorId: string | null;
      pinnedExecutorPool: "managed" | "byon" | null;
      pinnedAgentId: string | null;
      routedAgentId: string | null;
      scope: string;
      executionMode: string;
    }
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

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  seq: number;
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
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function mergeBySeq(existing: AgentSessionEvent[], incoming: AgentSessionEvent[]): AgentSessionEvent[] {
  const map = new Map<number, AgentSessionEvent>();
  for (const e of existing) map.set(e.seq, e);
  for (const e of incoming) map.set(e.seq, e);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    if (typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  const text = parts.join("\n").trim();
  return text.length > 0 ? text : null;
}

function extractEventText(event: AgentSessionEvent): string {
  const payload = event.payload;
  if (typeof payload === "string") {
    return payload;
  }

  const record = asRecord(payload);
  if (record) {
    const directKeys = ["message", "text", "outputText", "content", "delta", "summary", "reasoning"] as const;
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
      const contentText = contentToText(value);
      if (contentText) {
        return contentText;
      }
    }

    if (Array.isArray(record.messages) && record.messages.length > 0) {
      const lines: string[] = [];
      for (const item of record.messages) {
        if (typeof item === "string") {
          lines.push(item);
          continue;
        }
        const msg = asRecord(item);
        if (!msg) {
          continue;
        }
        if (typeof msg.text === "string") {
          lines.push(msg.text);
          continue;
        }
        const text = contentToText(msg.content);
        if (text) {
          lines.push(text);
        }
      }
      const joined = lines.join("\n").trim();
      if (joined.length > 0) {
        return joined;
      }
    }
  }

  if (payload === null || payload === undefined) {
    return event.eventType;
  }

  const fallback = JSON.stringify(payload);
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback.length > 280 ? `${fallback.slice(0, 280)}...` : fallback;
  }

  return event.eventType;
}

function inferRole(event: AgentSessionEvent): ChatRole {
  const eventType = event.eventType.toLowerCase();
  if (eventType.includes("user") || eventType.includes("client") || eventType.includes("input")) {
    return "user";
  }
  if (eventType.includes("assistant") || eventType.includes("agent") || eventType.includes("model") || eventType.includes("output")) {
    return "assistant";
  }
  return "system";
}

export default function ConversationDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ locale?: string | string[]; conversationId?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : params?.locale ?? "en";
  const conversationId = Array.isArray(params?.conversationId) ? (params.conversationId[0] ?? "") : params?.conversationId ?? "";

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const sessionQuery = useSession(scopedOrgId, conversationId || null);
  const eventsQuery = useSessionEvents(scopedOrgId, conversationId || null);

  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string>("");
  const [message, setMessage] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const draftMessage = searchParams.get("draft") ?? "";
  const autoSendDraftRef = useRef<string>(draftMessage);
  const autoSendDoneRef = useRef(false);

  useEffect(() => {
    setEvents([]);
  }, [conversationId]);

  useEffect(() => {
    autoSendDraftRef.current = draftMessage;
    autoSendDoneRef.current = false;
  }, [conversationId, draftMessage]);

  useEffect(() => {
    const initial = eventsQuery.data?.events ?? [];
    if (!Array.isArray(initial) || initial.length === 0) {
      return;
    }
    setEvents((prev) => mergeBySeq(prev, initial));
  }, [eventsQuery.data?.events]);

  const canConnect = Boolean(scopedOrgId && conversationId);
  const wsUrl = useMemo(() => {
    if (!scopedOrgId) return null;
    const base = gatewayWsBase().replace(/\/+$/, "");
    return `${base}/ws/client?orgId=${encodeURIComponent(scopedOrgId)}`;
  }, [scopedOrgId]);

  const chatMessages = useMemo<ChatMessage[]>(() => {
    return events.map((event) => ({
      id: `${event.id}:${event.seq}`,
      seq: event.seq,
      role: inferRole(event),
      text: extractEventText(event),
      createdAt: event.createdAt,
    }));
  }, [events]);

  function connectWs() {
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
        const join: GatewayClientMessage = { type: "session_join", sessionId: conversationId };
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
        if (msg.type === "session_ack" || msg.type === "session_state") {
          return;
        }
        if (msg.sessionId !== conversationId) return;

        if (msg.type === "agent_delta") {
          const e: AgentSessionEvent = {
            id: `${msg.sessionId}:${msg.seq}:delta`,
            organizationId: scopedOrgId ?? "",
            sessionId: msg.sessionId,
            seq: msg.seq,
            eventType: "agent_message",
            level: "info",
            handoffFromAgentId: null,
            handoffToAgentId: null,
            idempotencyKey: null,
            payload: { content: msg.content },
            createdAt: msg.createdAt,
          };
          setEvents((prev) => mergeBySeq(prev, [e]));
          return;
        }
        if (msg.type === "agent_final") {
          const e: AgentSessionEvent = {
            id: `${msg.sessionId}:${msg.seq}:final`,
            organizationId: scopedOrgId ?? "",
            sessionId: msg.sessionId,
            seq: msg.seq,
            eventType: "agent_final",
            level: "info",
            handoffFromAgentId: null,
            handoffToAgentId: null,
            idempotencyKey: null,
            payload: { content: msg.content, payload: msg.payload ?? null },
            createdAt: msg.createdAt,
          };
          setEvents((prev) => mergeBySeq(prev, [e]));
          return;
        }
        if (msg.type === "agent_handoff") {
          const e: AgentSessionEvent = {
            id: `${msg.sessionId}:${msg.seq}:handoff`,
            organizationId: scopedOrgId ?? "",
            sessionId: msg.sessionId,
            seq: msg.seq,
            eventType: "agent_handoff",
            level: "info",
            handoffFromAgentId: msg.fromAgentId,
            handoffToAgentId: msg.toAgentId,
            idempotencyKey: null,
            payload: { reason: msg.reason ?? null },
            createdAt: msg.createdAt,
          };
          setEvents((prev) => mergeBySeq(prev, [e]));
          return;
        }
        if (msg.type === "session_event_v2") {
          const e: AgentSessionEvent = {
            id: `${msg.sessionId}:${msg.seq}`,
            organizationId: scopedOrgId ?? "",
            sessionId: msg.sessionId,
            seq: msg.seq,
            eventType: msg.eventType,
            level: msg.level,
            handoffFromAgentId: null,
            handoffToAgentId: null,
            idempotencyKey: null,
            payload: msg.payload ?? null,
            createdAt: msg.createdAt,
          };
          setEvents((prev) => mergeBySeq(prev, [e]));
          return;
        }
      };
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    }
  }

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
  }, [conversationId, wsUrl, canConnect]);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages.length]);

  function sendText(text: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error(t("sessions.ws.notConnected"));
      return;
    }
    const payload: GatewayClientMessage = {
      type: "session_send",
      sessionId: conversationId,
      message: text,
      idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    ws.send(JSON.stringify(payload));
  }

  useEffect(() => {
    if (!connected || autoSendDoneRef.current) {
      return;
    }
    const initial = autoSendDraftRef.current.trim();
    if (!initial) {
      return;
    }

    sendText(initial);
    autoSendDoneRef.current = true;
    router.replace(`/${locale}/conversations/${conversationId}`);
  }, [connected, conversationId, locale, router]);

  function send() {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    setMessage("");
    sendText(trimmed);
  }

  const session = sessionQuery.data?.session ?? null;
  const headerTitle = session?.title?.trim().length ? session.title : t("sessions.untitled");

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void sessionQuery.refetch();
            void eventsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState
          title={t("org.requireActive")}
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
    (sessionQuery.isError && isUnauthorizedError(sessionQuery.error)) ||
    (eventsQuery.isError && isUnauthorizedError(eventsQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void sessionQuery.refetch();
            void eventsQuery.refetch();
          }}
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
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
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
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
        </div>
        <EmptyState title={t("common.notFound")} />
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4" data-testid="conversation-detail-layout">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{headerTitle}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono">{conversationId}</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5", connected ? "border-emerald-400/60 text-emerald-700" : "border-borderSubtle")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-muted")} />
              {connected ? t("sessions.ws.connected") : t("sessions.ws.disconnected")}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => connectWs()} disabled={!canConnect || connected}>
            {t("sessions.ws.reconnect")}
          </Button>
        </div>
      </div>

      {wsError ? <div className="text-sm text-red-700">{wsError}</div> : null}

      <section className="rounded-[var(--radius-lg)] border border-borderSubtle/65 bg-panel/72 p-3 shadow-elev1 md:p-4" data-testid="conversation-message-stream">
        {chatMessages.length === 0 ? (
          <EmptyState
            title={t("sessions.chat.empty")}
            action={
              <Button size="sm" variant="outline" onClick={() => connectWs()} disabled={!canConnect || connected}>
                {t("sessions.ws.reconnect")}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5">
            {chatMessages.map((item) => (
              <div
                key={item.id}
                data-testid={`conversation-message-${item.role}`}
                className={cn(
                  "grid gap-1",
                  item.role === "user" && "md:justify-items-end",
                  item.role === "assistant" && "md:justify-items-start",
                  item.role === "system" && "md:justify-items-center"
                )}
              >
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  {item.role === "user"
                    ? t("sessions.chat.roleUser")
                    : item.role === "assistant"
                      ? t("sessions.chat.roleAssistant")
                      : t("sessions.chat.roleSystem")}
                </div>
                <div className="max-w-[88%] whitespace-pre-wrap break-words text-sm text-text">{item.text}</div>
                <div className="text-[11px] text-muted">
                  #{item.seq} {formatTime(item.createdAt)}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-borderSubtle/65 bg-panel/72 p-3 shadow-elev1 md:p-4">
        <div className="grid gap-2">
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("sessions.chat.placeholder")}
            disabled={!canConnect}
            className="min-h-[88px] border-0 bg-transparent px-0 py-0 shadow-none focus:border-transparent focus:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3 border-t border-borderSubtle/60 pt-2">
            <div className="text-xs text-muted">{t("sessions.chat.shortcutHint")}</div>
            <Button variant="accent" size="sm" className="rounded-full" disabled={!canConnect || !connected || message.trim().length === 0} onClick={send}>
              {t("sessions.chat.send")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
