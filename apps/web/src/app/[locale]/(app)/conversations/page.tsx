"use client";

import { Send, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useCreateSession, useSessions } from "../../../../lib/hooks/use-sessions";
import { type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { providersForContext } from "../../../../components/app/llm/model-catalog";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { isUnauthorizedError } from "../../../../lib/api";
import { AdvancedConfigSheet } from "../../../../components/app/advanced-config-sheet";
import { SessionModelChip } from "../../../../components/app/llm/session-model-chip";

const DEFAULT_CHAT_TITLE = "";
const DEFAULT_INSTRUCTIONS = "Help me accomplish my task safely and efficiently.";

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

export default function ConversationsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;
  const meQuery = useMe(Boolean(authSession.data?.session));
  const sessionsQuery = useSessions(scopedOrgId);
  const toolsetsQuery = useToolsets(scopedOrgId);
  const createSession = useCreateSession(scopedOrgId);
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

  const [llm, setLlm] = useState<LlmConfigValue>({ providerId: "openai", modelId: "gpt-5-codex", secretId: null });
  const llmInitRef = useRef(false);

  const canOperate = Boolean(scopedOrgId);
  const roleKey = meQuery.data?.orgs?.find((o) => o.id === scopedOrgId)?.roleKey ?? null;
  const canEditOrgSettings = roleKey === "owner" || roleKey === "admin";
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
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error));

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
                disabled={!canOperate || createSession.isPending || message.trim().length === 0}
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
            </div>
          </section>

          <section className="grid gap-2" data-testid="conversation-recent-list">
            <div className="grid gap-0.5">
              <div className="text-sm font-medium text-text">{t("sessions.list.title")}</div>
              <div className="text-xs text-muted">{t("sessions.list.subtitle")}</div>
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
                  <button
                    key={session.id}
                    type="button"
                    className="w-full rounded-[var(--radius-sm)] border border-borderSubtle/55 bg-panel/45 px-3 py-2 text-left transition-[background-color,border-color] hover:border-borderStrong/70 hover:bg-panel/70"
                    onClick={() => router.push(`/${locale}/conversations/${session.id}`)}
                  >
                    <div className="truncate text-sm font-medium text-text">{session.title?.trim() || t("sessions.untitled")}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {session.llmProvider}:{session.llmModel}
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{formatSessionTime(session.lastActivityAt)}</div>
                  </button>
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
