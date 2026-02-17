"use client";

import { Send, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
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
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { providersForContext } from "../../../../components/app/llm/model-catalog";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { isUnauthorizedError } from "../../../../lib/api";
import { QuickCreatePanel } from "../../../../components/app/quick-create-panel";
import { AdvancedConfigSheet } from "../../../../components/app/advanced-config-sheet";

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

  const [llm, setLlm] = useState<LlmConfigValue>({ providerId: "openai", modelId: "gpt-5.3-codex", secretId: null });
  const llmInitRef = useRef(false);

  const canOperate = Boolean(scopedOrgId);
  const roleKey = meQuery.data?.orgs?.find((o) => o.id === scopedOrgId)?.roleKey ?? null;
  const canEditOrgSettings = roleKey === "owner" || roleKey === "admin";
  const memberReadOnlyDefaults = roleKey === "member";
  const llmSecretMissing = isOAuthRequiredProvider(llm.providerId) && !llm.secretId;

  const selectedToolset = toolsets.find((ts: any) => ts.id === toolsetId) ?? null;

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
      setLlm((prev) => ({
        ...prev,
        ...(provider ? { providerId: provider } : {}),
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
      const payload = {
        ...(title.trim().length > 0 ? { title: title.trim() } : {}),
        engineId: "gateway.loop.v2",
        ...(toolsetId.trim().length > 0 ? { toolsetId: toolsetId.trim() } : {}),
        llm: {
          provider: llm.providerId,
          model: llm.modelId.trim(),
          ...(llm.secretId ? { auth: { secretId: llm.secretId } } : {}),
        },
        prompt: {
          ...(system.trim().length > 0 ? { system: system.trim() } : {}),
          instructions: instructions.trim() || DEFAULT_INSTRUCTIONS,
        },
        tools: { allow: toolAllow },
        ...(selectorTag.trim().length > 0 ? { executorSelector: { pool: "managed", tag: selectorTag.trim() } } : {}),
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
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>{t("sessions.list.title")}</CardTitle>
                <CardDescription>{t("sessions.list.subtitle")}</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={resetDraft}>
                {t("sessions.create.title")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {sessionsQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : sortedSessions.length === 0 ? (
              <EmptyState title={t("sessions.list.empty")} />
            ) : (
              <div className="grid gap-2">
                {sortedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="rounded-[var(--radius-sm)] border border-borderSubtle bg-panel/30 px-3 py-2 text-left hover:border-borderStrong/60 hover:bg-panel/45"
                    onClick={() => router.push(`/${locale}/conversations/${session.id}`)}
                  >
                    <div className="truncate text-sm font-medium text-text">{session.title?.trim() || t("sessions.untitled")}</div>
                    <div className="mt-1 text-xs text-muted">
                      {session.llmProvider}:{session.llmModel}
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{formatSessionTime(session.lastActivityAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <QuickCreatePanel
            title={t("sessions.create.title")}
            description={t("sessions.create.quickHint")}
            icon={<Sparkles className="h-4 w-4 text-accent" />}
          >
            <div className="grid gap-2">
              <Label>{t("sessions.fields.model")}</Label>
              <LlmConfigField
                orgId={scopedOrgId}
                mode="session"
                value={llm}
                allowedProviders={providersForContext("session")}
                onChange={setLlm}
                disabled={!canOperate || memberReadOnlyDefaults}
              />
              {llmSecretMissing ? <div className="text-xs text-warn">This provider requires a connected OAuth account.</div> : null}
              {memberReadOnlyDefaults ? <div className="text-xs text-muted">Members use organization default model settings.</div> : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="session-message">{t("sessions.chat.message")}</Label>
              <Textarea
                id="session-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("sessions.chat.placeholder")}
                disabled={!canOperate}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void startConversation();
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="accent"
                  disabled={!canOperate || createSession.isPending || message.trim().length === 0 || llmSecretMissing}
                  onClick={() => void startConversation()}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {t("sessions.chat.send")}
                </Button>
                <Button variant="outline" onClick={openAdvancedSettings} disabled={!canOperate}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("sessions.create.configureAdvanced")}
                </Button>
              </div>
            </div>
          </QuickCreatePanel>

          <AdvancedConfigSheet
            open={advancedOpen}
            onOpenChange={(next) => {
              setAdvancedOpen(next);
            }}
            title={t("sessions.create.advancedTitle")}
            description={t("sessions.create.advancedDescription")}
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
                  <div className="text-xs text-muted">
                    {selectedToolset ? `${t("sessions.toolsetResolved")}: ${selectedToolset.name}` : t("sessions.toolsetHint")}
                  </div>
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
                  <div className="text-xs text-muted">{t("sessions.selectorHint")}</div>
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
                <div className="text-xs text-muted">{t("sessions.toolsHint", { count: toolAllow.length })}</div>
              </div>

              {canEditOrgSettings ? (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    disabled={!canOperate || updateSettings.isPending || llm.modelId.trim().length === 0 || llmSecretMissing}
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
