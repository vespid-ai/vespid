"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../../components/ui/button";
import { CommandBlock } from "../../../../../components/ui/command-block";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { SyntaxCodeBlock } from "../../../../../components/ui/syntax-code-block";
import { Textarea } from "../../../../../components/ui/textarea";
import { AuthRequiredState } from "../../../../../components/app/auth-required-state";
import { cn } from "../../../../../lib/cn";
import { getApiBase, isUnauthorizedError } from "../../../../../lib/api";
import { useAgentInstaller, useCreatePairingToken } from "../../../../../lib/hooks/use-agents";
import { useActiveOrgId } from "../../../../../lib/hooks/use-active-org-id";
import { useEngineAuthStatus } from "../../../../../lib/hooks/use-engine-auth-status";
import { useMe } from "../../../../../lib/hooks/use-me";
import { useSession as useAuthSession } from "../../../../../lib/hooks/use-session";
import { useArchiveSession, useRestoreSession, useSession, useSessionEvents, type AgentSessionEvent } from "../../../../../lib/hooks/use-sessions";

type GatewayClientMessage =
  | { type: "client_hello"; clientVersion?: string }
  | { type: "session_join"; sessionId: string }
  | { type: "session_send"; sessionId: string; message: string; idempotencyKey?: string }
  | { type: "session_cancel"; sessionId: string }
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
  eventType: string;
};
type MessageSegment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string; language: string | null };

const EXECUTOR_SETUP_ERROR_CODES = new Set(["NO_AGENT_AVAILABLE", "PINNED_AGENT_OFFLINE"]);
const DEFAULT_NODE_AGENT_CONNECT_TEMPLATE =
  'npx -y @vespid/node-agent@latest connect --pairing-token "<pairing-token>" --api-base "<api-base>"';
const DEFAULT_NODE_AGENT_START_COMMAND = "npx -y @vespid/node-agent@latest start";

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

function normalizeNodeAgentApiBase(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "localhost") {
      url.hostname = "127.0.0.1";
      return url.toString().replace(/\/$/, "");
    }
    return value;
  } catch {
    return value;
  }
}

function buildConnectCommand(input: { template: string; pairingToken: string; apiBase: string }): string {
  return input.template
    .replaceAll("<pairing-token>", input.pairingToken)
    .replaceAll("<api-base>", normalizeNodeAgentApiBase(input.apiBase));
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
    return humanizeEventType(event.eventType);
  }
  return humanizeEventType(event.eventType);
}

function inferRole(event: AgentSessionEvent): ChatRole | null {
  const eventType = event.eventType.toLowerCase();
  if (
    eventType.includes("user_message") ||
    eventType.includes("client_message") ||
    eventType.includes("session_send") ||
    eventType.includes("input")
  ) {
    return "user";
  }
  if (
    eventType.includes("assistant") ||
    eventType.includes("agent_message") ||
    eventType.includes("agent_final") ||
    eventType.includes("model_output") ||
    eventType.includes("output")
  ) {
    return "assistant";
  }
  if (
    eventType.includes("error") ||
    eventType.includes("handoff") ||
    eventType.includes("warning") ||
    eventType.includes("warn") ||
    eventType.includes("system")
  ) {
    return "system";
  }
  return null;
}

function humanizeEventType(eventType: string): string {
  if (!eventType || eventType.trim().length === 0) {
    return "system event";
  }
  return eventType
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .trim();
}

function splitMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const pattern = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const [raw, languageRaw, codeRaw] = match;
    const start = match.index;
    if (start > cursor) {
      const plain = text.slice(cursor, start).trim();
      if (plain.length > 0) {
        segments.push({ kind: "text", value: plain });
      }
    }
    const language = typeof languageRaw === "string" && languageRaw.trim().length > 0 ? languageRaw.trim() : null;
    const code = typeof codeRaw === "string" ? codeRaw.replace(/\n$/, "") : "";
    segments.push({ kind: "code", value: code, language });
    cursor = start + raw.length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    const plain = text.slice(cursor).trim();
    if (plain.length > 0) {
      segments.push({ kind: "text", value: plain });
    }
  }
  if (segments.length === 0) {
    return [{ kind: "text", value: text }];
  }
  return segments;
}

