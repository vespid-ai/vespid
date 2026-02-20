import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { WorkflowGraphEditor } from "../components/app/workflow-graph-editor";

const mocks = vi.hoisted(() => {
  const workflowResponse = {
    data: {
      workflow: {
        id: "wf_graph",
        name: "Graph workflow",
        status: "draft",
        dsl: {
          version: "v3",
          graph: {
            nodes: {
              n1: { id: "n1", type: "http.request", config: {} },
              n2: { id: "n2", type: "http.request", config: {} },
              n3: { id: "n3", type: "http.request", config: {} },
            },
            edges: [
              { id: "e1", from: "n1", to: "n2", kind: "always" },
              { id: "e2", from: "n1", to: "n3", kind: "always" },
            ],
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
    fitView: vi.fn(),
    requestFullscreenSpy: vi.fn(),
    exitFullscreenSpy: vi.fn(),
  };
});

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({ children, onInit, onNodeClick, onPaneClick, nodes }: any) => {
      React.useEffect(() => {
        onInit?.({
          setViewport: () => {},
          getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
          fitView: mocks.fitView,
          setCenter: () => {},
        });
      }, []);
      return (
        <div data-testid="mock-react-flow">
          <button type="button" data-testid="mock-node-click" onClick={() => (nodes?.[0] ? onNodeClick?.({}, nodes[0]) : undefined)}>
            node click
          </button>
          <button type="button" data-testid="mock-pane-click" onClick={() => onPaneClick?.({})}>
            pane click
          </button>
          <div data-testid="mock-node-positions">
            {(nodes ?? []).map((node: any) => `${node.id}:${Math.round(node.position?.x ?? 0)},${Math.round(node.position?.y ?? 0)}`).join("|")}
          </div>
          {children}
        </div>
      );
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

describe("WorkflowGraphEditor layout controls", () => {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let fullscreenElement: Element | null;

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    fullscreenElement = null;

    mocks.fitView.mockReset();
    mocks.requestFullscreenSpy.mockReset();
    mocks.exitFullscreenSpy.mockReset();

    mocks.requestFullscreenSpy.mockImplementation(async function (this: Element) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    mocks.exitFullscreenSpy.mockImplementation(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: function requestFullscreen(this: Element) {
        return mocks.requestFullscreenSpy.call(this);
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => mocks.exitFullscreenSpy(),
    });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.localStorage.clear();
  });

  function renderEditor() {
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf8")) as Record<string, unknown>;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowGraphEditor workflowId="wf_graph" locale="en" variant="full" />
      </NextIntlClientProvider>
    );
  }

  it("starts collapsed and auto toggles with node/pane interactions", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByTestId("workflow-graph-right-panel")).toHaveAttribute("data-state", "collapsed");

    await user.click(screen.getByTestId("mock-node-click"));
    expect(screen.getByTestId("workflow-graph-right-panel")).toHaveAttribute("data-state", "expanded");

    await user.click(screen.getByTestId("mock-pane-click"));
    expect(screen.getByTestId("workflow-graph-right-panel")).toHaveAttribute("data-state", "collapsed");
  });

  it("applies auto layout and runs fitView", async () => {
    const user = userEvent.setup();
    renderEditor();

    const before = screen.getByTestId("mock-node-positions").textContent;
    await user.click(screen.getByTestId("workflow-graph-auto-layout"));

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalled();
    });

    const after = screen.getByTestId("mock-node-positions").textContent;
    expect(after).not.toEqual(before);
  });

  it("toggles browser fullscreen mode", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByTestId("workflow-graph-fullscreen-toggle"));
    expect(mocks.requestFullscreenSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("workflow-graph-right-panel")).toHaveAttribute("data-state", "collapsed");

    await user.click(screen.getByTestId("workflow-graph-fullscreen-toggle"));
    expect(mocks.exitFullscreenSpy).toHaveBeenCalledTimes(1);
  });
});
