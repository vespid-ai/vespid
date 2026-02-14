export type WorkflowTemplateId = "github-issue-triage" | "http-to-agent" | "agent-shell";

export type WorkflowTemplate = {
  id: WorkflowTemplateId;
  name: string;
  description: string;
  defaults: {
    includeGithub: boolean;
    runOnNodeAgent: boolean;
    agentScript: string;
    agentUseDocker: boolean;
    agentAllowNetwork: boolean;
    githubRepo: string;
    githubTitle: string;
    githubBody: string;
  };
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "github-issue-triage",
    name: "GitHub issue triage",
    description: "Create an issue, then run an agent step.",
    defaults: {
      includeGithub: true,
      runOnNodeAgent: false,
      agentScript: "echo triage",
      agentUseDocker: true,
      agentAllowNetwork: false,
      githubRepo: "octo/test",
      githubTitle: "Vespid Issue",
      githubBody: "Created by Vespid workflow",
    },
  },
  {
    id: "http-to-agent",
    name: "HTTP + agent.execute",
    description: "Start with an HTTP request node, then execute an agent task.",
    defaults: {
      includeGithub: false,
      runOnNodeAgent: false,
      agentScript: "echo hello from agent",
      agentUseDocker: true,
      agentAllowNetwork: false,
      githubRepo: "",
      githubTitle: "",
      githubBody: "",
    },
  },
  {
    id: "agent-shell",
    name: "Agent shell runner",
    description: "A minimal workflow that runs a shell script.",
    defaults: {
      includeGithub: false,
      runOnNodeAgent: true,
      agentScript: "node -v && echo done",
      agentUseDocker: true,
      agentAllowNetwork: false,
      githubRepo: "",
      githubTitle: "",
      githubBody: "",
    },
  },
];
