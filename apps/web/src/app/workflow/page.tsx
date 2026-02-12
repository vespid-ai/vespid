"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { getActiveOrgId } from "../../lib/org-context";

export default function WorkflowPage() {
  const [workflowName, setWorkflowName] = useState("Issue triage");
  const [workflowId, setWorkflowId] = useState("");
  const [runInput, setRunInput] = useState("{\"issueKey\":\"ABC-123\"}");
  const [result, setResult] = useState<unknown>(null);

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

    const response = await apiFetch(
      `/v1/orgs/${orgId}/workflows`,
      {
        method: "POST",
        body: JSON.stringify({
          name: workflowName,
          dsl: {
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes: [
              { id: "node-http", type: "http.request" },
              { id: "node-agent", type: "agent.execute" },
            ],
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
    setResult(await response.json());
  }

  return (
    <main>
      <h1>Workflow</h1>

      <div className="card">
        <label htmlFor="workflow-name">Workflow name</label>
        <input
          id="workflow-name"
          value={workflowName}
          onChange={(event) => setWorkflowName(event.target.value)}
        />

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
    </main>
  );
}
