"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { getActiveOrgId } from "../../lib/org-context";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function WorkflowPage() {
  const [workflowName, setWorkflowName] = useState("Issue triage");
  const [workflowId, setWorkflowId] = useState("");
  const [runInput, setRunInput] = useState("{\"issueKey\":\"ABC-123\"}");
  const [result, setResult] = useState<unknown>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [includeGithub, setIncludeGithub] = useState(false);
  const [githubSecretId, setGithubSecretId] = useState("");
  const [githubRepo, setGithubRepo] = useState("octo/test");
  const [githubTitle, setGithubTitle] = useState("Vespid Issue");
  const [githubBody, setGithubBody] = useState("Created by Vespid workflow");

  function requiredOrgId(): string | null {
    const orgId = getActiveOrgId();
    if (!orgId) {
      setResult({ code: "ORG_CONTEXT_REQUIRED", message: "Set an active org in the header first." });
      return null;
    }
    return orgId;
  }

  async function createWorkflow() {
    const orgId = requiredOrgId();
    if (!orgId) {
      return;
    }

    if (includeGithub && githubSecretId.trim().length === 0) {
      setResult({ code: "SECRET_ID_REQUIRED", message: "Provide a GitHub secretId to include the GitHub node." });
      return;
    }

    const nodes: Array<Record<string, unknown>> = [];
    if (includeGithub) {
      nodes.push({
        id: "node-github",
        type: "connector.action",
        config: {
          connectorId: "github",
          actionId: "issue.create",
          input: {
            repo: githubRepo,
            title: githubTitle,
            body: githubBody,
          },
          auth: { secretId: githubSecretId },
        },
      });
    } else {
      nodes.push({ id: "node-http", type: "http.request" });
    }
    nodes.push({ id: "node-agent", type: "agent.execute" });

    const response = await apiFetch(
      `/v1/orgs/${orgId}/workflows`,
      {
        method: "POST",
        body: JSON.stringify({
          name: workflowName,
          dsl: {
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes,
          },
        }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();
    setResult(payload);
    const createdId = (payload as { workflow?: { id?: string } }).workflow?.id;
    if (createdId) {
      setWorkflowId(createdId);
    }
  }

  async function publishWorkflow() {
    if (!workflowId) {
      setResult({ code: "WORKFLOW_ID_REQUIRED", message: "Create or paste a workflow ID first." });
      return;
    }
    const orgId = requiredOrgId();
    if (!orgId) {
      return;
    }
    const response = await apiFetch(
      `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
      { method: "POST" },
      { orgScoped: true }
    );
    setResult(await response.json());
  }

  async function runWorkflow() {
    if (!workflowId) {
      setResult({ code: "WORKFLOW_ID_REQUIRED", message: "Create or paste a workflow ID first." });
      return;
    }
    const orgId = requiredOrgId();
    if (!orgId) {
      return;
    }

    let parsedInput: unknown = null;
    try {
      parsedInput = runInput.trim().length > 0 ? JSON.parse(runInput) : null;
    } catch {
      setResult({ code: "INVALID_JSON", message: "Run input must be valid JSON." });
      return;
    }

    const response = await apiFetch(
      `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
      {
        method: "POST",
        body: JSON.stringify({ input: parsedInput }),
      },
      { orgScoped: true }
    );
    const payload = await response.json();
    if (!response.ok) {
      const code = (payload as { code?: string }).code;
      if (code === "QUEUE_UNAVAILABLE") {
        setResult({
          code,
          message: "Workflow queue is unavailable. Please ensure Redis is running and retry.",
        });
        return;
      }
      setResult(payload);
      return;
    }

    setResult(payload);

    const runId = (payload as { run?: { id?: string } }).run?.id;
    if (!runId) {
      return;
    }

    setEvents([]);

    for (let index = 0; index < 20; index += 1) {
      await sleep(1000);
      const runResponse = await apiFetch(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
        { method: "GET" },
        { orgScoped: true }
      );
      const runPayload = await runResponse.json();
      setResult(runPayload);

      const status = (runPayload as { run?: { status?: string } }).run?.status;

      const eventsResponse = await apiFetch(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=200`,
        { method: "GET" },
        { orgScoped: true }
      );
      if (eventsResponse.ok) {
        const eventsPayload = (await eventsResponse.json()) as { events?: Array<Record<string, unknown>> };
        setEvents(eventsPayload.events ?? []);
      }

      if (status === "succeeded" || status === "failed") {
        break;
      }
    }
  }

  const eventsByAttempt = events.reduce<Record<string, Array<Record<string, unknown>>>>((acc, event) => {
    const attempt = typeof event.attemptCount === "number" ? String(event.attemptCount) : "unknown";
    acc[attempt] ??= [];
    acc[attempt].push(event);
    return acc;
  }, {});

  return (
    <main>
      <h1>Workflow</h1>

      <div className="card">
        <h2>Create</h2>
        <label htmlFor="workflow-name">Workflow name</label>
        <input
          id="workflow-name"
          value={workflowName}
          onChange={(event) => setWorkflowName(event.target.value)}
        />

        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={includeGithub}
            onChange={(event) => setIncludeGithub(event.target.checked)}
          />
          Include GitHub create-issue node
        </label>

        {includeGithub ? (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <label htmlFor="github-secret-id">GitHub secretId</label>
            <input
              id="github-secret-id"
              value={githubSecretId}
              onChange={(event) => setGithubSecretId(event.target.value)}
              placeholder="Paste secret UUID from /secrets"
            />

            <label htmlFor="github-repo">Repo (owner/repo)</label>
            <input id="github-repo" value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} />

            <label htmlFor="github-title">Issue title</label>
            <input id="github-title" value={githubTitle} onChange={(event) => setGithubTitle(event.target.value)} />

            <label htmlFor="github-body">Issue body</label>
            <textarea id="github-body" value={githubBody} onChange={(event) => setGithubBody(event.target.value)} rows={4} />
          </div>
        ) : null}

        <label htmlFor="workflow-id">Workflow ID</label>
        <input id="workflow-id" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} />

        <label htmlFor="workflow-run-input">Run input (JSON)</label>
        <textarea
          id="workflow-run-input"
          value={runInput}
          onChange={(event) => setRunInput(event.target.value)}
          rows={6}
        />

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={createWorkflow}>Create workflow</button>
          <button onClick={publishWorkflow}>Publish workflow</button>
          <button onClick={runWorkflow}>Run workflow</button>
        </div>
      </div>

      {result ? (
        <div className="card">
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="card">
          <h2>Run events</h2>
          {Object.entries(eventsByAttempt)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([attempt, items]) => (
              <div key={attempt} style={{ marginBottom: "1rem" }}>
                <strong>Attempt {attempt}</strong>
                <pre style={{ marginTop: "0.5rem" }}>{JSON.stringify(items, null, 2)}</pre>
              </div>
            ))}
        </div>
      ) : null}
    </main>
  );
}