function normalizeMessageTextForDedup(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collapseAdjacentDuplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const collapsed: ChatMessage[] = [];
  for (const item of messages) {
    const previous = collapsed[collapsed.length - 1] ?? null;
    if (!previous) {
      collapsed.push(item);
      continue;
    }
    if (item.role === "user" || previous.role === "user") {
      collapsed.push(item);
      continue;
    }
    const sameRole = item.role === previous.role;
    const sameText = normalizeMessageTextForDedup(item.text) === normalizeMessageTextForDedup(previous.text);
    if (!sameRole || !sameText) {
      collapsed.push(item);
      continue;
    }
    // Keep the latest event in a duplicate run so final events override delta-like entries.
    collapsed[collapsed.length - 1] = item.seq >= previous.seq ? item : previous;
  }
  return collapsed;
}

function renderTextWithInlineCode(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`\n]+`)/g);
  if (parts.length <= 1) {
    return text;
  }
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={`${keyPrefix}:code:${index}`}
          className="rounded-md border border-borderSubtle/80 bg-surface2/75 px-1.5 py-0.5 font-mono text-[0.92em] text-[rgb(var(--syntax-function))]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={`${keyPrefix}:text:${index}`}>{part}</Fragment>;
  });
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
  const meQuery = useMe(Boolean(authSession.data?.session));

  const sessionQuery = useSession(scopedOrgId, conversationId || null);
  const eventsQuery = useSessionEvents(scopedOrgId, conversationId || null);
  const archiveSession = useArchiveSession(scopedOrgId);
  const restoreSession = useRestoreSession(scopedOrgId);
  const installerQuery = useAgentInstaller();
  const createPairingTokenMutation = useCreatePairingToken(scopedOrgId);
  const engineAuthStatusQuery = useEngineAuthStatus(scopedOrgId, { refetchIntervalMs: 10_000 });

  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string>("");
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastUserMessageText, setLastUserMessageText] = useState("");
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [sessionErrorCodes, setSessionErrorCodes] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftMessage = searchParams.get("draft") ?? "";
  const autoSendDraftRef = useRef<string>(draftMessage);
  const autoSendDoneRef = useRef(false);
  const autoPairingTokenOrgRef = useRef<string | null>(null);

  useEffect(() => {
    setEvents([]);
    setSessionErrorCodes([]);
    setIsGenerating(false);
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
    const mapped = events
      .map((event) => {
        const role = inferRole(event);
        if (!role) {
          return null;
        }
        const text = extractEventText(event);
        if (!text || text.trim().length === 0) {
          return null;
        }
        return {
          id: `${event.id}:${event.seq}`,
          seq: event.seq,
          role,
          text,
          createdAt: event.createdAt,
          eventType: event.eventType,
        } satisfies ChatMessage;
      })
      .filter((item): item is ChatMessage => Boolean(item));
    return collapseAdjacentDuplicateMessages(mapped);
  }, [events]);

  const latestUserMessage = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      const item = chatMessages[i];
      if (item?.role === "user") {
        return item;
      }
    }
    return null;
  }, [chatMessages]);

  const roleKey = meQuery.data?.orgs?.find((o) => o.id === scopedOrgId)?.roleKey ?? null;
  const canManageExecutors = roleKey === "owner" || roleKey === "admin";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const next = Math.max(88, Math.min(textarea.scrollHeight, 260));
    textarea.style.height = `${next}px`;
  }, [message]);

  const pairingExpiresMs = pairingExpiresAt ? Date.parse(pairingExpiresAt) : NaN;
  const pairingTokenExpired =
    Boolean(pairingToken) && Number.isFinite(pairingExpiresMs) && pairingExpiresMs <= Date.now();
  const resolvedPairingToken = !pairingToken || pairingTokenExpired ? "<pairing-token>" : pairingToken;
  const hasUsablePairingToken = resolvedPairingToken !== "<pairing-token>";

  const installerCommands = installerQuery.data?.commands ?? null;
  const connectCommand = buildConnectCommand({
    template: installerCommands?.connect ?? DEFAULT_NODE_AGENT_CONNECT_TEMPLATE,
    pairingToken: resolvedPairingToken,
    apiBase: getApiBase(),
  });
  const startCommand = installerCommands?.start ?? DEFAULT_NODE_AGENT_START_COMMAND;

  const eventErrorCodes = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      const payload = asRecord(event.payload);
      const code = payload && typeof payload.code === "string" ? payload.code : null;
      if (code) {
        set.add(code);
      }
    }
    return set;
  }, [events]);

  const hasOnlineExecutors = useMemo(() => {
    const engines = engineAuthStatusQuery.data?.engines;
    if (!engines) {
      return false;
    }
    return Object.values(engines).some((entry) => entry.onlineExecutors > 0);
  }, [engineAuthStatusQuery.data?.engines]);

  const showExecutorGuide = useMemo(() => {
    if (hasOnlineExecutors) {
      return false;
    }
    for (const code of sessionErrorCodes) {
      if (EXECUTOR_SETUP_ERROR_CODES.has(code)) return true;
    }
    for (const code of eventErrorCodes) {
      if (EXECUTOR_SETUP_ERROR_CODES.has(code)) return true;
    }
    return false;
  }, [eventErrorCodes, hasOnlineExecutors, sessionErrorCodes]);

  useEffect(() => {
    setPairingToken(null);
    setPairingExpiresAt(null);
    autoPairingTokenOrgRef.current = null;
  }, [scopedOrgId]);

  const issuePairingToken = useCallback(
    async (input?: { auto?: boolean }) => {
      if (!canManageExecutors) {
        return;
      }
      try {
        const payload = await createPairingTokenMutation.mutateAsync();
        setPairingToken(payload.token);
        setPairingExpiresAt(payload.expiresAt);
        if (input?.auto) {
          toast.success(t("sessions.executorGuide.autoTokenCreated"));
        } else {
          toast.success(t("agents.pairingCreated"));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.unknownError"));
      }
    },
    [canManageExecutors, createPairingTokenMutation, t]
  );

  useEffect(() => {
    if (!showExecutorGuide || !scopedOrgId || !canManageExecutors) {
      return;
    }
    if (hasUsablePairingToken || createPairingTokenMutation.isPending) {
      return;
    }
    if (autoPairingTokenOrgRef.current === scopedOrgId) {
      return;
    }
    autoPairingTokenOrgRef.current = scopedOrgId;
    void issuePairingToken({ auto: true });
  }, [
    canManageExecutors,
    createPairingTokenMutation.isPending,
    hasUsablePairingToken,
    issuePairingToken,
    scopedOrgId,
    showExecutorGuide,
  ]);

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
        setIsGenerating(false);
      };

      ws.onerror = () => {
        setWsError(t("sessions.ws.error"));
        setIsGenerating(false);
      };

      ws.onmessage = (evt) => {
        const raw = typeof evt.data === "string" ? evt.data : "";
        const msg = safeJsonParse(raw) as GatewayServerMessage | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "session_error") {
          setSessionErrorCodes((prev) => (prev.includes(msg.code) ? prev : [...prev, msg.code]));
          setIsGenerating(false);
          if (msg.code !== "TURN_CANCELED") {
            toast.error(`${msg.code}: ${msg.message}`);
          }
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
          setIsGenerating(false);
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
          if (msg.eventType === "agent_final" || msg.eventType === "error") {
            setIsGenerating(false);
          }
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

  function sendText(text: string): boolean {
    const currentSession = sessionQuery.data?.session;
    if (currentSession?.status === "archived") {
      toast.error(t("sessions.actions.archivedReadonly"));
      return false;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error(t("sessions.ws.notConnected"));
      return false;
    }
    const payload: GatewayClientMessage = {
      type: "session_send",
      sessionId: conversationId,
      message: text,
      idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    ws.send(JSON.stringify(payload));
    setIsGenerating(true);
    setLastUserMessageText(text);
    return true;
  }

  function stopGeneration() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast.error(t("sessions.ws.notConnected"));
      return;
    }
    const payload: GatewayClientMessage = {
      type: "session_cancel",
      sessionId: conversationId,
    };
    ws.send(JSON.stringify(payload));
    setIsGenerating(false);
  }

  function retryLastMessage() {
    const text = (latestUserMessage?.text ?? lastUserMessageText).trim();
    if (!text) {
      return;
    }
    if (sendText(text)) {
      toast.success(t("sessions.chat.retrying"));
    }
  }

  function editAndResend(text: string) {
    setMessage(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  useEffect(() => {
    if (!connected || autoSendDoneRef.current) {
      return;
    }
    const initial = autoSendDraftRef.current.trim();
    if (!initial) {
      return;
    }

    if (sendText(initial)) {
      autoSendDoneRef.current = true;
      router.replace(`/${locale}/conversations/${conversationId}`);
    }
  }, [connected, conversationId, locale, router]);

  function send() {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    if (sendText(trimmed)) {
      setMessage("");
    }
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
    (eventsQuery.isError && isUnauthorizedError(eventsQuery.error)) ||
    (engineAuthStatusQuery.isError && isUnauthorizedError(engineAuthStatusQuery.error));

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
            void engineAuthStatusQuery.refetch();
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
          {session.status === "archived" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={restoreSession.isPending}
              onClick={async () => {
                try {
                  await restoreSession.mutateAsync(session.id);
                  toast.success(t("sessions.actions.restored"));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                }
              }}
            >
              {t("sessions.actions.restore")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={archiveSession.isPending}
              onClick={async () => {
                try {
                  await archiveSession.mutateAsync(session.id);
                  toast.success(t("sessions.actions.deleted"));
                  router.push(`/${locale}/conversations`);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                }
              }}
            >
              {t("sessions.actions.delete")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/conversations`)}>
            {t("common.back")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => connectWs()} disabled={!canConnect || connected}>
            {t("sessions.ws.reconnect")}
          </Button>
        </div>
      </div>

      {wsError ? <div className="text-sm text-red-700">{wsError}</div> : null}

      {showExecutorGuide ? (
        <section
          className="rounded-[var(--radius-lg)] border border-warn/40 bg-warn/10 p-4 shadow-elev1 md:p-5"
          data-testid="conversation-detail-executor-onboarding-guide"
        >
          <div className="grid gap-3">
            <div className="grid gap-1">
              <div className="text-base font-semibold text-text">{t("sessions.executorGuide.title")}</div>
              <div className="text-sm text-muted">
                {canManageExecutors ? t("sessions.executorGuide.subtitleOwner") : t("sessions.executorGuide.subtitleMember")}
              </div>
            </div>

            {canManageExecutors ? (
              <div className="grid gap-3">
                <div className="grid gap-2 rounded-[var(--radius-md)] border border-borderSubtle/70 bg-panel/45 p-3">
                  <div className="text-xs font-medium text-text">{t("sessions.executorGuide.tokenLabel")}</div>
                  {hasUsablePairingToken ? (
                    <>
                      <div className="font-mono text-xs leading-5 text-text break-all">{pairingToken}</div>
                      {pairingExpiresAt ? <div className="text-xs text-muted">{pairingExpiresAt}</div> : null}
                    </>
                  ) : (
                    <div className="text-xs text-muted">
                      {createPairingTokenMutation.isPending
                        ? t("sessions.executorGuide.creatingToken")
                        : t("sessions.executorGuide.tokenUnavailable")}
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <div className="text-xs font-medium text-muted">{t("sessions.executorGuide.connectCommand")}</div>
                    <CommandBlock command={connectCommand} copyLabel={t("agents.installer.copyConnect")} />
                  </div>
                  <div className="grid gap-1">
                    <div className="text-xs font-medium text-muted">{t("agents.installer.startCommand")}</div>
                    <CommandBlock command={startCommand} copyLabel={t("agents.installer.copyStart")} />
                  </div>
                  {!hasUsablePairingToken ? (
                    <div className="rounded-md border border-warn/35 bg-warn/10 p-2 text-xs text-warn">
                      {pairingTokenExpired ? t("agents.installer.tokenExpired") : t("agents.installer.tokenMissing")}
                    </div>
                  ) : null}
                  {installerQuery.data?.delivery ? (
                    <div className="rounded-md border border-borderSubtle/70 bg-panel/45 p-2 text-xs text-muted">
                      {installerQuery.data.delivery === "local-dev"
                        ? t("agents.installer.deliveryLocalDev")
                        : t("agents.installer.deliveryNpm")}
                    </div>
                  ) : null}
                  {!installerCommands ? (
                    <div className="rounded-md border border-borderSubtle/70 bg-panel/45 p-3 text-xs text-muted">
                      {t("sessions.executorGuide.installerUnavailable")}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="accent" onClick={() => void issuePairingToken()} disabled={createPairingTokenMutation.isPending}>
                    {t("sessions.executorGuide.regenerateToken")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                    {t("sessions.executorGuide.checkStatus")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => router.push(`/${locale}/agents`)}>
                    {t("sessions.executorGuide.openAgents")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <div className="rounded-md border border-borderSubtle/70 bg-panel/45 px-3 py-2 text-xs text-muted">
                  {t("sessions.executorGuide.memberCannotPair")}
                </div>
                <Button size="sm" variant="outline" onClick={() => void engineAuthStatusQuery.refetch()}>
                  {t("sessions.executorGuide.checkStatus")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => router.push(`/${locale}/agents`)}>
                  {t("sessions.executorGuide.openAgents")}
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section
        className="rounded-[var(--radius-lg)] border border-borderSubtle/65 bg-gradient-to-b from-panel/80 to-panel/66 p-3 shadow-elev1 md:p-4"
        data-testid="conversation-message-stream"
      >
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
          <div className="max-h-[64vh] overflow-y-auto pr-1">
            <div className="mx-auto w-full max-w-[720px] space-y-2.5 px-1 md:max-w-[760px] md:px-2">
              {chatMessages.map((item) => (
                <div
                  key={item.id}
                  data-testid={`conversation-message-${item.role}`}
                  className={cn(
                    "flex w-full",
                    item.role === "user" && "justify-end",
                    item.role === "assistant" && "justify-start",
                    item.role === "system" && "justify-center"
                  )}
                >
                  <div className={cn("grid gap-1", item.role === "system" ? "max-w-[62%]" : "max-w-[78%]")}>
                    <div
                      className={cn(
                        "rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-elev1",
                        item.role === "user" && "chat-bubble-user",
                        item.role === "assistant" && "border-borderSubtle/75 bg-surface1/78 text-text",
                        item.role === "system" && "rounded-xl border-dashed border-borderSubtle/80 bg-panel/35 px-3 py-1.5 text-xs text-muted"
                      )}
                    >
                      {item.role !== "system" ? (
                        <div
                          className={cn(
                            "mb-2 text-[11px] font-medium uppercase tracking-wide",
                            item.role === "user" ? "text-accent/95" : "text-muted"
                          )}
                        >
                          {item.role === "user" ? t("sessions.chat.roleUser") : t("sessions.chat.roleAssistant")}
                        </div>
                      ) : null}
                      <div className="grid gap-2.5">
                        {splitMessageSegments(item.text).map((segment, index) =>
                          segment.kind === "text" ? (
                            <div key={`${item.id}:text:${index}`} className="whitespace-pre-wrap break-words">
                              {renderTextWithInlineCode(segment.value, `${item.id}:${index}`)}
                            </div>
                          ) : (
                            <SyntaxCodeBlock
                              key={`${item.id}:code:${index}`}
                              code={segment.value}
                              language={segment.language}
                            />
                          )
                        )}
                      </div>
                    </div>
                    {item.role === "user" && latestUserMessage?.id === item.id ? (
                      <div className="flex items-center justify-end gap-2 px-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => editAndResend(item.text)}>
                          {t("sessions.chat.editResend")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={retryLastMessage}
                          disabled={!connected || isGenerating}
                        >
                          {t("sessions.chat.retry")}
                        </Button>
                      </div>
                    ) : null}
                    <div className={cn("px-1 text-[11px] text-muted", item.role === "user" ? "text-right" : "text-left")}>
                      #{item.seq} {formatTime(item.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-borderSubtle/65 bg-panel/72 p-3 shadow-elev1 md:p-4">
        <div className="grid gap-2">
          <Textarea
            ref={textareaRef}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("sessions.chat.placeholder")}
            disabled={!canConnect || session.status === "archived"}
            className="resize-none border-0 bg-transparent px-0 py-0 shadow-none focus:border-transparent focus:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isGenerating) {
                  stopGeneration();
                } else {
                  send();
                }
              }
            }}
          />
          <div className="flex items-center justify-between gap-3 border-t border-borderSubtle/60 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t("sessions.chat.shortcutHint")}</span>
              {isGenerating ? (
                <span
                  className="chat-generating-indicator inline-flex items-center gap-2 rounded-full border border-accent/50 px-3 py-1 text-[11px] font-semibold text-accent"
                  role="status"
                  aria-live="polite"
                >
                  <span>{t("sessions.chat.generating")}</span>
                  <span className="chat-generating-dots" aria-hidden="true">
                    <span className="chat-generating-dot" />
                    <span className="chat-generating-dot" />
                    <span className="chat-generating-dot" />
                  </span>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={retryLastMessage}
                disabled={!connected || isGenerating || !(latestUserMessage?.text ?? lastUserMessageText).trim()}
              >
                {t("sessions.chat.retry")}
              </Button>
              {isGenerating ? (
                <Button variant="danger" size="sm" className="h-8 rounded-full px-3" disabled={!canConnect || !connected} onClick={stopGeneration}>
                  {t("sessions.chat.stop")}
                </Button>
              ) : (
                <Button
                  variant="accent"
                  size="sm"
                  className="h-8 rounded-full px-3"
                  disabled={!canConnect || !connected || session.status === "archived" || message.trim().length === 0}
                  onClick={send}
                >
                  {t("sessions.chat.send")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
