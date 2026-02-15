"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  upgradeV2ToV3,
  validateV3GraphConstraints,
  workflowDslV3Schema,
  type WorkflowDsl as WorkflowDslV2,
  type WorkflowDslV3,
} from "@vespid/workflow";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { CodeBlock } from "../ui/code-block";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useActiveOrgId } from "../../lib/hooks/use-active-org-id";
import { useUpdateWorkflowDraft, useWorkflow } from "../../lib/hooks/use-workflows";

type EdgeKind = "always" | "cond_true" | "cond_false";

type WorkflowNodeAny = {
  id: string;
  type: string;
  config?: unknown;
};

type EditorState = {
  nodes?: Array<{ id: string; position: { x: number; y: number } }>;
  viewport?: { x: number; y: number; zoom: number };
};

type GraphValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

type WorkflowGraphEditorProps = {
  workflowId: string;
  locale: string;
  variant?: "embedded" | "full";
};

function normalizeIssues(maybeIssues: unknown): GraphValidationIssue[] {
  if (!Array.isArray(maybeIssues)) {
    return [];
  }
  return maybeIssues
    .filter((it) => it && typeof it === "object" && !Array.isArray(it))
    .map((it: any) => ({
      code: typeof it.code === "string" ? it.code : "VALIDATION_ERROR",
      message: typeof it.message === "string" ? it.message : "Validation error",
      nodeId: typeof it.nodeId === "string" ? it.nodeId : undefined,
      edgeId: typeof it.edgeId === "string" ? it.edgeId : undefined,
    }));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseEditorState(input: unknown): EditorState | null {
  const obj = asObject(input);
  if (!obj) {
    return null;
  }
  const nodesRaw = obj["nodes"];
  const viewportRaw = obj["viewport"];
  const state: EditorState = {};
  if (Array.isArray(nodesRaw)) {
    state.nodes = nodesRaw
      .map((n) => asObject(n))
      .filter(Boolean)
      .map((n) => {
        const id = typeof n!.id === "string" ? n!.id : "";
        const pos = asObject(n!.position);
        const x = typeof pos?.x === "number" ? pos.x : 0;
        const y = typeof pos?.y === "number" ? pos.y : 0;
        return { id, position: { x, y } };
      })
      .filter((n) => n.id.length > 0);
  }
  const viewportObj = asObject(viewportRaw);
  if (viewportObj) {
    const x = typeof viewportObj.x === "number" ? viewportObj.x : 0;
    const y = typeof viewportObj.y === "number" ? viewportObj.y : 0;
    const zoom = typeof viewportObj.zoom === "number" ? viewportObj.zoom : 1;
    state.viewport = { x, y, zoom };
  }
  return state;
}

function defaultPosition(index: number) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 60 + col * 260, y: 60 + row * 140 };
}

function toFlowNodes(input: { dsl: WorkflowDslV3; editorState: EditorState | null }): Node[] {
  const positions = new Map<string, { x: number; y: number }>();
  for (const item of input.editorState?.nodes ?? []) {
    positions.set(item.id, item.position);
  }
  return Object.entries(input.dsl.graph.nodes).map(([id, node], index) => ({
    id,
    position: positions.get(id) ?? defaultPosition(index),
    data: {
      label: node.type,
      node,
    },
  }));
}

