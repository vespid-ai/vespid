"use client";

import { Send, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Separator } from "../../../../components/ui/separator";
import { Textarea } from "../../../../components/ui/textarea";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useMe } from "../../../../lib/hooks/use-me";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { useToolsets } from "../../../../lib/hooks/use-toolsets";
import { useArchiveSession, useCreateSession, useRestoreSession, useSessions, type SessionListStatus } from "../../../../lib/hooks/use-sessions";
import { useAgentInstaller, useCreatePairingToken } from "../../../../lib/hooks/use-agents";
import { useEngineAuthStatus } from "../../../../lib/hooks/use-engine-auth-status";
import { type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { providersForContext } from "../../../../components/app/llm/model-catalog";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { getApiBase, isUnauthorizedError } from "../../../../lib/api";
import { AdvancedConfigSheet } from "../../../../components/app/advanced-config-sheet";
import { SessionModelChip } from "../../../../components/app/llm/session-model-chip";
import { CommandBlock } from "../../../../components/ui/command-block";

const DEFAULT_CHAT_TITLE = "";
const DEFAULT_INSTRUCTIONS = "Help me accomplish my task safely and efficiently.";
const DEFAULT_NODE_AGENT_CONNECT_TEMPLATE =
  'npx -y @vespid/node-agent@latest connect --pairing-token "<pairing-token>" --api-base "<api-base>"';
const DEFAULT_NODE_AGENT_START_COMMAND = "npx -y @vespid/node-agent@latest start";
type EngineAuthStatusSnapshot = ReturnType<typeof useEngineAuthStatus>["data"];

function formatSessionTime(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function countUniqueOnlineExecutors(status: EngineAuthStatusSnapshot): number {
  const engines = status?.engines;
  if (!engines) return 0;
  const ids = new Set<string>();
  for (const key of Object.keys(engines) as Array<keyof typeof engines>) {
    for (const executor of engines[key].executors ?? []) {
      if (executor.executorId) ids.add(executor.executorId);
    }
  }
  return ids.size;
}

export default function ConversationsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;
  const meQuery = useMe(Boolean(authSession.data?.session));
  const [sessionListStatus, setSessionListStatus] = useState<SessionListStatus>("active");
  const sessionsQuery = useSessions(scopedOrgId, sessionListStatus);
  const toolsetsQuery = useToolsets(scopedOrgId);
  const createSession = useCreateSession(scopedOrgId);
  const archiveSession = useArchiveSession(scopedOrgId);
  const restoreSession = useRestoreSession(scopedOrgId);
  const installerQuery = useAgentInstaller();
  const createPairingTokenMutation = useCreatePairingToken(scopedOrgId);
  const engineAuthStatusQuery = useEngineAuthStatus(scopedOrgId, { refetchIntervalMs: 10_000 });
  const settingsQuery = useOrgSettings(scopedOrgId);
  const updateSettings = useUpdateOrgSettings(scopedOrgId);

  const sessions = sessionsQuery.data?.sessions ?? [];
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const at = Date.parse(a.lastActivityAt);
      const bt = Date.parse(b.lastActivityAt);
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });
  }, [sessions]);

  const toolsets = toolsetsQuery.data?.toolsets ?? [];

  const [title, setTitle] = useState<string>(DEFAULT_CHAT_TITLE);
  const [message, setMessage] = useState<string>("");
  const [instructions, setInstructions] = useState<string>(DEFAULT_INSTRUCTIONS);
  const [toolsetId, setToolsetId] = useState<string>("");
  const [selectorTag, setSelectorTag] = useState<string>("");
  const [system, setSystem] = useState<string>("");
  const [allowShellRun, setAllowShellRun] = useState(false);
  const [allowConnectorAction, setAllowConnectorAction] = useState(true);
  const [extraToolsRaw, setExtraToolsRaw] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);

  const [llm, setLlm] = useState<LlmConfigValue>({ providerId: "openai", modelId: "gpt-5-codex", secretId: null });
  const llmInitRef = useRef(false);
  const autoPairingTokenOrgRef = useRef<string | null>(null);

  const canOperate = Boolean(scopedOrgId);
  const roleKey = meQuery.data?.orgs?.find((o) => o.id === scopedOrgId)?.roleKey ?? null;
  const canEditOrgSettings = roleKey === "owner" || roleKey === "admin";
  const canManageExecutors = roleKey === "owner" || roleKey === "admin";
  const memberReadOnlyDefaults = roleKey === "member";
  const llmSecretMissingWarning = isOAuthRequiredProvider(llm.providerId) && !llm.secretId;

  const selectedToolset = toolsets.find((ts: any) => ts.id === toolsetId) ?? null;
  const sessionAllowedProviders = providersForContext("session").filter((provider) =>
    provider === "openai" || provider === "openai-codex" || provider === "anthropic" || provider === "opencode"
  );

  const toolAllow = useMemo(() => {
    const base: string[] = [];
    if (allowShellRun) base.push("shell.run");
    if (allowConnectorAction) base.push("connector.action");
    const extras = extraToolsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...base, ...extras]));
  }, [allowShellRun, allowConnectorAction, extraToolsRaw]);

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

  const onlineExecutorCount = useMemo(() => countUniqueOnlineExecutors(engineAuthStatusQuery.data), [engineAuthStatusQuery.data]);

  const needsExecutorOnboarding = canOperate && engineAuthStatusQuery.isSuccess && onlineExecutorCount === 0;
  const canStartConversation = canOperate && !createSession.isPending && message.trim().length > 0;

  useEffect(() => {
    if (llmInitRef.current) return;
    const sessionDefaults = settingsQuery.data?.settings?.llm?.defaults?.primary as any;
    const provider = sessionDefaults && typeof sessionDefaults.provider === "string" ? sessionDefaults.provider : null;
    const model = sessionDefaults && typeof sessionDefaults.model === "string" ? sessionDefaults.model : null;
    if (provider || model) {
      const normalizedProvider = provider === "openai-codex" ? "openai" : provider;
      setLlm((prev) => ({
        ...prev,
        ...(normalizedProvider ? { providerId: normalizedProvider as any } : {}),
        ...(model ? { modelId: model } : {}),
      }));
    }
    llmInitRef.current = true;
  }, [settingsQuery.data?.settings]);

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
    if (!scopedOrgId || !needsExecutorOnboarding || !canManageExecutors) {
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
    needsExecutorOnboarding,
    scopedOrgId,
  ]);

  function resetDraft() {
    setTitle(DEFAULT_CHAT_TITLE);
    setMessage("");
    setInstructions(DEFAULT_INSTRUCTIONS);
    setToolsetId("");
    setSelectorTag("");
    setSystem("");
    setAllowShellRun(false);
    setAllowConnectorAction(true);
    setExtraToolsRaw("");
    setAdvancedOpen(false);
  }

  async function startConversation() {
    if (!scopedOrgId) {
      return;
    }
    const firstMessage = message.trim();
    if (!firstMessage) {
      return;
    }

    try {
      const engineId =
        llm.providerId === "anthropic" ? "gateway.claude.v2" : llm.providerId === "opencode" ? "gateway.opencode.v2" : "gateway.codex.v2";
      const payload = {
        ...(title.trim().length > 0 ? { title: title.trim() } : {}),
        engine: {
          id: engineId as "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2",
          model: llm.modelId.trim(),
          ...(llm.secretId ? { auth: { secretId: llm.secretId } } : {}),
        },
        ...(toolsetId.trim().length > 0 ? { toolsetId: toolsetId.trim() } : {}),
        prompt: {
          ...(system.trim().length > 0 ? { system: system.trim() } : {}),
          instructions: instructions.trim() || DEFAULT_INSTRUCTIONS,
        },
        tools: { allow: toolAllow },
        ...(selectorTag.trim().length > 0 ? { executorSelector: { pool: "byon", tag: selectorTag.trim() } } : {}),
      } as const;

      const out = await createSession.mutateAsync(payload as any);
      const id = out.session?.id ?? null;
      if (!id) {
        toast.error(t("common.unknownError"));
        return;
      }

      toast.success(t("sessions.create.created"));
      resetDraft();
      router.push(`/${locale}/conversations/${id}?draft=${encodeURIComponent(firstMessage)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.unknownError"));
    }
  }

  function choiceButtonProps(isSelected: boolean): {
    variant: "outline" | "ghost";
    className: string;
    "aria-pressed": boolean;
  } {
    return {
      variant: isSelected ? "outline" : "ghost",
      className: isSelected ? "border-borderStrong/80 bg-panel/55" : "text-muted hover:bg-panel/45 hover:text-text",
      "aria-pressed": isSelected,
    };
  }

  function openAdvancedSettings() {
    setAdvancedOpen(true);
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void sessionsQuery.refetch();
            void toolsetsQuery.refetch();
            void settingsQuery.refetch();
            void engineAuthStatusQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
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
    (sessionsQuery.isError && isUnauthorizedError(sessionsQuery.error)) ||
    (toolsetsQuery.isError && isUnauthorizedError(toolsetsQuery.error)) ||
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error)) ||
    (engineAuthStatusQuery.isError && isUnauthorizedError(engineAuthStatusQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void sessionsQuery.refetch();
            void toolsetsQuery.refetch();
            void settingsQuery.refetch();
            void engineAuthStatusQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6" data-testid="conversation-create-layout">
      <div className="mx-auto w-full max-w-4xl">
        <div className="grid gap-6">
          <div className="grid gap-1 text-center">
            <div className="font-[var(--font-display)] text-4xl font-semibold tracking-tight">{t("sessions.create.heroTitle")}</div>
            <div className="text-sm text-muted">{t("sessions.create.heroSubtitle")}</div>
          </div>

          <section
            className="rounded-[var(--radius-lg)] border border-borderSubtle/65 bg-panel/72 p-4 shadow-elev1 md:p-5"
            data-testid="conversation-composer"
          >
            <Label htmlFor="session-message" className="sr-only">
              {t("sessions.chat.message")}
            </Label>
            <Textarea
              id="session-message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("sessions.chat.placeholder")}
              disabled={!canOperate}
              className="min-h-[150px] resize-y border-0 bg-transparent px-0 py-0 shadow-none focus:border-transparent focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void startConversation();
                }
              }}
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borderSubtle/60 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <SessionModelChip
                  value={{ providerId: llm.providerId, modelId: llm.modelId }}
                  allowedProviders={sessionAllowedProviders}
                  disabled={!canOperate || memberReadOnlyDefaults}
                  onChange={(next) =>
                    setLlm((prev) => ({
                      ...prev,
                      providerId: next.providerId,
                      modelId: next.modelId,
                    }))
                  }
                />
                <Button variant="outline" size="sm" onClick={openAdvancedSettings} disabled={!canOperate} className="rounded-full">
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("sessions.create.configureAdvanced")}
                </Button>
              </div>

              <Button
                variant="accent"
                size="sm"
                className="rounded-full"
                disabled={!canStartConversation}
                onClick={() => void startConversation()}
              >
                <Send className="mr-1 h-4 w-4" />
                {t("sessions.chat.send")}
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>{t("sessions.chat.shortcutHint")}</span>
              {llmSecretMissingWarning ? <span className="text-warn">{t("sessions.create.oauthRequired")}</span> : null}
              {memberReadOnlyDefaults ? <span>{t("sessions.create.memberDefaults")}</span> : null}
              {needsExecutorOnboarding ? <span className="text-warn">{t("sessions.executorGuide.blockComposerHint")}</span> : null}
            </div>
          </section>

          {needsExecutorOnboarding ? (
            <section
              className="rounded-[var(--radius-lg)] border border-warn/40 bg-warn/10 p-4 shadow-elev1 md:p-5"
              data-testid="executor-onboarding-guide"
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
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => void issuePairingToken()}
                        disabled={createPairingTokenMutation.isPending}
                      >
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

          <section className="grid gap-2" data-testid="conversation-recent-list">
            <div className="grid gap-0.5">
              <div className="text-sm font-medium text-text">{t("sessions.list.title")}</div>
              <div className="text-xs text-muted">{t("sessions.list.subtitle")}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={sessionListStatus === "active" ? "outline" : "ghost"}
                onClick={() => setSessionListStatus("active")}
              >
                {t("sessions.list.filterActive")}
              </Button>
              <Button
                size="sm"
                variant={sessionListStatus === "archived" ? "outline" : "ghost"}
                onClick={() => setSessionListStatus("archived")}
              >
                {t("sessions.list.filterArchived")}
              </Button>
              <Button
                size="sm"
                variant={sessionListStatus === "all" ? "outline" : "ghost"}
                onClick={() => setSessionListStatus("all")}
              >
                {t("sessions.list.filterAll")}
              </Button>
            </div>
            {sessionsQuery.isLoading ? (
              <div className="rounded-[var(--radius-md)] border border-borderSubtle/60 bg-panel/55 p-3 text-sm text-muted">
                {t("common.loading")}
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="rounded-[var(--radius-md)] border border-borderSubtle/60 bg-panel/55 p-3 text-sm text-muted">
                {t("sessions.list.empty")}
              </div>
            ) : (
              <div className="grid gap-2">
                {sortedSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-borderSubtle/55 bg-panel/45 px-3 py-2"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left transition-[background-color,border-color] hover:opacity-90"
                      onClick={() => router.push(`/${locale}/conversations/${session.id}`)}
                    >
                      <div className="truncate text-sm font-medium text-text">{session.title?.trim() || t("sessions.untitled")}</div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {session.llmProvider}:{session.llmModel}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">{formatSessionTime(session.lastActivityAt)}</div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
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
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                            }
                          }}
                        >
                          {t("sessions.actions.delete")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <AdvancedConfigSheet
            open={advancedOpen}
            onOpenChange={(next) => {
              setAdvancedOpen(next);
            }}
            title={t("sessions.create.advancedTitle")}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setAdvancedOpen(false)}>
                  {t("common.close")}
                </Button>
              </div>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="session-title">{t("sessions.fields.title")}</Label>
                  <Input id="session-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canOperate} />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="session-instructions">{t("sessions.fields.instructions")}</Label>
                <Textarea
                  id="session-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  disabled={!canOperate}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="session-system">{t("sessions.fields.system")}</Label>
                <Textarea id="session-system" value={system} onChange={(e) => setSystem(e.target.value)} rows={3} disabled={!canOperate} />
              </div>

              <Separator />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="session-toolset">{t("sessions.fields.toolset")}</Label>
                  <Input
                    id="session-toolset"
                    value={toolsetId}
                    onChange={(e) => setToolsetId(e.target.value)}
                    placeholder={t("sessions.toolsetPlaceholder")}
                    disabled={!canOperate}
                  />
                  {selectedToolset ? <div className="text-xs text-muted">{`${t("sessions.toolsetResolved")}: ${selectedToolset.name}`}</div> : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="session-selector-tag">{t("sessions.fields.selectorTag")}</Label>
                  <Input
                    id="session-selector-tag"
                    value={selectorTag}
                    onChange={(e) => setSelectorTag(e.target.value)}
                    placeholder={t("sessions.selectorTagPlaceholder")}
                    disabled={!canOperate}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="session-extra-tools">{t("sessions.fields.tools")}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    {...choiceButtonProps(allowConnectorAction)}
                    onClick={() => setAllowConnectorAction((v) => !v)}
                    disabled={!canOperate}
                  >
                    connector.action
                  </Button>
                  <Button
                    size="sm"
                    {...choiceButtonProps(allowShellRun)}
                    onClick={() => setAllowShellRun((v) => !v)}
                    disabled={!canOperate}
                  >
                    shell.run
                  </Button>
                </div>
                <Input
                  id="session-extra-tools"
                  value={extraToolsRaw}
                  onChange={(e) => setExtraToolsRaw(e.target.value)}
                  placeholder={t("sessions.extraToolsPlaceholder")}
                  disabled={!canOperate}
                />
              </div>

              {canEditOrgSettings ? (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    disabled={!canOperate || updateSettings.isPending || llm.modelId.trim().length === 0}
                    onClick={async () => {
                      if (!scopedOrgId) return;
                      await updateSettings.mutateAsync({
                        llm: { defaults: { primary: { provider: llm.providerId, model: llm.modelId.trim(), secretId: llm.secretId ?? null } } },
                      });
                      toast.success(t("common.saved"));
                    }}
                  >
                    {t("sessions.saveAsOrgDefault")}
                  </Button>
                </div>
              ) : null}
            </div>
          </AdvancedConfigSheet>
        </div>
      </div>
    </div>
  );
}
