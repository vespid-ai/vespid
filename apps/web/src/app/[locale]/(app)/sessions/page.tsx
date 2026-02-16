"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
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
import { useCreateSession, useSessions, type AgentSession } from "../../../../lib/hooks/use-sessions";
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";

export default function SessionsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const meQuery = useMe(Boolean(authSession.data?.session));
  const sessionsQuery = useSessions(orgId);
  const toolsetsQuery = useToolsets(orgId);
  const createSession = useCreateSession(orgId);
  const settingsQuery = useOrgSettings(orgId);
  const updateSettings = useUpdateOrgSettings(orgId);

  const sessions = sessionsQuery.data?.sessions ?? [];
  const toolsets = toolsetsQuery.data?.toolsets ?? [];

  const [title, setTitle] = useState("Personal session");
  const [engineId, setEngineId] = useState<"gateway.loop.v2" | "gateway.codex.v2" | "gateway.claude.v2">("gateway.loop.v2");
  const [toolsetId, setToolsetId] = useState<string>("");
  const [selectorTag, setSelectorTag] = useState<string>("");

  const [llm, setLlm] = useState<LlmConfigValue>({ providerId: "openai", modelId: "gpt-4.1-mini", secretId: null });
  const [system, setSystem] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("Help me accomplish my task safely and efficiently.");

  const [allowShellRun, setAllowShellRun] = useState(false);
  const [allowConnectorAction, setAllowConnectorAction] = useState(true);
  const [extraToolsRaw, setExtraToolsRaw] = useState<string>("");

  const canOperate = Boolean(orgId);
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

  const roleKey = meQuery.data?.orgs?.find((o) => o.id === orgId)?.roleKey ?? null;
  const canEditOrgSettings = roleKey === "owner" || roleKey === "admin";

  const llmInitRef = useRef(false);
  useEffect(() => {
    // Initialize from org defaults once.
    if (llmInitRef.current) return;
    const sessionDefaults = settingsQuery.data?.settings?.llm?.defaults?.session as any;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    // Engine-specific provider constraints.
    if (engineId === "gateway.codex.v2") {
      setLlm((prev) => ({ ...prev, providerId: "openai" }));
    }
    if (engineId === "gateway.claude.v2") {
      setLlm((prev) => ({ ...prev, providerId: "anthropic" }));
    }
  }, [engineId]);

  const columns = useMemo(() => {
    return [
      {
        header: t("sessions.table.title"),
        accessorKey: "title",
        cell: ({ row }: any) => <span className="font-medium text-text">{row.original.title || t("sessions.untitled")}</span>,
      },
      {
        header: t("sessions.table.engine"),
        accessorKey: "engineId",
        cell: ({ row }: any) => <span className="font-mono text-xs text-muted">{row.original.engineId}</span>,
      },
      {
        header: t("sessions.table.model"),
        id: "model",
        cell: ({ row }: any) => <span className="font-mono text-xs text-muted">{`${row.original.llmProvider}:${row.original.llmModel}`}</span>,
      },
      {
        header: t("sessions.table.status"),
        accessorKey: "status",
        cell: ({ row }: any) => <span className="text-muted">{row.original.status}</span>,
      },
      {
        header: t("sessions.table.open"),
        id: "open",
        cell: ({ row }: any) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/${locale}/sessions/${row.original.id}`)}
          >
            {t("sessions.table.open")}
          </Button>
        ),
      },
    ] as const;
  }, [locale]);

  const selectedToolset = toolsets.find((ts: any) => ts.id === toolsetId) ?? null;

  // UX rule: a bordered pill indicates the selected option.
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

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("sessions.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("sessions.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.create.title")}</CardTitle>
          <CardDescription>{t("sessions.create.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("sessions.fields.title")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canOperate} />
            </div>

            <div className="grid gap-2">
              <Label>{t("sessions.fields.engine")}</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  {...choiceButtonProps(engineId === "gateway.loop.v2")}
                  onClick={() => setEngineId("gateway.loop.v2")}
                  disabled={!canOperate}
                >
                  gateway.loop.v2
                </Button>
                <Button
                  size="sm"
                  {...choiceButtonProps(engineId === "gateway.codex.v2")}
                  onClick={() => setEngineId("gateway.codex.v2")}
                  disabled={!canOperate}
                >
                  gateway.codex.v2
                </Button>
                <Button
                  size="sm"
                  {...choiceButtonProps(engineId === "gateway.claude.v2")}
                  onClick={() => setEngineId("gateway.claude.v2")}
                  disabled={!canOperate}
                >
                  gateway.claude.v2
                </Button>
              </div>
              <div className="text-xs text-muted">{t("sessions.engineHint")}</div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("sessions.fields.model")}</Label>
              <LlmConfigField
                orgId={orgId}
                mode="session"
                value={llm}
                allowedProviders={
                  engineId === "gateway.codex.v2"
                    ? ["openai"]
                    : engineId === "gateway.claude.v2"
                      ? ["anthropic"]
                      : ["openai", "anthropic", "gemini"]
                }
                onChange={(next) => setLlm(next)}
                disabled={!canOperate}
              />
              <div className="text-xs text-muted">
                {engineId === "gateway.codex.v2" ? t("sessions.codexProviderHint") : t("sessions.modelHint")}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("sessions.fields.instructions")}</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} disabled={!canOperate} />
          </div>

          <div className="grid gap-2">
            <Label>{t("sessions.fields.system")}</Label>
            <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={3} disabled={!canOperate} />
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("sessions.fields.toolset")}</Label>
              <Input
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
              <Label>{t("sessions.fields.selectorTag")}</Label>
              <Input
                value={selectorTag}
                onChange={(e) => setSelectorTag(e.target.value)}
                placeholder={t("sessions.selectorTagPlaceholder")}
                disabled={!canOperate}
              />
              <div className="text-xs text-muted">{t("sessions.selectorHint")}</div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("sessions.fields.tools")}</Label>
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
              value={extraToolsRaw}
              onChange={(e) => setExtraToolsRaw(e.target.value)}
              placeholder={t("sessions.extraToolsPlaceholder")}
              disabled={!canOperate}
            />
            <div className="text-xs text-muted">{t("sessions.toolsHint", { count: toolAllow.length })}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="accent"
              disabled={!canOperate || createSession.isPending || llm.modelId.trim().length === 0 || instructions.trim().length === 0}
              onClick={async () => {
                if (!orgId) return;
                try {
                  const payload = {
                    title: title.trim(),
                    engineId,
                    ...(toolsetId.trim().length > 0 ? { toolsetId: toolsetId.trim() } : {}),
                    llm: {
                      provider:
                        engineId === "gateway.codex.v2"
                          ? "openai"
                          : engineId === "gateway.claude.v2"
                            ? "anthropic"
                            : llm.providerId === "vertex"
                              ? "openai"
                              : llm.providerId,
                      model: llm.modelId.trim(),
                    },
                    prompt: {
                      ...(system.trim().length > 0 ? { system: system.trim() } : {}),
                      instructions: instructions.trim(),
                    },
                    tools: { allow: toolAllow },
                    ...(selectorTag.trim().length > 0 ? { executorSelector: { pool: "managed", tag: selectorTag.trim() } } : {}),
                  } as const;

                  const out = await createSession.mutateAsync(payload as any);
                  const id = out.session?.id ?? null;
                  toast.success(t("sessions.create.created"));
                  if (id) {
                    router.push(`/${locale}/sessions/${id}`);
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t("common.unknownError"));
                }
              }}
            >
              {t("sessions.create.button")}
            </Button>

            {canEditOrgSettings ? (
              <Button
                variant="outline"
                disabled={!canOperate || updateSettings.isPending || llm.modelId.trim().length === 0}
                onClick={async () => {
                  if (!orgId) return;
                  const provider = llm.providerId === "vertex" ? "openai" : llm.providerId;
                  await updateSettings.mutateAsync({
                    llm: { defaults: { session: { provider, model: llm.modelId.trim() } } },
                  });
                  toast.success(t("common.saved"));
                }}
              >
                {t("sessions.saveAsOrgDefault")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessions.list.title")}</CardTitle>
          <CardDescription>{t("sessions.list.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsQuery.isLoading ? (
            <EmptyState title={t("common.loading")} />
          ) : sessions.length === 0 ? (
            <EmptyState title={t("sessions.list.empty")} />
          ) : (
            <DataTable columns={columns as any} data={sessions as AgentSession[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
