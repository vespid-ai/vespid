"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useCreateWorkflow } from "../../../../lib/hooks/use-workflows";
import { addRecentWorkflowId, getRecentWorkflowIds } from "../../../../lib/recents";

type AgentNodeForm = {
  id: string;
  instructions: string;
  system: string;
  model: string;
  llmSecretId: string;

  toolGithubIssueCreate: boolean;
  toolShellRun: boolean;
  runToolsOnNodeAgent: boolean;

  githubSecretId: string;
  githubRepo: string;
  githubTitle: string;
  githubBody: string;

  outputMode: "text" | "json";
  jsonSchema: string;
};

function defaultAgentNode(index: number): AgentNodeForm {
  const id = `agent-${index + 1}`;
  return {
    id,
    instructions: "Summarize the run input and decide what to do next.",
    system: "",
    model: "gpt-4.1-mini",
    llmSecretId: "",
    toolGithubIssueCreate: false,
    toolShellRun: false,
    runToolsOnNodeAgent: false,
    githubSecretId: "",
    githubRepo: "octo/test",
    githubTitle: "Vespid Issue",
    githubBody: "Created by Vespid agent.run",
    outputMode: "text",
    jsonSchema: "",
  };
}

function buildDsl(params: { nodes: AgentNodeForm[] }): unknown {
  const nodes: Array<Record<string, unknown>> = params.nodes.map((node) => {
    const toolAllow: string[] = [];
    if (node.toolGithubIssueCreate) {
      toolAllow.push("connector.github.issue.create");
    }
    if (node.toolShellRun) {
      toolAllow.push("shell.run");
    }

    const toolHints: string[] = [];
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
    if (node.toolShellRun) {
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

    const inputTemplate = toolHints.length > 0 ? toolHints.join("\n\n") : undefined;

    let jsonSchemaValue: unknown | undefined;
    if (node.outputMode === "json" && node.jsonSchema.trim().length > 0) {
      try {
        jsonSchemaValue = JSON.parse(node.jsonSchema);
      } catch {
        jsonSchemaValue = undefined;
      }
    }

    return {
      id: node.id,
      type: "agent.run",
      config: {
        llm: {
          provider: "openai",
          model: node.model,
          auth: {
            ...(node.llmSecretId.trim().length > 0 ? { secretId: node.llmSecretId.trim() } : {}),
            fallbackToEnv: true,
          },
        },
        prompt: {
          ...(node.system.trim().length > 0 ? { system: node.system } : {}),
          instructions: node.instructions,
          ...(inputTemplate ? { inputTemplate } : {}),
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

  const [workflowName, setWorkflowName] = useState("Issue triage");
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
    agentNodes.every((n) => !n.toolGithubIssueCreate || n.githubSecretId.trim().length > 0);

  const dslPreview = useMemo(() => buildDsl({ nodes: agentNodes }), [agentNodes]);

  async function submitCreate() {
    if (!orgId) {
      toast.error(t("workflows.errors.orgRequired"));
      return;
    }

    const missingGithubSecret = agentNodes.some((n) => n.toolGithubIssueCreate && n.githubSecretId.trim().length === 0);
    if (missingGithubSecret) {
      toast.error(t("workflows.errors.githubSecretRequired"));
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

                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor={`agent-model-${node.id}`}>{t("workflows.model")}</Label>
                          <Input
                            id={`agent-model-${node.id}`}
                            value={node.model}
                            onChange={(e) =>
                              setAgentNodes((prev) =>
                                prev.map((n) => (n.id === node.id ? { ...n, model: e.target.value } : n))
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`agent-llm-secret-${node.id}`}>{t("workflows.llmSecretId")}</Label>
                          <Input
                            id={`agent-llm-secret-${node.id}`}
                            value={node.llmSecretId}
                            onChange={(e) =>
                              setAgentNodes((prev) =>
                                prev.map((n) => (n.id === node.id ? { ...n, llmSecretId: e.target.value } : n))
                              )
                            }
                            placeholder='Create a secret with connectorId="llm.openai"'
                          />
                        </div>
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
                                  n.id === node.id ? { ...n, toolGithubIssueCreate: e.target.checked || n.toolShellRun } : n
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
                                  n.id === node.id ? { ...n, toolShellRun: e.target.checked || n.toolGithubIssueCreate } : n
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
                          <Input
                            id={`agent-output-mode-${node.id}`}
                            value={node.outputMode}
                            onChange={(e) =>
                              setAgentNodes((prev) =>
                                prev.map((n) =>
                                  n.id === node.id ? { ...n, outputMode: e.target.value === "json" ? "json" : "text" } : n
                                )
                              )
                            }
                            placeholder="text | json"
                          />
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
                    </div>
                  );
                })}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAgentNodes((prev) => [...prev, defaultAgentNode(prev.length)])}
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
      </div>
    </div>
  );
}
