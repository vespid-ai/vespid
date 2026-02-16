"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { isOAuthRequiredProvider } from "@vespid/shared";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { DataTable } from "../../../../components/ui/data-table";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";
import { ModelPickerField } from "../../../../components/app/model-picker/model-picker-field";
import { LlmConfigField, type LlmConfigValue } from "../../../../components/app/llm/llm-config-field";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { type Workflow, useCreateWorkflow, useWorkflows } from "../../../../lib/hooks/use-workflows";
import { addRecentWorkflowId, getRecentWorkflowIds } from "../../../../lib/recents";

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

function defaultTeammate(index: number): TeammateForm {
  const id = `teammate-${index + 1}`;
  return {
    id,
    displayName: "",
    instructions: "Help the lead agent by completing the delegated task.",
    system: "",
    model: "gpt-4.1-mini",
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
      modelId: defaults?.modelId ?? "gpt-4.1-mini",
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

function buildDsl(params: { nodes: AgentNodeForm[]; defaultLlm: LlmConfigValue }): unknown {
  const nodes: Array<Record<string, unknown>> = params.nodes.map((node) => {
    const toolAllowPolicy: string[] = [];
    if (node.toolGithubIssueCreate) {
      toolAllowPolicy.push("connector.github.issue.create");
    }
    if (node.toolShellRun) {
      toolAllowPolicy.push("shell.run");
    }
    if (node.teamEnabled) {
      for (const teammate of node.teammates) {
        if (teammate.toolGithubIssueCreate) {
          toolAllowPolicy.push("connector.github.issue.create");
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
          "If you need to create a GitHub issue, call toolId connector.github.issue.create with input:",
          JSON.stringify(
            {
              input: { repo: node.githubRepo, title: node.githubTitle, body: node.githubBody },
            },
            null,
            2
          ),
          "Note: GitHub auth is configured on this node; do not include secret IDs in tool calls.",
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
              teammateAllow.push("connector.github.issue.create");
            }

            const teammateToolHints: string[] = [];
            if (t.toolGithubIssueCreate) {
              teammateToolHints.push(
                [
                  "If you need to create a GitHub issue, call toolId connector.github.issue.create with input:",
                  JSON.stringify(
                    {
                      input: { repo: node.githubRepo, title: node.githubTitle, body: node.githubBody },
                    },
                    null,
                    2
                  ),
                  "Note: GitHub auth is configured on this agent; do not include secret IDs in tool calls.",
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
                timeoutMs: 60_000,
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
        llm: {
          provider: effectiveLlm.providerId,
          model: effectiveLlm.modelId,
          auth: {
            ...(effectiveLlm.secretId ? { secretId: effectiveLlm.secretId } : {}),
            fallbackToEnv: true,
          },
        },
        prompt: {
          ...(node.system.trim().length > 0 ? { system: node.system } : {}),
          instructions: node.instructions,
          ...(inputTemplateEffective ? { inputTemplate: inputTemplateEffective } : {}),
        },
        tools: {
          allow: toolAllow,
          execution: node.runToolsOnNodeAgent ? "node" : "cloud",
          ...(node.githubSecretId.trim().length > 0
            ? { authDefaults: { connectors: { github: { secretId: node.githubSecretId.trim() } } } }
            : {}),
        },
        limits: {
          maxTurns: 8,
          maxToolCalls: 20,
          timeoutMs: 60_000,
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
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";

  const orgId = useActiveOrgId();
  const createWorkflow = useCreateWorkflow(orgId);
  const workflowsQuery = useWorkflows(orgId);
  const settingsQuery = useOrgSettings(orgId);

  const [workflowName, setWorkflowName] = useState("Issue triage");
  const [defaultAgentLlm, setDefaultAgentLlm] = useState<LlmConfigValue>({
    providerId: "openai",
    modelId: "gpt-4.1-mini",
    secretId: null,
  });
  const [agentNodes, setAgentNodes] = useState<AgentNodeForm[]>(() => [defaultAgentNode(0)]);

  const [recent, setRecent] = useState<string[]>([]);
  const [openWorkflowId, setOpenWorkflowId] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    setRecent(getRecentWorkflowIds());
  }, []);

  const canCreate =
    Boolean(orgId) &&
    agentNodes.length > 0 &&
    agentNodes.every((n) => {
      const needsGithub =
        n.toolGithubIssueCreate || (n.teamEnabled && n.teammates.some((t) => t.toolGithubIssueCreate));
      return !needsGithub || n.githubSecretId.trim().length > 0;
    });

  const defaultLlmInitRef = useRef(false);
  useEffect(() => {
    if (defaultLlmInitRef.current) return;
    const defaults = (settingsQuery.data?.settings?.llm?.defaults?.workflowAgentRun as any) ?? null;
    if (!defaults || typeof defaults !== "object") return;
    setDefaultAgentLlm((prev) => ({
      ...prev,
      ...(typeof defaults.provider === "string" ? { providerId: defaults.provider } : {}),
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
          <Button variant="outline" size="sm" onClick={() => openById(row.original.id)}>
            {t("workflows.list.open")}
          </Button>
        ),
      },
    ] as const;
  }, [openById, t]);

  async function submitCreate() {
    if (!orgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }

    const missingGithubSecret = agentNodes.some((n) => {
      const needsGithub =
        n.toolGithubIssueCreate || (n.teamEnabled && n.teammates.some((t) => t.toolGithubIssueCreate));
      return needsGithub && n.githubSecretId.trim().length === 0;
    });
    if (missingGithubSecret) {
      toast.error(t("workflows.errors.githubSecretRequired"));
      return;
    }

    const missingProviderSecret =
      isOAuthRequiredProvider(defaultAgentLlm.providerId) && !defaultAgentLlm.secretId
        ? true
        : agentNodes.some((n) => {
            const effective = n.llmUseDefault ? defaultAgentLlm : n.llmOverride;
            return isOAuthRequiredProvider(effective.providerId) && !effective.secretId;
          });
    if (missingProviderSecret) {
      toast.error("Selected provider requires secretId.");
      return;
    }

    const payload = await createWorkflow.mutateAsync({ name: workflowName, dsl: dslPreview });
    const id = payload.workflow.id;
    addRecentWorkflowId(id);
    setRecent(getRecentWorkflowIds());
    toast.success(t("workflows.toast.created"));
    router.push(`/${locale}/workflows/${id}`);
  }

  function openById(id: string) {
    const trimmed = id.trim();
    if (!trimmed) {
      toast.error(t("workflows.errors.workflowIdRequired"));
      return;
    }
    addRecentWorkflowId(trimmed);
    setRecent(getRecentWorkflowIds());
    router.push(`/${locale}/workflows/${trimmed}`);
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("workflows.subtitle")}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.createTitle")}</CardTitle>
            <CardDescription>{orgId ? `Org: ${orgId}` : t("workflows.createWizardHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-name">{t("workflows.fields.workflowName")}</Label>
              <Input id="workflow-name" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
            </div>

            <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
              <div className="text-sm font-medium text-text">{t("workflows.defaultAgentModel")}</div>
              <LlmConfigField orgId={orgId} mode="workflowAgentRun" value={defaultAgentLlm} onChange={setDefaultAgentLlm} />
              {isOAuthRequiredProvider(defaultAgentLlm.providerId) && !defaultAgentLlm.secretId ? (
                <div className="text-xs text-warn">Selected provider requires secretId.</div>
              ) : null}
            </div>

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
                          <LlmConfigField
                            orgId={orgId}
                            mode="workflowAgentRun"
                            value={node.llmOverride}
                            onChange={(next) =>
                              setAgentNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, llmOverride: next } : n)))
                            }
                          />
                        )}
                        {!node.llmUseDefault && isOAuthRequiredProvider(node.llmOverride.providerId) && !node.llmOverride.secretId ? (
                          <div className="text-xs text-warn">Selected provider requires secretId.</div>
                        ) : null}
                      </div>

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
                            <Label htmlFor={`github-secret-id-${node.id}`}>{t("workflows.githubSecretId")}</Label>
                            <Input
                              id={`github-secret-id-${node.id}`}
                              value={node.githubSecretId}
                              onChange={(e) =>
                                setAgentNodes((prev) =>
                                  prev.map((n) => (n.id === node.id ? { ...n, githubSecretId: e.target.value } : n))
                                )
                              }
                              placeholder={t("workflows.fields.githubSecretPlaceholder")}
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
                          <select
                            id={`agent-output-mode-${node.id}`}
                            value={node.outputMode}
                            onChange={(e) =>
                              setAgentNodes((prev) =>
                                prev.map((n) =>
                                  n.id === node.id ? { ...n, outputMode: e.target.value === "json" ? "json" : "text" } : n
                                )
                              )
                            }
                            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-text outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="text">text</option>
                            <option value="json">json</option>
                          </select>
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
                                        <select
                                          id={`teammate-output-${node.id}-${tmIdx}`}
                                          value={tm.outputMode}
                                          onChange={(e) =>
                                            setAgentNodes((prev) =>
                                              prev.map((n) =>
                                                n.id === node.id
                                                  ? {
                                                      ...n,
                                                      teammates: n.teammates.map((x) =>
                                                        x.id === tm.id ? { ...x, outputMode: e.target.value === "json" ? "json" : "text" } : x
                                                      ),
                                                    }
                                                  : n
                                              )
                                            )
                                          }
                                          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-text outline-none focus:ring-2 focus:ring-ring"
                                        >
                                          <option value="text">text</option>
                                          <option value="json">json</option>
                                        </select>
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

            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={submitCreate} disabled={!canCreate || createWorkflow.isPending}>
                {createWorkflow.isPending ? t("common.loading") : t("common.create")}
              </Button>
              <Button variant="outline" onClick={() => setShowDebug((v) => !v)}>
                {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
              </Button>
            </div>

            {showDebug ? <CodeBlock value={dslPreview} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("nav.openById")}</CardTitle>
            <CardDescription>{t("workflows.openByIdDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="open-workflow-id">{t("workflows.workflowId")}</Label>
              <Input id="open-workflow-id" value={openWorkflowId} onChange={(e) => setOpenWorkflowId(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => openById(openWorkflowId)}>
                {t("workflows.open")}
              </Button>
            </div>

            <div className="mt-2">
              <div className="text-xs font-medium text-muted">{t("workflows.recent")}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {recent.length === 0 ? <div className="text-sm text-muted">{t("workflows.noRecent")}</div> : null}
                {recent.map((id) => (
                  <Button key={id} variant="outline" onClick={() => openById(id)}>
                    {id.slice(0, 8)}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.list.title")}</CardTitle>
            <CardDescription>
              {orgId ? t("workflows.list.hint") : t("workflows.createWizardHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!orgId ? (
              <div className="text-sm text-muted">{t("workflows.errors.orgRequired")}</div>
            ) : workflowsQuery.isLoading ? (
              <div className="text-sm text-muted">{t("common.loading")}</div>
            ) : workflowsLatestByFamily.length === 0 ? (
              <div className="text-sm text-muted">{t("workflows.list.empty")}</div>
            ) : (
              <DataTable<any> data={workflowsLatestByFamily} columns={workflowTableColumns as any} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
