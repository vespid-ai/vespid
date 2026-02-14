"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Wand2 } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { CodeBlock } from "../../../../components/ui/code-block";
import { Chip } from "../../../../components/ui/chip";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";
import { Separator } from "../../../../components/ui/separator";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useCreateWorkflow } from "../../../../lib/hooks/use-workflows";
import { addRecentWorkflowId, getRecentWorkflowIds } from "../../../../lib/recents";
import { workflowTemplates, type WorkflowTemplateId } from "../../../../components/app/workflow-templates";

type StepId = "basic" | "integrations" | "execution" | "review";

function buildDsl(params: {
  includeGithub: boolean;
  runOnNodeAgent: boolean;
  agentScript: string;
  agentUseDocker: boolean;
  agentAllowNetwork: boolean;
  githubSecretId: string;
  githubRepo: string;
  githubTitle: string;
  githubBody: string;
}): unknown {
  const nodes: Array<Record<string, unknown>> = [];

  if (params.includeGithub) {
    nodes.push({
      id: "node-github",
      type: "connector.action",
      config: {
        connectorId: "github",
        actionId: "issue.create",
        input: {
          repo: params.githubRepo,
          title: params.githubTitle,
          body: params.githubBody,
        },
        auth: { secretId: params.githubSecretId },
        execution: { mode: params.runOnNodeAgent ? "node" : "cloud" },
      },
    });
  } else {
    nodes.push({ id: "node-http", type: "http.request" });
  }

  nodes.push({
    id: "node-agent",
    type: "agent.execute",
    config: {
      execution: { mode: params.runOnNodeAgent ? "node" : "cloud" },
      task: { type: "shell", script: params.agentScript, shell: "sh" },
      sandbox: {
        ...(params.runOnNodeAgent ? { backend: params.agentUseDocker ? "docker" : "host" } : {}),
        ...(params.runOnNodeAgent ? { network: params.agentAllowNetwork ? "enabled" : "none" } : {}),
      },
    },
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

  const [recent, setRecent] = useState<string[]>([]);
  const [openWorkflowId, setOpenWorkflowId] = useState("");

  const [step, setStep] = useState<StepId>("basic");
  const [templateId, setTemplateId] = useState<WorkflowTemplateId>("github-issue-triage");

  const template = useMemo(() => workflowTemplates.find((t) => t.id === templateId)!, [templateId]);

  const [workflowName, setWorkflowName] = useState("Issue triage");

  const [includeGithub, setIncludeGithub] = useState(template.defaults.includeGithub);
  const [runOnNodeAgent, setRunOnNodeAgent] = useState(template.defaults.runOnNodeAgent);
  const [agentScript, setAgentScript] = useState(template.defaults.agentScript);
  const [agentUseDocker, setAgentUseDocker] = useState(template.defaults.agentUseDocker);
  const [agentAllowNetwork, setAgentAllowNetwork] = useState(template.defaults.agentAllowNetwork);

  const [githubSecretId, setGithubSecretId] = useState("");
  const [githubRepo, setGithubRepo] = useState(template.defaults.githubRepo);
  const [githubTitle, setGithubTitle] = useState(template.defaults.githubTitle);
  const [githubBody, setGithubBody] = useState(template.defaults.githubBody);

  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    setRecent(getRecentWorkflowIds());
  }, []);

  useEffect(() => {
    setIncludeGithub(template.defaults.includeGithub);
    setRunOnNodeAgent(template.defaults.runOnNodeAgent);
    setAgentScript(template.defaults.agentScript);
    setAgentUseDocker(template.defaults.agentUseDocker);
    setAgentAllowNetwork(template.defaults.agentAllowNetwork);
    setGithubRepo(template.defaults.githubRepo);
    setGithubTitle(template.defaults.githubTitle);
    setGithubBody(template.defaults.githubBody);
  }, [template]);

  const dslPreview = useMemo(
    () =>
      buildDsl({
        includeGithub,
        runOnNodeAgent,
        agentScript,
        agentUseDocker,
        agentAllowNetwork,
        githubSecretId,
        githubRepo,
        githubTitle,
        githubBody,
      }),
    [
      agentAllowNetwork,
      agentScript,
      agentUseDocker,
      githubBody,
      githubRepo,
      githubSecretId,
      githubTitle,
      includeGithub,
      runOnNodeAgent,
    ]
  );

  const canCreate = Boolean(orgId) && (!includeGithub || githubSecretId.trim().length > 0);

  async function submitCreate() {
    if (!orgId) {
      toast.error("Set an active org first.");
      return;
    }

    if (includeGithub && githubSecretId.trim().length === 0) {
      toast.error("Provide a GitHub secretId to include the GitHub node.");
      return;
    }

    const payload = await createWorkflow.mutateAsync({ name: workflowName, dsl: dslPreview });
    const id = payload.workflow.id;
    addRecentWorkflowId(id);
    setRecent(getRecentWorkflowIds());
    toast.success("Workflow created");
    router.push(`/${locale}/workflows/${id}`);
  }

  function openById(id: string) {
    const trimmed = id.trim();
    if (!trimmed) {
      toast.error("Workflow ID required");
      return;
    }
    addRecentWorkflowId(trimmed);
    setRecent(getRecentWorkflowIds());
    router.push(`/${locale}/workflows/${trimmed}`);
  }

  const steps: Array<{ id: StepId; label: string }> = [
    { id: "basic", label: "Basic" },
    { id: "integrations", label: "Integrations" },
    { id: "execution", label: "Execution" },
    { id: "review", label: "Review" },
  ];

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
        <div className="mt-1 text-sm text-muted">
          Fluent-style SaaS shell + agent cockpit. Start from a template, then refine.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Card className="overflow-hidden">
            <div className="border-b border-border bg-panel/50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-muted" />
                    <div className="font-[var(--font-display)] text-lg font-semibold tracking-tight">Create workflow</div>
                  </div>
                  <div className="mt-1 text-sm text-muted">{orgId ? `Org: ${orgId}` : "Set an active org to create workflows."}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowDebug((v) => !v)}>
                    {t("common.debug")}: {showDebug ? t("common.hide") : t("common.show")}
                  </Button>
                  <Button variant="accent" size="sm" onClick={submitCreate} disabled={!canCreate || createWorkflow.isPending}>
                    {createWorkflow.isPending ? t("common.loading") : t("common.create")}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {steps.map((s) => (
                  <Chip key={s.id} active={s.id === step} onClick={() => setStep(s.id)}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            </div>

            <CardContent className="grid gap-4 p-5">
              {step === "basic" ? (
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="workflow-name">Workflow name</Label>
                    <Input id="workflow-name" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
                  </div>

                  <div>
                    <div className="text-sm font-medium text-text">Templates</div>
                    <div className="mt-2 grid gap-2">
                      {workflowTemplates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setTemplateId(tpl.id)}
                          className={
                            tpl.id === templateId
                              ? "rounded-[var(--radius-md)] border border-accent/40 bg-accent/5 p-3 text-left"
                              : "rounded-[var(--radius-md)] border border-border bg-panel/40 p-3 text-left hover:bg-panel/70"
                          }
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{tpl.name}</div>
                            <ChevronRight className="h-4 w-4 text-muted" />
                          </div>
                          <div className="mt-1 text-sm text-muted">{tpl.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {step === "integrations" ? (
                <div className="grid gap-3">
                  <div className="rounded-[var(--radius-md)] border border-border bg-panel/40 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={includeGithub} onChange={(e) => setIncludeGithub(e.target.checked)} />
                      Include GitHub create-issue node
                    </label>
                  </div>

                  {includeGithub ? (
                    <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-panel/40 p-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="github-secret-id">GitHub secretId</Label>
                        <Input
                          id="github-secret-id"
                          value={githubSecretId}
                          onChange={(e) => setGithubSecretId(e.target.value)}
                          placeholder="Paste secret UUID from /secrets"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="github-repo">Repo (owner/repo)</Label>
                        <Input id="github-repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="github-title">Issue title</Label>
                        <Input id="github-title" value={githubTitle} onChange={(e) => setGithubTitle(e.target.value)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="github-body">Issue body</Label>
                        <Textarea id="github-body" value={githubBody} onChange={(e) => setGithubBody(e.target.value)} rows={4} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === "execution" ? (
                <div className="grid gap-3">
                  <div className="rounded-[var(--radius-md)] border border-border bg-panel/40 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={runOnNodeAgent} onChange={(e) => setRunOnNodeAgent(e.target.checked)} />
                      Run nodes on node-agent (remote)
                    </label>
                  </div>

                  <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-panel/40 p-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="agent-script">Agent script (sh)</Label>
                      <Textarea id="agent-script" value={agentScript} onChange={(e) => setAgentScript(e.target.value)} rows={4} />
                    </div>

                    {runOnNodeAgent ? (
                      <div className="grid gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={agentUseDocker} onChange={(e) => setAgentUseDocker(e.target.checked)} />
                          Use docker sandbox
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={agentAllowNetwork} onChange={(e) => setAgentAllowNetwork(e.target.checked)} />
                          Allow network
                        </label>
                      </div>
                    ) : (
                      <div className="text-sm text-muted">Cloud execution uses server-side sandbox defaults.</div>
                    )}
                  </div>
                </div>
              ) : null}

              {step === "review" ? (
                <div className="grid gap-3">
                  <div className="rounded-[var(--radius-md)] border border-border bg-panel/40 p-3">
                    <div className="text-sm font-medium text-text">Preview</div>
                    <div className="mt-1 text-sm text-muted">This is the DSL v2 payload that will be saved.</div>
                  </div>
                  <CodeBlock value={dslPreview} />
                </div>
              ) : null}

              {showDebug && step !== "review" ? (
                <div className="grid gap-2">
                  <Separator />
                  <CodeBlock value={dslPreview} />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("nav.openById")}</CardTitle>
              <CardDescription>Open an existing workflow by ID, or jump to a recent one (stored locally).</CardDescription>
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

              <Separator />

              <div>
                <div className="text-xs font-medium text-muted">{t("workflows.recent")}</div>
                <div className="mt-2 grid gap-2">
                  {recent.length === 0 ? <div className="text-sm text-muted">No recent workflows.</div> : null}
                  {recent.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openById(id)}
                      className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-panel/40 px-3 py-2 text-left text-sm hover:bg-panel/70"
                    >
                      <span className="font-mono text-xs text-muted">{id}</span>
                      <ChevronRight className="h-4 w-4 text-muted" />
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tips</CardTitle>
              <CardDescription>Make the cockpit feel fast.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              Use compact density for runs, and switch to dark theme for long debugging sessions.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
