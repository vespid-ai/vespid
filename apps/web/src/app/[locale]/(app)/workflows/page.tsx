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

  const [workflowName, setWorkflowName] = useState("Issue triage");
  const [openWorkflowId, setOpenWorkflowId] = useState("");

  const [includeGithub, setIncludeGithub] = useState(false);
  const [runOnNodeAgent, setRunOnNodeAgent] = useState(false);
  const [agentScript, setAgentScript] = useState("echo hello");
  const [agentUseDocker, setAgentUseDocker] = useState(true);
  const [agentAllowNetwork, setAgentAllowNetwork] = useState(false);

  const [githubSecretId, setGithubSecretId] = useState("");
  const [githubRepo, setGithubRepo] = useState("octo/test");
  const [githubTitle, setGithubTitle] = useState("Vespid Issue");
  const [githubBody, setGithubBody] = useState("Created by Vespid workflow");

  const [recent, setRecent] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    setRecent(getRecentWorkflowIds());
  }, []);

  const canCreate = Boolean(orgId) && (!includeGithub || githubSecretId.trim().length > 0);

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

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("workflows.title")}</div>
        <div className="mt-1 text-sm text-muted">Create, publish, and run workflows. Workflows listing is local-first for now.</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("workflows.createTitle")}</CardTitle>
            <CardDescription>{orgId ? `Org: ${orgId}` : "Set an active org in the sidebar to create workflows."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-name">Workflow name</Label>
              <Input id="workflow-name" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
            </div>

            <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeGithub} onChange={(e) => setIncludeGithub(e.target.checked)} />
                Include GitHub create-issue node
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={runOnNodeAgent} onChange={(e) => setRunOnNodeAgent(e.target.checked)} />
                Run nodes on node-agent (remote)
              </label>
            </div>

            {runOnNodeAgent ? (
              <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="agent-script">Agent script (sh)</Label>
                  <Textarea id="agent-script" value={agentScript} onChange={(e) => setAgentScript(e.target.value)} rows={4} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={agentUseDocker} onChange={(e) => setAgentUseDocker(e.target.checked)} />
                  Use docker sandbox (agent.execute)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={agentAllowNetwork} onChange={(e) => setAgentAllowNetwork(e.target.checked)} />
                  Allow network (agent.execute)
                </label>
              </div>
            ) : null}

            {includeGithub ? (
              <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
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
            <CardDescription>Because the API does not yet expose list endpoints, we track recent IDs locally.</CardDescription>
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
                {recent.length === 0 ? <div className="text-sm text-muted">No recent workflows.</div> : null}
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