function toFlowEdges(input: { dsl: WorkflowDslV3 }): Edge[] {
  return input.dsl.graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.kind ?? "always",
    data: { kind: e.kind ?? "always" },
    animated: false,
  }));
}

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function WorkflowGraphEditor({ workflowId, locale, variant = "full" }: WorkflowGraphEditorProps) {
  const orgId = useActiveOrgId() ?? null;
  const workflowQuery = useWorkflow(orgId, workflowId);
  const updateDraft = useUpdateWorkflowDraft(orgId, workflowId);

  const [instance, setInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>("");
  const [configJson, setConfigJson] = useState<string>("{}");
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("always");
  const [nameDraft, setNameDraft] = useState<string>("");
  const [issues, setIssues] = useState<GraphValidationIssue[]>([]);

  const issueNodeIds = useMemo(
    () => new Set(issues.map((i) => i.nodeId).filter((v): v is string => typeof v === "string" && v.length > 0)),
    [issues]
  );
  const issueEdgeIds = useMemo(
    () => new Set(issues.map((i) => i.edgeId).filter((v): v is string => typeof v === "string" && v.length > 0)),
    [issues]
  );

  const loaded = workflowQuery.data?.workflow ?? null;
  const dslAny = loaded?.dsl as any;

  const parsedEditorState = useMemo(() => parseEditorState(loaded?.editorState), [loaded?.editorState]);

  const v3Dsl: WorkflowDslV3 | null = useMemo(() => {
    if (!dslAny || typeof dslAny !== "object") {
      return null;
    }
    if (dslAny.version === "v3") {
      return dslAny as WorkflowDslV3;
    }
    if (dslAny.version === "v2") {
      return upgradeV2ToV3(dslAny as WorkflowDslV2) as any;
    }
    return null;
  }, [dslAny]);

  const initialNodes = useMemo(() => (v3Dsl ? toFlowNodes({ dsl: v3Dsl, editorState: parsedEditorState }) : []), [v3Dsl, parsedEditorState]);
  const initialEdges = useMemo(() => (v3Dsl ? toFlowEdges({ dsl: v3Dsl }) : []), [v3Dsl]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const decoratedNodes = useMemo<Node[]>(() => {
    return nodes.map((n) => {
      const hasIssue = issueNodeIds.has(n.id);
      const selected = selectedNodeId === n.id;
      const style = { ...(n.style ?? {}) } as any;
      if (hasIssue) {
        style.border = "2px solid rgba(239, 68, 68, 0.95)";
        style.boxShadow = "0 0 0 3px rgba(239, 68, 68, 0.14)";
      }
      if (selected) {
        style.border = "2px solid rgba(59, 130, 246, 0.95)";
        style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.18)";
      }
      return { ...n, style } as Node;
    });
  }, [nodes, issueNodeIds, selectedNodeId]);

  const decoratedEdges = useMemo<Edge[]>(() => {
    return edges.map((e) => {
      const hasIssue = issueEdgeIds.has(e.id);
      const selected = selectedEdgeId === e.id;
      const style = { ...(e.style ?? {}) } as any;
      if (hasIssue) {
        style.stroke = "rgba(239, 68, 68, 0.95)";
        style.strokeWidth = 3;
      }
      if (selected) {
        style.stroke = "rgba(59, 130, 246, 0.95)";
        style.strokeWidth = 3;
      }
      return { ...e, style } as Edge;
    });
  }, [edges, issueEdgeIds, selectedEdgeId]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    setNameDraft(loaded.name ?? "");
  }, [loaded]);

  useEffect(() => {
    // When a workflow loads/changes, reset the graph state.
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNodeId("");
    setSelectedEdgeId("");
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    const node = nodes.find((n) => n.id === selectedNodeId) as any;
    const cfg = node?.data?.node?.config ?? null;
    setConfigJson(JSON.stringify(cfg ?? {}, null, 2));
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    const edge = edges.find((e) => e.id === selectedEdgeId) as any;
    const kind = (edge?.data?.kind ?? "always") as any;
    if (kind === "cond_true" || kind === "cond_false" || kind === "always") {
      setEdgeKind(kind);
    }
  }, [selectedEdgeId, edges]);

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    const id = `e:${connection.source}->${connection.target}:${Date.now()}`;
    setEdges((eds) =>
      addEdge(
        {
          id,
          source: connection.source!,
          target: connection.target!,
          label: "always",
          data: { kind: "always" },
        },
        eds
      )
    );
  };

  function addNode(type: WorkflowNodeAny["type"]) {
    const id = `${type.replaceAll(".", "_")}-${Math.floor(Math.random() * 100000)}`;
    const node: WorkflowNodeAny = { id, type };
    const position = defaultPosition(nodes.length);
    setNodes((ns) => [
      ...ns,
      {
        id,
        position,
        data: { label: type, node },
      },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId("");
  }

  async function saveSelectedNodeConfig() {
    if (!selectedNodeId) {
      return;
    }
    const parsed = safeJsonParse(configJson);
    if (!parsed.ok) {
      toast.error("Invalid JSON config");
      return;
    }
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== selectedNodeId) {
          return n;
        }
        const current = (n as any).data?.node as WorkflowNodeAny;
        const next: WorkflowNodeAny = { ...current, config: parsed.value };
        return { ...n, data: { ...(n as any).data, node: next } };
      })
    );
    toast.success("Node config updated");
  }

  async function saveEdgeKind() {
    if (!selectedEdgeId) {
      return;
    }
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id !== selectedEdgeId) {
          return e;
        }
        return { ...e, label: edgeKind, data: { ...(e.data as any), kind: edgeKind } };
      })
    );
    toast.success("Edge updated");
  }

  function focusIssue(issue: GraphValidationIssue | null) {
    if (!issue) {
      return;
    }
    if (issue.nodeId) {
      setSelectedNodeId(issue.nodeId);
      setSelectedEdgeId("");
      const hit = nodes.find((n) => n.id === issue.nodeId);
      if (hit && instance) {
        instance.setCenter(hit.position.x, hit.position.y, { zoom: 1.2, duration: 250 });
      }
      return;
    }
    if (issue.edgeId) {
      setSelectedEdgeId(issue.edgeId);
      setSelectedNodeId("");
    }
  }

  function buildDraftDsl() {
    const nodesRecord: Record<string, unknown> = {};
    for (const n of nodes as any[]) {
      const node = n?.data?.node as WorkflowNodeAny | undefined;
      if (!node || typeof node.id !== "string" || node.id.length === 0) {
        continue;
      }
      nodesRecord[node.id] = node;
    }
    const edgesList: Array<{ id: string; from: string; to: string; kind?: EdgeKind }> = edges.map((e) => {
      const raw = ((e.data as any)?.kind ?? "always") as unknown;
      const kind: EdgeKind = raw === "cond_true" || raw === "cond_false" || raw === "always" ? raw : "always";
      return { id: e.id, from: e.source, to: e.target, kind };
    });

    const dsl: WorkflowDslV3 = {
      version: "v3",
      trigger: (v3Dsl?.trigger ?? { type: "trigger.manual" }) as any,
      // The server validates and persists the canonical DSL via @vespid/workflow schemas.
      graph: { nodes: nodesRecord as any, edges: edgesList },
    };

    const editorState: EditorState = {
      nodes: nodes.map((n) => ({ id: n.id, position: n.position })),
      ...(instance ? { viewport: instance.getViewport() } : {}),
    };

    return { dsl, edgesList, editorState };
  }

  function validateClient(input: { dsl: WorkflowDslV3; edgesList: Array<{ id: string }> }): GraphValidationIssue[] {
    const parsed = workflowDslV3Schema.safeParse(input.dsl);
    if (!parsed.success) {
      return parsed.error.issues.map((issue) => {
        const path = issue.path.join(".");
        let nodeId: string | undefined;
        let edgeId: string | undefined;

        if (issue.path.length >= 3 && issue.path[0] === "graph" && issue.path[1] === "nodes" && typeof issue.path[2] === "string") {
          nodeId = issue.path[2];
        }
        if (issue.path.length >= 3 && issue.path[0] === "graph" && issue.path[1] === "edges" && typeof issue.path[2] === "number") {
          edgeId = input.edgesList[issue.path[2]]?.id;
        }

        return {
          code: "INVALID_DSL",
          message: `${issue.message}${path ? ` (${path})` : ""}`,
          ...(nodeId ? { nodeId } : {}),
          ...(edgeId ? { edgeId } : {}),
        };
      });
    }

    const constraints = validateV3GraphConstraints(parsed.data);
    if (constraints.ok) {
      return [];
    }
    const payload = (constraints as any).issues ?? [{ code: constraints.code, message: constraints.message }];
    return normalizeIssues(payload);
  }

  async function saveWorkflow() {
    if (!orgId) {
      toast.error("Organization is required");
      return;
    }
    if (!workflowId) {
      toast.error("Workflow is required");
      return;
    }
    if (!loaded) {
      toast.error("Workflow is not loaded");
      return;
    }
    if (loaded.status !== "draft") {
      toast.error("Only drafts can be edited");
      return;
    }

    const { dsl, edgesList, editorState } = buildDraftDsl();
    const localIssues = validateClient({ dsl, edgesList });
    if (localIssues.length) {
      setIssues(localIssues);
      toast.error("Fix validation errors before saving.");
      focusIssue(localIssues[0] ?? null);
      return;
    }

    try {
      setIssues([]);
      await updateDraft.mutateAsync({
        ...(nameDraft.trim().length > 0 ? { name: nameDraft.trim() } : {}),
        dsl,
        editorState,
      });
      toast.success("Saved");
    } catch (err: any) {
      const code = err?.payload?.code;
      const maybeIssues = err?.payload?.details?.issues;
      const serverIssues = normalizeIssues(maybeIssues);
      if (serverIssues.length) {
        setIssues(serverIssues);
      }

      if (typeof code === "string") {
        toast.error(`${code}: ${err?.payload?.message ?? "Validation error"}`);
        focusIssue(serverIssues[0] ?? null);
        return;
      }

      throw err;
    }
  }

  const isEmbedded = variant === "embedded";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-[var(--font-display)] text-2xl font-semibold tracking-tight">
            {isEmbedded ? "Editor" : "Workflow Graph Editor"}
          </div>
          <div className="mt-1 text-sm text-muted break-all">{workflowId}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isEmbedded ? (
            <Button asChild variant="outline">
              <Link href={`/${locale}/workflows/${workflowId}/graph`}>Open full screen</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href={`/${locale}/workflows/${workflowId}`}>Back</Link>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const { dsl, edgesList } = buildDraftDsl();
              const localIssues = validateClient({ dsl, edgesList });
              setIssues(localIssues);
              if (localIssues.length) {
                toast.error(`Validation failed (${localIssues.length})`);
                focusIssue(localIssues[0] ?? null);
                return;
              }
              toast.success("No validation issues found");
            }}
            disabled={workflowQuery.isLoading}
          >
            Validate
          </Button>
          <Button variant="accent" onClick={saveWorkflow} disabled={updateDraft.isPending || workflowQuery.isLoading}>
            {updateDraft.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {!orgId ? (
        <Card>
          <CardHeader>
            <CardTitle>Organization Required</CardTitle>
            <CardDescription>Select an organization first.</CardDescription>
          </CardHeader>
        </Card>
      ) : workflowQuery.isLoading ? (
        <div className="text-sm text-muted">Loading...</div>
      ) : !loaded ? (
        <div className="text-sm text-muted">Workflow not found.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <Card className="min-h-[640px] overflow-hidden">
            <CardHeader>
              <CardTitle>Graph</CardTitle>
              <CardDescription>
                DSL: <span className="font-mono text-xs">{String((loaded.dsl as any)?.version ?? "unknown")}</span> | Status:{" "}
                <span className="font-mono text-xs">{loaded.status}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[560px]">
              <ReactFlow
                nodes={decoratedNodes}
                edges={decoratedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={(inst) => {
                  setInstance(inst);
                  const state = parsedEditorState;
                  if (state?.viewport) {
                    inst.setViewport(state.viewport);
                  }
                }}
                onNodeClick={(_, n) => {
                  setSelectedNodeId(n.id);
                  setSelectedEdgeId("");
                }}
                onEdgeClick={(_, e) => {
                  setSelectedEdgeId(e.id);
                  setSelectedNodeId("");
                }}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Workflow</CardTitle>
                <CardDescription>Draft updates only. Published workflows are read-only.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="workflow-name">Name</Label>
                  <Input id="workflow-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                </div>

                <div className="grid gap-2">
                  <div className="text-sm font-medium">Add Node</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => addNode("http.request")}>
                      http.request
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addNode("condition")}>
                      condition
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addNode("parallel.join")}>
                      parallel.join
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addNode("agent.execute")}>
                      agent.execute
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addNode("connector.action")}>
                      connector.action
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addNode("agent.run")}>
                      agent.run
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {selectedNodeId ? (
              <Card>
                <CardHeader>
                  <CardTitle>Node</CardTitle>
                  <CardDescription className="break-all">{selectedNodeId}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="node-config">Config (JSON)</Label>
                    <Textarea id="node-config" value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={10} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="accent" onClick={saveSelectedNodeConfig}>
                      Apply Config
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedNodeId("")}>
                      Close
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {selectedEdgeId ? (
              <Card>
                <CardHeader>
                  <CardTitle>Edge</CardTitle>
                  <CardDescription className="break-all">{selectedEdgeId}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label>Kind</Label>
                    <Select
                      value={edgeKind}
                      onValueChange={(v) => {
                        if (v === "always" || v === "cond_true" || v === "cond_false") {
                          setEdgeKind(v);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="always">always</SelectItem>
                        <SelectItem value="cond_true">cond_true</SelectItem>
                        <SelectItem value="cond_false">cond_false</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="accent" onClick={saveEdgeKind}>
                      Apply Edge
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedEdgeId("")}>
                      Close
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Debug</CardTitle>
                <CardDescription>Current draft payload preview.</CardDescription>
              </CardHeader>
              <CardContent>
                <CodeBlock value={{ workflow: loaded, nodes: nodes.length, edges: edges.length }} />
              </CardContent>
            </Card>

            {issues.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Validation</CardTitle>
                  <CardDescription>Fix these issues before saving.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {issues.slice(0, 5).map((issue, idx) => (
                    <button
                      key={`${issue.code}-${idx}`}
                      type="button"
                      className="rounded-md border border-borderSubtle/60 bg-panel/28 px-3 py-2 text-left text-sm text-text hover:bg-panel/55"
                      onClick={() => {
                        if (issue.nodeId) {
                          setSelectedNodeId(issue.nodeId);
                          setSelectedEdgeId("");
                          const hit = nodes.find((n) => n.id === issue.nodeId);
                          if (hit && instance) {
                            instance.setCenter(hit.position.x, hit.position.y, { zoom: 1.2, duration: 250 });
                          }
                          return;
                        }
                        if (issue.edgeId) {
                          setSelectedEdgeId(issue.edgeId);
                          setSelectedNodeId("");
                        }
                      }}
                    >
                      <div className="font-mono text-xs text-muted">{issue.code}</div>
                      <div className="mt-1 text-sm">{issue.message}</div>
                      {issue.nodeId ? <div className="mt-1 font-mono text-xs text-muted">node: {issue.nodeId}</div> : null}
                      {issue.edgeId ? <div className="mt-1 font-mono text-xs text-muted">edge: {issue.edgeId}</div> : null}
                    </button>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
