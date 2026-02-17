export type WorkflowCreateSource = "blank" | "template";
export type WorkflowAdvancedAction = "open-by-id" | "open-recent" | "paste-workflow-id";
export type WorkflowTemplateId = "github-issue-triage" | "http-to-agent" | "agent-shell";

export type WorkflowTemplatePreset = {
  id: WorkflowTemplateId;
  workflowName: string;
  defaultLlm?: {
    providerId?: string;
    modelId?: string;
  };
  primaryNode: {
    instructions: string;
    toolGithubIssueCreate: boolean;
    toolShellRun: boolean;
    runToolsOnNodeAgent: boolean;
    teamPreset: "none" | "research-triad" | "build-pipeline" | "qa-swarm";
  };
};

export const workflowTemplatePresets: WorkflowTemplatePreset[] = [
  {
    id: "github-issue-triage",
    workflowName: "Issue triage",
    defaultLlm: { providerId: "openai", modelId: "gpt-5.3-codex" },
    primaryNode: {
      instructions: "Summarize incoming issue context, decide ownership, and draft the next operational action.",
      toolGithubIssueCreate: true,
      toolShellRun: false,
      runToolsOnNodeAgent: false,
      teamPreset: "none",
    },
  },
  {
    id: "http-to-agent",
    workflowName: "Intake normalization",
    defaultLlm: { providerId: "openai", modelId: "gpt-5.3-codex" },
    primaryNode: {
      instructions: "Normalize inbound payloads and produce a structured handoff for downstream automation.",
      toolGithubIssueCreate: false,
      toolShellRun: false,
      runToolsOnNodeAgent: false,
      teamPreset: "research-triad",
    },
  },
  {
    id: "agent-shell",
    workflowName: "Agent shell runner",
    defaultLlm: { providerId: "openai", modelId: "gpt-5.3-codex" },
    primaryNode: {
      instructions: "Execute shell diagnostics, summarize output, and recommend safe follow-up actions.",
      toolGithubIssueCreate: false,
      toolShellRun: true,
      runToolsOnNodeAgent: true,
      teamPreset: "build-pipeline",
    },
  },
];
