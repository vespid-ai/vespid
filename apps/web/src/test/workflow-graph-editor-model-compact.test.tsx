import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { WorkflowGraphEditor } from "../components/app/workflow-graph-editor";

const mocks = vi.hoisted(() => {
  const workflowResponse = {
    data: {
      workflow: {
        id: "wf_1",
        name: "Workflow 1",
        status: "draft",
        dsl: {
          version: "v3",
          graph: {
            nodes: {
              root: { id: "root", type: "http.request", config: {} },
            },
            edges: [],
          },
        },
        editorState: null,
      },
    },
    isLoading: false,
  };
  return {
    workflowResponse,
    updateDraftMutate: vi.fn(async () => ({})),
  };
});

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({ children, onInit }: { children?: React.ReactNode; onInit?: (instance: { setViewport: () => void }) => void }) => {
      React.useEffect(() => {
        onInit?.({ setViewport: () => {} });
      }, []);
      return <div data-testid="mock-react-flow">{children}</div>;
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, () => {}] as const;
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, () => {}] as const;
    },
  };
});

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => ({
    data: {
      settings: {
        llm: {
          defaults: {
            primary: {
              provider: "openai",
              model: "gpt-5.3-codex",
              secretId: null,
            },
          },
        },
      },
    },
  }),
}));

vi.mock("../lib/hooks/use-secrets", () => ({
  useSecrets: () => ({
    data: { secrets: [] },
  }),
}));

vi.mock("../lib/hooks/use-workflows", () => ({
  useWorkflow: () => mocks.workflowResponse,
  useUpdateWorkflowDraft: () => ({
    mutateAsync: mocks.updateDraftMutate,
    isPending: false,
  }),
}));

describe("WorkflowGraphEditor model compact config", () => {
  it("uses compact config in bulk section and agent.run node editor", async () => {
    const user = userEvent.setup();
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf8")) as Record<string, unknown>;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowGraphEditor workflowId="wf_1" locale="en" variant="full" />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByTestId("workflow-graph-bulk-agent-llm-compact")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "agent.run" }));
    expect(screen.getAllByTestId(/workflow-graph-node-llm-compact-/).length).toBeGreaterThan(0);
  });
});
