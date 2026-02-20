"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Textarea } from "../../../../components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { ModelPickerField } from "../../../../components/app/model-picker/model-picker-field";
import { type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { LlmCompactConfigField } from "../../../../components/app/llm/llm-compact-config-field";
import { AdvancedSection } from "../../../../components/app/advanced-section";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { QuickCreatePanel } from "../../../../components/app/quick-create-panel";
import { AdvancedConfigSheet } from "../../../../components/app/advanced-config-sheet";
import { SecretSelectField } from "../../../../components/app/secrets/secret-select-field";
import {
  type WorkflowAdvancedAction,
  type WorkflowCreateSource,
  workflowTemplatePresets,
} from "../../../../components/app/workflow-templates";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { type Workflow, useCreateWorkflow, useWorkflows } from "../../../../lib/hooks/use-workflows";
import { addRecentWorkflowId, getRecentWorkflowIds } from "../../../../lib/recents";
import { isUnauthorizedError } from "../../../../lib/api";
import { cn } from "../../../../lib/cn";

type TeammateForm = {
  id: string;
  displayName: string;
  instructions: string;
  system: string;
  model: string;

  toolGithubIssueCreate: boolean;

  outputMode: "text" | "json";
  jsonSchema: string;
};

type AgentNodeForm = {
  id: string;
  instructions: string;
  system: string;
  llmUseDefault: boolean;
  llmOverride: LlmConfigValue;

  toolGithubIssueCreate: boolean;
  toolShellRun: boolean;
  runToolsOnNodeAgent: boolean;

  teamEnabled: boolean;
  teamLeadDelegateOnly: boolean;
  teamMaxParallel: number;
  teammates: TeammateForm[];

  githubSecretId: string;
  githubRepo: string;
  githubTitle: string;
  githubBody: string;

  outputMode: "text" | "json";
  jsonSchema: string;
};

function providerIdToEngineId(providerId: string): "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2" {
  if (providerId === "anthropic") return "gateway.claude.v2";
  if (providerId === "opencode") return "gateway.opencode.v2";
  return "gateway.codex.v2";
}

function defaultTeammate(index: number): TeammateForm {
  const id = `teammate-${index + 1}`;
  return {
    id,
    displayName: "",
    instructions: "Help the lead agent by completing the delegated task.",
    system: "",
    model: "gpt-5.3-codex",
    toolGithubIssueCreate: false,
    outputMode: "text",
    jsonSchema: "",
  };
}

function defaultAgentNode(index: number, defaults?: Partial<LlmConfigValue>): AgentNodeForm {
  const id = `agent-${index + 1}`;
  return {
    id,
    instructions: "Summarize the run input and decide what to do next.",
    system: "",
    llmUseDefault: true,
    llmOverride: {
      providerId: (defaults?.providerId ?? "openai") as any,
      modelId: defaults?.modelId ?? "gpt-5.3-codex",
      secretId: defaults?.secretId ?? null,
    },
    toolGithubIssueCreate: false,
    toolShellRun: false,
    runToolsOnNodeAgent: false,
    teamEnabled: false,
    teamLeadDelegateOnly: false,
    teamMaxParallel: 3,
    teammates: [],
    githubSecretId: "",
    githubRepo: "octo/test",
    githubTitle: "Vespid Issue",
    githubBody: "Created by Vespid agent.run",
    outputMode: "text",
    jsonSchema: "",
  };
}

function teammatesFromPreset(preset: "none" | "research-triad" | "build-pipeline" | "qa-swarm"): TeammateForm[] {
  if (preset === "research-triad") {
    return [
      {
        ...defaultTeammate(0),
        id: "ux",
        instructions: "Review the UX and propose improvements as JSON.",
        outputMode: "json",
        jsonSchema:
          '{"type":"object","properties":{"summary":{"type":"string"},"issues":{"type":"array","items":{"type":"string"}}},"required":["summary","issues"],"additionalProperties":false}',
      },
      {
        ...defaultTeammate(1),
        id: "architect",
        instructions: "Review architecture and propose changes as JSON.",
        outputMode: "json",
        jsonSchema:
          '{"type":"object","properties":{"risks":{"type":"array","items":{"type":"string"}},"recommendations":{"type":"array","items":{"type":"string"}}},"required":["risks","recommendations"],"additionalProperties":false}',
      },
      {
        ...defaultTeammate(2),
        id: "devils_advocate",
        instructions: "Challenge assumptions and find failure modes as JSON.",
        outputMode: "json",
        jsonSchema:
          '{"type":"object","properties":{"concerns":{"type":"array","items":{"type":"string"}},"counterexamples":{"type":"array","items":{"type":"string"}}},"required":["concerns","counterexamples"],"additionalProperties":false}',
      },
    ];
  }

  if (preset === "build-pipeline") {
    return [
      { ...defaultTeammate(0), id: "planner", instructions: "Plan the approach and return JSON.", outputMode: "json" },
      { ...defaultTeammate(1), id: "implementer", instructions: "Implement the plan. Use tools if allowed.", outputMode: "text" },
      { ...defaultTeammate(2), id: "reviewer", instructions: "Review for correctness and risks. Return JSON.", outputMode: "json" },
    ];
  }

  if (preset === "qa-swarm") {
    return [
      { ...defaultTeammate(0), id: "tester", instructions: "Write test cases and edge cases as JSON.", outputMode: "json" },
      { ...defaultTeammate(1), id: "security", instructions: "Perform a security review and threats as JSON.", outputMode: "json" },
      { ...defaultTeammate(2), id: "perf", instructions: "Find performance risks and mitigations as JSON.", outputMode: "json" },
    ];
  }

  return [];
}

function buildDsl(params: { nodes: AgentNodeForm[]; defaultLlm: LlmConfigValue }): unknown {
  const nodes: Array<Record<string, unknown>> = params.nodes.map((node) => {
    const toolAllowPolicy: string[] = [];
    if (node.toolGithubIssueCreate) {
      toolAllowPolicy.push("connector.action");
    }
    if (node.toolShellRun) {
      toolAllowPolicy.push("shell.run");
    }
    if (node.teamEnabled) {
      toolAllowPolicy.push("team.delegate", "team.map");
      for (const teammate of node.teammates) {
        if (teammate.toolGithubIssueCreate) {
          toolAllowPolicy.push("connector.action");
        }
      }
    }
    const toolAllow = Array.from(new Set(toolAllowPolicy));

    const effectiveLlm = node.llmUseDefault ? params.defaultLlm : node.llmOverride;

    const toolHints: string[] = [];
    if (node.teamEnabled) {
      toolHints.push(
        [
          "If you need to delegate a task to a teammate, call toolId team.delegate with input:",
          JSON.stringify({ teammateId: node.teammates[0]?.id ?? "ux", task: "Review the UX", input: { focus: "onboarding" } }, null, 2),
          "To delegate multiple tasks with bounded parallelism, call toolId team.map with input:",
          JSON.stringify(
            {
              maxParallel: node.teamMaxParallel,
              tasks: (node.teammates.length > 0 ? node.teammates : [{ id: "ux" } as any]).slice(0, 3).map((t) => ({
                teammateId: t.id,
                task: "Do your part and return a structured result.",
              })),
            },
            null,
            2
          ),
          `Teammates: ${JSON.stringify(node.teammates.map((t) => t.id))}`,
        ].join("\n")
      );
    }
    if (node.toolGithubIssueCreate) {
      toolHints.push(
        [
          "If you need to create a GitHub issue, call toolId connector.action with input:",
          JSON.stringify(
            {
              connectorId: "github",
              actionId: "issue.create",
              input: { repo: node.githubRepo, title: node.githubTitle, body: node.githubBody },
            },
            null,
            2
          ),
          "Note: GitHub credentials are handled by connected integrations; do not include raw credentials in tool calls.",
        ].join("\n")
      );
    }
    if (node.toolShellRun && !node.teamLeadDelegateOnly) {
      toolHints.push(
        [
          "If you need to run a shell command, call toolId shell.run with input:",
          JSON.stringify(
            {
              script: "echo hello",
              shell: "sh",
              sandbox: { backend: "docker", network: "none" },
            },
            null,
            2
          ),
        ].join("\n")
      );
    }

    // Delegate-only lead: hide non-team tool hints to reduce accidental tool use.
    const toolHintsEffective = node.teamEnabled && node.teamLeadDelegateOnly ? toolHints.filter((h) => h.includes("team.")) : toolHints;

    const inputTemplateEffective = toolHintsEffective.length > 0 ? toolHintsEffective.join("\n\n") : undefined;

    let jsonSchemaValue: unknown | undefined;
    if (node.outputMode === "json" && node.jsonSchema.trim().length > 0) {
      try {
        jsonSchemaValue = JSON.parse(node.jsonSchema);
      } catch {
        jsonSchemaValue = undefined;
      }
    }

    const teammates =
      node.teamEnabled && node.teammates.length > 0
        ? node.teammates.map((t) => {
            const teammateAllow: string[] = [];
            if (t.toolGithubIssueCreate) {
              teammateAllow.push("connector.action");
            }

            const teammateToolHints: string[] = [];
            if (t.toolGithubIssueCreate) {
              teammateToolHints.push(
                [
                  "If you need to create a GitHub issue, call toolId connector.action with input:",
                  JSON.stringify(
                    {
                      connectorId: "github",
                      actionId: "issue.create",
                      input: { repo: node.githubRepo, title: node.githubTitle, body: node.githubBody },
                    },
                    null,
                    2
                  ),
                  "Note: GitHub credentials are handled by connected integrations; do not include raw credentials in tool calls.",
                ].join("\n")
              );
            }
            const teammateInputTemplate = teammateToolHints.length > 0 ? teammateToolHints.join("\n\n") : undefined;

            let teammateJsonSchemaValue: unknown | undefined;
            if (t.outputMode === "json" && t.jsonSchema.trim().length > 0) {
              try {
                teammateJsonSchemaValue = JSON.parse(t.jsonSchema);
              } catch {
                teammateJsonSchemaValue = undefined;
              }
            }

            return {
              id: t.id,
              ...(t.displayName.trim().length > 0 ? { displayName: t.displayName.trim() } : {}),
              ...(t.model.trim().length > 0 ? { llm: { model: t.model.trim() } } : {}),
              prompt: {
                ...(t.system.trim().length > 0 ? { system: t.system } : {}),
                instructions: t.instructions,
                ...(teammateInputTemplate ? { inputTemplate: teammateInputTemplate } : {}),
              },
              tools: {
                allow: teammateAllow,
                execution: "cloud",
                ...(node.githubSecretId.trim().length > 0
                  ? { authDefaults: { connectors: { github: { secretId: node.githubSecretId.trim() } } } }
                  : {}),
              },
              limits: {
                maxTurns: 6,
                maxToolCalls: 12,
                timeoutMs: 300_000,
                maxOutputChars: 50_000,
                maxRuntimeChars: 200_000,
              },
              output: {
                mode: t.outputMode,
                ...(teammateJsonSchemaValue !== undefined ? { jsonSchema: teammateJsonSchemaValue } : {}),
              },
            };
          })
        : undefined;

    return {
      id: node.id,
      type: "agent.run",
      config: {
        engine: {
          id: providerIdToEngineId(effectiveLlm.providerId),
          model: effectiveLlm.modelId,
          ...(effectiveLlm.secretId ? { auth: { secretId: effectiveLlm.secretId } } : {}),
        },
        execution: {
          mode: "gateway",
          selector: { pool: "byon" },
        },
        prompt: {
          ...(node.system.trim().length > 0 ? { system: node.system } : {}),
          instructions: node.instructions,
          ...(inputTemplateEffective ? { inputTemplate: inputTemplateEffective } : {}),
        },
        tools: {
          allow: toolAllow,
          execution: node.runToolsOnNodeAgent ? "executor" : "cloud",
          ...(node.githubSecretId.trim().length > 0
            ? { authDefaults: { connectors: { github: { secretId: node.githubSecretId.trim() } } } }
            : {}),
        },
        limits: {
          maxTurns: 8,
          maxToolCalls: 20,
          timeoutMs: 300_000,
          maxOutputChars: 50_000,
          maxRuntimeChars: 200_000,
        },
        output: {
          mode: node.outputMode,
          ...(jsonSchemaValue !== undefined ? { jsonSchema: jsonSchemaValue } : {}),
        },
        ...(node.teamEnabled && teammates
          ? {
              team: {
                mode: "supervisor",
                maxParallel: Math.max(1, Math.min(16, Number.isFinite(node.teamMaxParallel) ? node.teamMaxParallel : 3)),
                leadMode: node.teamLeadDelegateOnly ? "delegate_only" : "normal",
                teammates,
              },
            }
          : {}),
      },
    };
  });

  return {
    version: "v2",
    trigger: { type: "trigger.manual" },
    nodes,
  };
}

export default function WorkflowsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? (params.locale[0] ?? "en") : (params?.locale ?? "en");

  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;
  const createWorkflow = useCreateWorkflow(scopedOrgId);
  const workflowsQuery = useWorkflows(scopedOrgId);
  const settingsQuery = useOrgSettings(scopedOrgId);

  const [workflowName, setWorkflowName] = useState("Issue triage");
  const [defaultAgentLlm, setDefaultAgentLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    secretId: null,
  });
  const [agentNodes, setAgentNodes] = useState<AgentNodeForm[]>(() => [defaultAgentNode(0)]);
  const [workflowAdvancedOpen, setWorkflowAdvancedOpen] = useState(false);
  const [openByIdSheetOpen, setOpenByIdSheetOpen] = useState(false);
  const [createSource, setCreateSource] = useState<WorkflowCreateSource>("blank");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [builderFocusedPulse, setBuilderFocusedPulse] = useState(false);

  const [recent, setRecent] = useState<string[]>([]);
  const [openWorkflowId, setOpenWorkflowId] = useState("");
  const builderPulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setRecent(getRecentWorkflowIds());
  }, []);

  useEffect(() => {
    return () => {
      if (builderPulseTimeoutRef.current) {
        window.clearTimeout(builderPulseTimeoutRef.current);
      }
    };
  }, []);

  const missingGithubSecret = agentNodes.some((n) => {
    const needsGithub = n.toolGithubIssueCreate || (n.teamEnabled && n.teammates.some((t) => t.toolGithubIssueCreate));
    return needsGithub && n.githubSecretId.trim().length === 0;
  });
  const missingProviderSecret =
    isOAuthRequiredProvider(defaultAgentLlm.providerId) && !defaultAgentLlm.secretId
      ? true
      : agentNodes.some((n) => {
          const effective = n.llmUseDefault ? defaultAgentLlm : n.llmOverride;
          return isOAuthRequiredProvider(effective.providerId) && !effective.secretId;
        });
  const missingWorkflowName = workflowName.trim().length === 0;
  const createDisabledReason = !scopedOrgId
    ? t("workflows.createDisabledReasons.orgRequired")
    : missingWorkflowName
      ? t("workflows.createDisabledReasons.workflowName")
      : missingGithubSecret
        ? t("workflows.createDisabledReasons.githubSecret")
        : missingProviderSecret
          ? t("workflows.createDisabledReasons.providerSecret")
          : null;
  const canCreate = createDisabledReason === null;

  const defaultLlmInitRef = useRef(false);
  useEffect(() => {
    if (defaultLlmInitRef.current) return;
    const defaults = (settingsQuery.data?.settings?.llm?.defaults?.primary as any) ?? null;
    if (!defaults || typeof defaults !== "object") return;
    const normalizedProvider =
      typeof defaults.provider === "string" ? (defaults.provider === "openai-codex" ? "openai" : defaults.provider) : null;
    setDefaultAgentLlm((prev) => ({
      ...prev,
      ...(normalizedProvider ? { providerId: normalizedProvider as LlmConfigValue["providerId"] } : {}),
      ...(typeof defaults.model === "string" ? { modelId: defaults.model } : {}),
      ...(typeof defaults.secretId === "string" ? { secretId: defaults.secretId } : {}),
    }));
    defaultLlmInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data?.settings]);

  const dslPreview = useMemo(() => buildDsl({ nodes: agentNodes, defaultLlm: defaultAgentLlm }), [agentNodes, defaultAgentLlm]);

  const workflowsLatestByFamily = useMemo(() => {
    const rows = workflowsQuery.data?.workflows ?? [];
    const byFamily = new Map<string, Workflow>();
    for (const wf of rows) {
      const familyId = wf.familyId ?? wf.id;
      const prev = byFamily.get(familyId);
      if (!prev) {
        byFamily.set(familyId, wf);
        continue;
      }
      const a = typeof prev.revision === "number" ? prev.revision : 0;
      const b = typeof wf.revision === "number" ? wf.revision : 0;
      if (b > a) {
        byFamily.set(familyId, wf);
        continue;
      }
      if (b === a) {
        const prevUpdated = prev.updatedAt ?? "";
        const nextUpdated = wf.updatedAt ?? "";
        if (nextUpdated.localeCompare(prevUpdated) > 0) {
          byFamily.set(familyId, wf);
        }
      }
    }
    return [...byFamily.values()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [workflowsQuery.data]);

  const workflowTableColumns = useMemo(() => {
    return [
      {
        header: t("workflows.list.columns.name"),
        accessorKey: "name",
        cell: ({ row }: any) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="truncate font-mono text-xs text-muted">{row.original.id}</div>
          </div>
        ),
      },
      {
        header: t("workflows.list.columns.status"),
        accessorKey: "status",
        cell: ({ row }: any) => {
          const status = String(row.original.status ?? "");
          const variant = status === "published" ? "ok" : "neutral";
          return <Badge variant={variant as any}>{status}</Badge>;
        },
      },
      {
        header: t("workflows.list.columns.revision"),
        accessorKey: "revision",
        cell: ({ row }: any) => <span className="font-mono text-xs">{String(row.original.revision ?? "-")}</span>,
      },
      {
        header: t("workflows.list.columns.open"),
        id: "open",
        cell: ({ row }: any) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="accent" size="sm" onClick={() => openEditorById(row.original.id)}>
              {t("workflows.list.openEditor")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("workflows.actions.more")}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openById(row.original.id)}>
                  {t("workflows.list.menu.openDetails")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ] as const;
  }, [openById, openEditorById, t]);

  function focusWorkflowNameField() {
    const target = document.getElementById("workflow-name");
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus();
    target.select();
  }

  function pulseBuilderPanel() {
    if (builderPulseTimeoutRef.current) {
      window.clearTimeout(builderPulseTimeoutRef.current);
    }
    setBuilderFocusedPulse(true);
    builderPulseTimeoutRef.current = window.setTimeout(() => {
      setBuilderFocusedPulse(false);
      builderPulseTimeoutRef.current = null;
    }, 1500);
  }

  function openCreatePanel() {
    setWorkflowAdvancedOpen(false);
    pulseBuilderPanel();
    focusWorkflowNameField();
  }

  function startBlankCreate() {
    setCreateSource("blank");
    setActiveTemplateId(null);
    openCreatePanel();
  }

  function openByIdSheet(nextWorkflowId = "") {
    setOpenWorkflowId(nextWorkflowId);
    setOpenByIdSheetOpen(true);
    window.setTimeout(() => {
      const target = document.getElementById("open-workflow-id");
      if (target instanceof HTMLInputElement) {
        target.focus();
        target.select();
      }
    }, 40);
  }

  function openEditorById(id: string) {
    const trimmed = id.trim();
    if (!trimmed) {
      toast.error(t("workflows.errors.workflowIdRequired"));
      return;
    }
    addRecentWorkflowId(trimmed);
    setRecent(getRecentWorkflowIds());
    router.push(`/${locale}/workflows/${trimmed}/graph`);
  }

  async function runAdvancedAction(action: WorkflowAdvancedAction) {
    if (action === "open-by-id") {
      openByIdSheet();
      return;
    }

    if (action === "open-recent") {
      const latest = recent[0];
      if (!latest) {
        toast.error(t("workflows.noRecent"));
        return;
      }
      openEditorById(latest);
      return;
    }

    let pasted = "";
    try {
      pasted = (await navigator.clipboard.readText()).trim();
    } catch {
      pasted = "";
    }
    openByIdSheet(pasted);
  }

  function applyTemplate(templateId: string) {
    const preset = workflowTemplatePresets.find((item) => item.id === templateId);
    if (!preset) {
      return;
    }

    const nextDefaultLlm: LlmConfigValue = {
      providerId: (preset.defaultLlm?.providerId ?? defaultAgentLlm.providerId) as any,
      modelId: preset.defaultLlm?.modelId ?? defaultAgentLlm.modelId,
      secretId: defaultAgentLlm.secretId,
    };
    const teammates = teammatesFromPreset(preset.primaryNode.teamPreset).map((tm) =>
      preset.primaryNode.toolGithubIssueCreate && tm.id === "implementer" ? { ...tm, toolGithubIssueCreate: true } : tm
    );

    const baseNode = defaultAgentNode(0, nextDefaultLlm);
    const nextNode: AgentNodeForm = {
      ...baseNode,
      instructions: preset.primaryNode.instructions,
      toolGithubIssueCreate: preset.primaryNode.toolGithubIssueCreate,
      toolShellRun: preset.primaryNode.toolShellRun,
      runToolsOnNodeAgent: preset.primaryNode.runToolsOnNodeAgent,
      teamEnabled: teammates.length > 0,
      teamLeadDelegateOnly: teammates.length > 0,
      teammates,
    };

    setWorkflowName(preset.workflowName);
    setDefaultAgentLlm(nextDefaultLlm);
    setAgentNodes([nextNode]);
    setActiveTemplateId(preset.id);
    setCreateSource("template");
    openCreatePanel();
    toast.success(t("workflows.templates.applied"));
  }

  async function submitCreate(source: WorkflowCreateSource = createSource) {
    if (!scopedOrgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }
    if (missingGithubSecret) {
      toast.error(t("workflows.errors.githubSecretRequired"));
      return;
    }
    if (missingProviderSecret) {
      toast.error(t("workflows.createDisabledReasons.providerSecret"));
      return;
    }

    try {
      const payload = await createWorkflow.mutateAsync({ name: workflowName, dsl: dslPreview });
      const id = payload.workflow.id;
      addRecentWorkflowId(id);
      setRecent(getRecentWorkflowIds());
      toast.success(t("workflows.toast.created"));
      setCreateSource("blank");
      setActiveTemplateId(null);
      router.push(`/${locale}/workflows/${id}/graph?source=${source === "template" ? "template" : "create"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  function openById(id: string) {
    const trimmed = id.trim();
    if (!trimmed) {
      toast.error(t("workflows.errors.workflowIdRequired"));
      return;
    }
    addRecentWorkflowId(trimmed);
    setRecent(getRecentWorkflowIds());
    setOpenByIdSheetOpen(false);
    router.push(`/${locale}/workflows/${trimmed}`);
  }

  const primaryNode = agentNodes[0] ?? null;

  function setPrimaryNodeInstructions(value: string) {
    setAgentNodes((prev) => {
      if (prev.length === 0) {
        return [{ ...defaultAgentNode(0, defaultAgentLlm), instructions: value }];
      }
      return prev.map((node, idx) => (idx === 0 ? { ...node, instructions: value } : node));
    });
  }

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void workflowsQuery.refetch();
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
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <EmptyState
          title={t("workflows.errors.orgRequired")}
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
    (workflowsQuery.isError && isUnauthorizedError(workflowsQuery.error)) ||
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void workflowsQuery.refetch();
            void settingsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <MoreHorizontal className="h-4 w-4" />
              {t("workflows.actions.more")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void runAdvancedAction("open-by-id")}>
              {t("workflows.actions.openById")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void runAdvancedAction("open-recent")}>
              {t("workflows.actions.openRecent")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void runAdvancedAction("paste-workflow-id")}>
              {t("workflows.actions.pasteWorkflowId")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4">
        <div data-testid="workflow-builder-panel" data-pulse={builderFocusedPulse ? "on" : "off"}>
        <QuickCreatePanel
          className={cn(
            "transition-[box-shadow,border-color] duration-300",
            builderFocusedPulse ? "border-accent/60 shadow-[0_0_0_1px_var(--color-accent)]" : ""
          )}
          title={t("workflows.builderTitle")}
          actions={<div className="text-xs text-muted">{t("workflows.nodesConfigured", { count: agentNodes.length })}</div>}
          contentClassName="gap-3"
        >
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-name">{t("workflows.fields.workflowName")}</Label>
              <Input id="workflow-name" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
            </div>

            <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
              <div className="text-sm font-medium text-text">{t("workflows.defaultAgentModel")}</div>
              <LlmCompactConfigField
                orgId={scopedOrgId}
                mode="primary"
                value={defaultAgentLlm}
                onChange={setDefaultAgentLlm}
                advancedSectionId="workflow-default-llm-advanced"
                testId="workflow-default-llm-compact"
              />
            </div>

            <div className="grid gap-2 rounded-lg border border-borderSubtle bg-panel/70 p-3">
              <Label htmlFor="workflow-primary-instructions">{t("workflows.quickInstructions")}</Label>
              <Textarea
                id="workflow-primary-instructions"
                rows={4}
                value={primaryNode?.instructions ?? ""}
                onChange={(e) => setPrimaryNodeInstructions(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => void submitCreate()} disabled={!canCreate || createWorkflow.isPending}>
                {createWorkflow.isPending ? t("common.loading") : t("common.create")}
              </Button>
              <Button variant="outline" onClick={() => setWorkflowAdvancedOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" />
                {t("workflows.customizeAdvanced")}
              </Button>
              {activeTemplateId ? (
                <Badge variant="neutral">{t("workflows.templates.appliedTag")}</Badge>
              ) : null}
            </div>
            {createDisabledReason ? <div className="text-xs text-warn">{createDisabledReason}</div> : null}

            <AdvancedConfigSheet
              open={workflowAdvancedOpen}
              onOpenChange={setWorkflowAdvancedOpen}
              title={t("workflows.advancedTitle")}
              footer={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setWorkflowAdvancedOpen(false)}>
                    {t("common.close")}
                  </Button>
                </div>
              }
            >

            <div className="grid gap-3 rounded-lg border border-border bg-panel/50 p-3">
              <div className="text-sm font-medium text-text">{t("workflows.agentNodes")}</div>

              <div className="grid gap-3">
                {agentNodes.map((node, idx) => {
                  const canRemove = agentNodes.length > 1;
                  return (
                    <div key={node.id} className="grid gap-3 rounded-lg border border-border bg-panel/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-text">
                          {idx + 1}. {node.id}
                        </div>
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={idx === 0}
                            onClick={() => {
                              setAgentNodes((prev) => {
                                const next = [...prev];
                                const a = next[idx - 1];
                                const b = next[idx];
                                if (!a || !b) {
                                  return prev;
                                }
                                next[idx - 1] = b;
                                next[idx] = a;
                                return next;
                              });
                            }}
                          >
                            {t("workflows.up")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={idx === agentNodes.length - 1}
                            onClick={() => {
                              setAgentNodes((prev) => {
                                const next = [...prev];
                                const a = next[idx];
                                const b = next[idx + 1];
                                if (!a || !b) {
                                  return prev;
                                }
                                next[idx] = b;
                                next[idx + 1] = a;
                                return next;
                              });
                            }}
                          >
                            {t("workflows.down")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!canRemove}
                            onClick={() => setAgentNodes((prev) => prev.filter((n) => n.id !== node.id))}
                          >
                            {t("workflows.remove")}
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <Label htmlFor={`agent-instructions-${node.id}`}>{t("workflows.instructions")}</Label>
                        <Textarea
                          id={`agent-instructions-${node.id}`}
                          value={node.instructions}
                          onChange={(e) =>
                            setAgentNodes((prev) =>
                              prev.map((n) => (n.id === node.id ? { ...n, instructions: e.target.value } : n))
                            )
                          }
                          rows={4}
                        />
                      </div>

                      <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium text-text">{t("workflows.model")}</div>
                          <label className="flex items-center gap-2 text-sm text-muted">
                            <input
                              type="checkbox"
                              checked={node.llmUseDefault}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) => (n.id === node.id ? { ...n, llmUseDefault: e.target.checked } : n))
                                )
                              }
                            />
                            {t("workflows.useDefaultModel")}
                          </label>
                        </div>
                        {node.llmUseDefault ? (
                          <div className="text-xs text-muted">
                            {t("workflows.usingDefaultModel", { provider: defaultAgentLlm.providerId, model: defaultAgentLlm.modelId })}
                          </div>
                        ) : (
                          <LlmCompactConfigField
                            orgId={scopedOrgId}
                            mode="workflowAgentRun"
                            value={node.llmOverride}
                            onChange={(next) =>
                              setAgentNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, llmOverride: next } : n)))
                            }
                            advancedSectionId={`workflow-node-llm-advanced-${node.id}`}
                            testId={`workflow-node-llm-compact-${node.id}`}
                          />
                        )}
                      </div>

                      <AdvancedSection
                        id={`workflow-node-advanced-${node.id}`}
                        title={t("advanced.title")}
                        description={t("advanced.description")}
                        labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
                      >
                        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                          <div className="text-sm font-medium text-text">{t("workflows.tools")}</div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={node.toolGithubIssueCreate}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) =>
                                    n.id === node.id ? { ...n, toolGithubIssueCreate: e.target.checked } : n
                                  )
                                )
                              }
                            />
                            {t("workflows.githubIssueCreate")}
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={node.toolShellRun}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) =>
                                    n.id === node.id ? { ...n, toolShellRun: e.target.checked } : n
                                  )
                                )
                              }
                            />
                            {t("workflows.shellRun")}
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={node.runToolsOnNodeAgent}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) => (n.id === node.id ? { ...n, runToolsOnNodeAgent: e.target.checked } : n))
                                )
                              }
                            />
                            {t("workflows.runToolsOnNodeAgent")}
                          </label>
                        </div>

                        {node.toolGithubIssueCreate ? (
                          <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                            <div className="text-sm font-medium text-text">{t("workflows.githubDefaults")}</div>
                            <div className="grid gap-1.5">
                              <Label>{t("workflows.githubSecretId")}</Label>
                              <SecretSelectField
                                orgId={scopedOrgId}
                                connectorId="github"
                                value={node.githubSecretId || null}
                                onChange={(next) =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) => (n.id === node.id ? { ...n, githubSecretId: next ?? "" } : n))
                                  )
                                }
                                required
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor={`github-repo-${node.id}`}>{t("workflows.repo")}</Label>
                              <Input
                                id={`github-repo-${node.id}`}
                                value={node.githubRepo}
                                onChange={(e) =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) => (n.id === node.id ? { ...n, githubRepo: e.target.value } : n))
                                  )
                                }
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor={`github-title-${node.id}`}>{t("workflows.issueTitle")}</Label>
                              <Input
                                id={`github-title-${node.id}`}
                                value={node.githubTitle}
                                onChange={(e) =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) => (n.id === node.id ? { ...n, githubTitle: e.target.value } : n))
                                  )
                                }
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor={`github-body-${node.id}`}>{t("workflows.issueBody")}</Label>
                              <Textarea
                                id={`github-body-${node.id}`}
                                value={node.githubBody}
                                onChange={(e) =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) => (n.id === node.id ? { ...n, githubBody: e.target.value } : n))
                                  )
                                }
                                rows={3}
                              />
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label htmlFor={`agent-output-mode-${node.id}`}>{t("workflows.outputMode")}</Label>
                            <Select
                              value={node.outputMode}
                              onValueChange={(value) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) => (n.id === node.id ? { ...n, outputMode: value === "json" ? "json" : "text" } : n))
                                )
                              }
                            >
                              <SelectTrigger id={`agent-output-mode-${node.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">text</SelectItem>
                                <SelectItem value="json">json</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {node.outputMode === "json" ? (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`agent-json-schema-${node.id}`}>{t("workflows.jsonSchema")}</Label>
                              <Textarea
                                id={`agent-json-schema-${node.id}`}
                                value={node.jsonSchema}
                                onChange={(e) =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) => (n.id === node.id ? { ...n, jsonSchema: e.target.value } : n))
                                  )
                                }
                                rows={4}
                                placeholder='{"type":"object","properties":{}}'
                              />
                            </div>
                          ) : null}
                        </div>

                        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-text">{t("workflows.teamTitle")}</div>
                          <label className="ml-auto flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={node.teamEnabled}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) =>
                                    n.id === node.id
                                      ? {
                                          ...n,
                                          teamEnabled: e.target.checked,
                                          teammates: e.target.checked && n.teammates.length === 0 ? [defaultTeammate(0)] : n.teammates,
                                        }
                                      : n
                                  )
                                )
                              }
                            />
                            {t("workflows.teamEnable")}
                          </label>
                        </div>

                        {node.teamEnabled ? (
                          <div className="grid gap-3">
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={node.teamLeadDelegateOnly}
                                  onChange={(e) =>
                                    setAgentNodes((prev) =>
                                      prev.map((n) => (n.id === node.id ? { ...n, teamLeadDelegateOnly: e.target.checked } : n))
                                    )
                                  }
                                />
                                {t("workflows.teamLeadDelegateOnly")}
                              </label>
                              <div className="grid gap-1.5">
                                <Label htmlFor={`team-max-parallel-${node.id}`}>{t("workflows.teamMaxParallel")}</Label>
                                <Input
                                  id={`team-max-parallel-${node.id}`}
                                  value={String(node.teamMaxParallel)}
                                  onChange={(e) => {
                                    const v = Number.parseInt(e.target.value, 10);
                                    setAgentNodes((prev) =>
                                      prev.map((n) =>
                                        n.id === node.id ? { ...n, teamMaxParallel: Number.isFinite(v) ? v : 3 } : n
                                      )
                                    );
                                  }}
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === node.id
                                        ? {
                                            ...n,
                                            teamEnabled: true,
                                            teamLeadDelegateOnly: true,
                                            teammates: [
                                              {
                                                ...defaultTeammate(0),
                                                id: "ux",
                                                instructions: "Review the UX and propose improvements as JSON.",
                                                outputMode: "json",
                                                jsonSchema:
                                                  '{"type":"object","properties":{"summary":{"type":"string"},"issues":{"type":"array","items":{"type":"string"}}},"required":["summary","issues"],"additionalProperties":false}',
                                              },
                                              {
                                                ...defaultTeammate(1),
                                                id: "architect",
                                                instructions: "Review architecture and propose changes as JSON.",
                                                outputMode: "json",
                                                jsonSchema:
                                                  '{"type":"object","properties":{"risks":{"type":"array","items":{"type":"string"}},"recommendations":{"type":"array","items":{"type":"string"}}},"required":["risks","recommendations"],"additionalProperties":false}',
                                              },
                                              {
                                                ...defaultTeammate(2),
                                                id: "devils_advocate",
                                                instructions: "Challenge assumptions and find failure modes as JSON.",
                                                outputMode: "json",
                                                jsonSchema:
                                                  '{"type":"object","properties":{"concerns":{"type":"array","items":{"type":"string"}},"counterexamples":{"type":"array","items":{"type":"string"}}},"required":["concerns","counterexamples"],"additionalProperties":false}',
                                              },
                                            ],
                                          }
                                        : n
                                    )
                                  )
                                }
                              >
                                {t("workflows.teamTemplateResearchTriad")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === node.id
                                        ? {
                                            ...n,
                                            teamEnabled: true,
                                            teamLeadDelegateOnly: true,
                                            teammates: [
                                              { ...defaultTeammate(0), id: "planner", instructions: "Plan the approach and return JSON.", outputMode: "json" },
                                              { ...defaultTeammate(1), id: "implementer", instructions: "Implement the plan. Use tools if allowed.", outputMode: "text", toolGithubIssueCreate: n.toolGithubIssueCreate },
                                              { ...defaultTeammate(2), id: "reviewer", instructions: "Review for correctness and risks. Return JSON.", outputMode: "json" },
                                            ],
                                          }
                                        : n
                                    )
                                  )
                                }
                              >
                                {t("workflows.teamTemplateBuildPipeline")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAgentNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === node.id
                                        ? {
                                            ...n,
                                            teamEnabled: true,
                                            teamLeadDelegateOnly: true,
                                            teammates: [
                                              { ...defaultTeammate(0), id: "tester", instructions: "Write test cases and edge cases as JSON.", outputMode: "json" },
                                              { ...defaultTeammate(1), id: "security", instructions: "Perform a security review and threats as JSON.", outputMode: "json" },
                                              { ...defaultTeammate(2), id: "perf", instructions: "Find performance risks and mitigations as JSON.", outputMode: "json" },
                                            ],
                                          }
                                        : n
                                    )
                                  )
                                }
                              >
                                {t("workflows.teamTemplateQaSwarm")}
                              </Button>
                            </div>

                            <div className="grid gap-3">
                              {node.teammates.map((tm, tmIdx) => {
                                const canRemoveTeammate = node.teammates.length > 1;
                                return (
                                  <div key={`${node.id}:${tm.id}`} className="grid gap-3 rounded-lg border border-border bg-panel/60 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="text-sm font-medium text-text">
                                        {tmIdx + 1}. {tm.id}
                                      </div>
                                      <div className="ml-auto flex flex-wrap gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={tmIdx === 0}
                                          onClick={() =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) => {
                                                if (n.id !== node.id) {
                                                  return n;
                                                }
                                                const next = [...n.teammates];
                                                const a = next[tmIdx - 1];
                                                const b = next[tmIdx];
                                                if (!a || !b) {
                                                  return n;
                                                }
                                                next[tmIdx - 1] = b;
                                                next[tmIdx] = a;
                                                return { ...n, teammates: next };
                                              })
                                            )
                                          }
                                        >
                                          {t("workflows.up")}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={tmIdx === node.teammates.length - 1}
                                          onClick={() =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) => {
                                                if (n.id !== node.id) {
                                                  return n;
                                                }
                                                const next = [...n.teammates];
                                                const a = next[tmIdx];
                                                const b = next[tmIdx + 1];
                                                if (!a || !b) {
                                                  return n;
                                                }
                                                next[tmIdx] = b;
                                                next[tmIdx + 1] = a;
                                                return { ...n, teammates: next };
                                              })
                                            )
                                          }
                                        >
                                          {t("workflows.down")}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="danger"
                                          disabled={!canRemoveTeammate}
                                          onClick={() =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id ? { ...n, teammates: n.teammates.filter((x) => x.id !== tm.id) } : n
                                              )
                                            )
                                          }
                                        >
                                          {t("workflows.remove")}
                                        </Button>
                                      </div>
                                    </div>

                                    <div className="grid gap-2 md:grid-cols-2">
                                      <div className="grid gap-1.5">
                                        <Label htmlFor={`teammate-id-${node.id}-${tmIdx}`}>{t("workflows.teammateId")}</Label>
                                        <Input
                                          id={`teammate-id-${node.id}-${tmIdx}`}
                                          value={tm.id}
                                          onChange={(e) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? {
                                                      ...n,
                                                      teammates: n.teammates.map((x) => (x.id === tm.id ? { ...x, id: e.target.value } : x)),
                                                    }
                                                  : n
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="grid gap-1.5">
                                        <Label htmlFor={`teammate-name-${node.id}-${tmIdx}`}>{t("workflows.teammateDisplayName")}</Label>
                                        <Input
                                          id={`teammate-name-${node.id}-${tmIdx}`}
                                          value={tm.displayName}
                                          onChange={(e) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? {
                                                      ...n,
                                                      teammates: n.teammates.map((x) => (x.id === tm.id ? { ...x, displayName: e.target.value } : x)),
                                                    }
                                                  : n
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                    </div>

                                    <div className="grid gap-1.5">
                                      <Label htmlFor={`teammate-instructions-${node.id}-${tmIdx}`}>{t("workflows.instructions")}</Label>
                                      <Textarea
                                        id={`teammate-instructions-${node.id}-${tmIdx}`}
                                        value={tm.instructions}
                                        onChange={(e) =>
                                          setAgentNodes((prev) =>
                                            prev.map((n) =>
                                              n.id === node.id
                                                ? {
                                                    ...n,
                                                    teammates: n.teammates.map((x) => (x.id === tm.id ? { ...x, instructions: e.target.value } : x)),
                                                  }
                                                : n
                                            )
                                          )
                                        }
                                        rows={3}
                                      />
                                    </div>

                                    <div className="grid gap-2 md:grid-cols-2">
                                      <div className="grid gap-1.5">
                                        <Label htmlFor={`teammate-model-${node.id}-${tmIdx}`}>{t("workflows.model")}</Label>
                                        <ModelPickerField
                                          value={tm.model}
                                          allowClear
                                          emptyLabel={t("llm.compact.inheritModel")}
                                          testId={`workflow-teammate-model-${node.id}-${tmIdx}`}
                                          onChange={(next) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? { ...n, teammates: n.teammates.map((x) => (x.id === tm.id ? { ...x, model: next } : x)) }
                                                  : n
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="grid gap-1.5">
                                        <Label htmlFor={`teammate-output-${node.id}-${tmIdx}`}>{t("workflows.outputMode")}</Label>
                                        <Select
                                          value={tm.outputMode}
                                          onValueChange={(value) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? {
                                                      ...n,
                                                      teammates: n.teammates.map((x) =>
                                                        x.id === tm.id ? { ...x, outputMode: value === "json" ? "json" : "text" } : x
                                                      ),
                                                    }
                                                  : n
                                              )
                                            )
                                          }
                                        >
                                          <SelectTrigger id={`teammate-output-${node.id}-${tmIdx}`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="text">text</SelectItem>
                                            <SelectItem value="json">json</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>

                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={tm.toolGithubIssueCreate}
                                        onChange={(e) =>
                                          setAgentNodes((prev) =>
                                            prev.map((n) =>
                                              n.id === node.id
                                                ? {
                                                    ...n,
                                                    teammates: n.teammates.map((x) =>
                                                      x.id === tm.id ? { ...x, toolGithubIssueCreate: e.target.checked } : x
                                                    ),
                                                  }
                                                : n
                                            )
                                          )
                                        }
                                      />
                                      {t("workflows.githubIssueCreate")}
                                    </label>

                                    {tm.outputMode === "json" ? (
                                      <div className="grid gap-1.5">
                                        <Label htmlFor={`teammate-schema-${node.id}-${tmIdx}`}>{t("workflows.jsonSchema")}</Label>
                                        <Textarea
                                          id={`teammate-schema-${node.id}-${tmIdx}`}
                                          value={tm.jsonSchema}
                                          onChange={(e) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? {
                                                      ...n,
                                                      teammates: n.teammates.map((x) => (x.id === tm.id ? { ...x, jsonSchema: e.target.value } : x)),
                                                    }
                                                  : n
                                              )
                                            )
                                          }
                                          rows={4}
                                          placeholder='{"type":"object","properties":{}}'
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setAgentNodes((prev) =>
                                      prev.map((n) =>
                                        n.id === node.id ? { ...n, teammates: [...n.teammates, defaultTeammate(n.teammates.length)] } : n
                                      )
                                    )
                                  }
                                  disabled={node.teammates.length >= 12}
                                >
                                  {t("workflows.addTeammate")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        </div>
                      </AdvancedSection>
                    </div>
                  );
                })}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAgentNodes((prev) => [...prev, defaultAgentNode(prev.length, defaultAgentLlm)])}
                    disabled={agentNodes.length >= 10}
                  >
                    {t("workflows.addAgentNode")}
                  </Button>
                </div>
              </div>
            </div>
            </AdvancedConfigSheet>
        </QuickCreatePanel>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.templates.title")}</CardTitle>
            <CardDescription>{t("workflows.templates.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workflowTemplatePresets.map((preset) => {
              const selected = activeTemplateId === preset.id;
              return (
                <div key={preset.id} className="grid gap-3 rounded-lg border border-borderSubtle bg-panel/45 p-3">
                  <div>
                    <div className="font-medium text-text">{t(`workflows.templates.${preset.id}.name`)}</div>
                    <div className="mt-1 text-sm text-muted">{t(`workflows.templates.${preset.id}.description`)}</div>
                  </div>
                  <Button variant={selected ? "accent" : "outline"} onClick={() => applyTemplate(preset.id)}>
                    {selected ? t("workflows.templates.appliedTag") : t("workflows.templates.useTemplate")}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.list.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {!orgId ? (
              <EmptyState title={t("workflows.errors.orgRequired")} />
            ) : workflowsQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : workflowsLatestByFamily.length === 0 ? (
              <EmptyState
                title={t("workflows.list.empty")}
                action={
                  <Button variant="accent" onClick={startBlankCreate}>
                    {t("workflows.empty.createActionLabel")}
                  </Button>
                }
              />
            ) : (
              <DataTable<any> data={workflowsLatestByFamily} columns={workflowTableColumns as any} />
            )}
          </CardContent>
        </Card>

        <AdvancedConfigSheet
          open={openByIdSheetOpen}
          onOpenChange={setOpenByIdSheetOpen}
          title={t("workflows.actions.openById")}
          description={t("workflows.openByIdDescription")}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setOpenByIdSheetOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          }
        >
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="open-workflow-id">{t("workflows.workflowId")}</Label>
              <Input id="open-workflow-id" value={openWorkflowId} onChange={(e) => setOpenWorkflowId(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => openById(openWorkflowId)}>
                {t("workflows.open")}
              </Button>
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted">{t("workflows.recent")}</div>
              <div className="flex flex-wrap gap-2">
                {recent.length === 0 ? <div className="text-sm text-muted">{t("workflows.noRecent")}</div> : null}
                {recent.map((id) => (
                  <Button key={id} variant="outline" onClick={() => openEditorById(id)}>
                    {id.slice(0, 8)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </AdvancedConfigSheet>
      </div>
    </div>
  );
}
