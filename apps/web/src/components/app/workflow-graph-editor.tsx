"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  workflowNodeSchema,
  type WorkflowDsl as WorkflowDslV2,
  type WorkflowDslV3,
} from "@vespid/workflow";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useActiveOrgId } from "../../lib/hooks/use-active-org-id";
import { useOrgSettings } from "../../lib/hooks/use-org-settings";
import { useSecrets } from "../../lib/hooks/use-secrets";
import { useUpdateWorkflowDraft, useWorkflow } from "../../lib/hooks/use-workflows";
import { AdvancedSection } from "./advanced-section";
import { LlmConfigField, type LlmConfigValue } from "./llm/llm-config-field";
import { ModelPickerField } from "./model-picker/model-picker-field";
import { SecretSelectField } from "./secrets/secret-select-field";

type EdgeKind = "always" | "cond_true" | "cond_false";

type WorkflowNodeAny = {
  id: string;
  type: string;
  config?: unknown;
};

type InspectorTab = "form" | "json";

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

function normalizeStringArray(text: string): string[] {
  const items = text
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(items));
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOrgDefaultAgentLlm(settings: any): LlmConfigValue {
  const d = settings?.llm?.defaults?.workflowAgentRun;
  const providerId = typeof d?.provider === "string" ? d.provider : "openai";
  const modelId = typeof d?.model === "string" ? d.model : "gpt-4.1-mini";
  const secretId = typeof d?.secretId === "string" ? d.secretId : null;
  return { providerId: providerId as any, modelId, secretId };
}

function defaultNodeByType(params: {
  type: string;
  orgDefaultAgentLlm: LlmConfigValue;
  secrets: Array<{ id: string; connectorId: string; name: string }>;
}): WorkflowNodeAny {
  const { type, orgDefaultAgentLlm, secrets } = params;
  if (type === "agent.run") {
    return {
      id: "",
      type,
      config: {
        llm: {
          provider: orgDefaultAgentLlm.providerId,
          model: orgDefaultAgentLlm.modelId,
          auth: {
            ...(orgDefaultAgentLlm.secretId ? { secretId: orgDefaultAgentLlm.secretId } : {}),
            fallbackToEnv: true,
          },
        },
        prompt: {
          instructions: "Summarize the input and decide the next step.",
        },
        tools: {
          allow: [],
          execution: "cloud",
        },
        output: {
          mode: "text",
        },
        limits: {
          maxTurns: 8,
          maxToolCalls: 20,
          timeoutMs: 60_000,
          maxOutputChars: 50_000,
          maxRuntimeChars: 200_000,
        },
        execution: {
          mode: "cloud",
        },
      },
    };
  }
  if (type === "agent.execute") {
    return {
      id: "",
      type,
      config: {
        task: {
          type: "shell",
          script: "echo hello",
          shell: "sh",
        },
        execution: {
          mode: "cloud",
        },
        sandbox: {
          backend: "docker",
          network: "none",
          timeoutMs: 60_000,
        },
      },
    };
  }
  if (type === "connector.action") {
    const defaultGithub = secrets.find((s) => s.connectorId === "github" && s.name === "default") ?? secrets.find((s) => s.connectorId === "github") ?? null;
    return {
      id: "",
      type,
      config: {
        connectorId: "github",
        actionId: "issue.create",
        input: { repo: "octo/test", title: "Vespid Issue", body: "Created by Vespid connector.action" },
        auth: {
          ...(defaultGithub ? { secretId: defaultGithub.id } : { secretId: "" }),
        },
        execution: {
          mode: "cloud",
        },
      },
    };
  }
  if (type === "connector.github.issue.create") {
    const defaultGithub = secrets.find((s) => s.connectorId === "github" && s.name === "default") ?? secrets.find((s) => s.connectorId === "github") ?? null;
    return {
      id: "",
      type,
      config: {
        repo: "octo/test",
        title: "Vespid Issue",
        body: "Created by Vespid legacy node",
        auth: { ...(defaultGithub ? { secretId: defaultGithub.id } : { secretId: "" }) },
      },
    };
  }
  if (type === "http.request") {
    return {
      id: "",
      type,
      config: {
        method: "GET",
        url: "https://example.com",
        headers: { accept: "application/json" },
      },
    };
  }
  if (type === "condition") {
    return {
      id: "",
      type,
      config: {
        path: "$.ok",
        op: "eq",
        value: true,
      },
    };
  }
  if (type === "parallel.join") {
    return {
      id: "",
      type,
      config: {
        mode: "all",
        failFast: true,
      },
    };
  }
  return { id: "", type };
}

function upgradeLegacyGithubIssueCreate(node: WorkflowNodeAny): WorkflowNodeAny {
  if (node.type !== "connector.github.issue.create") {
    return node;
  }
  const cfg = asObject(node.config) ?? {};
  const auth = asObject(cfg["auth"]) ?? {};
  const secretId = typeof auth["secretId"] === "string" ? auth["secretId"] : "";
  return {
    ...node,
    type: "connector.action",
    config: {
      connectorId: "github",
      actionId: "issue.create",
      input: {
        repo: asString(cfg["repo"], "octo/test"),
        title: asString(cfg["title"], "Vespid Issue"),
        ...(typeof cfg["body"] === "string" ? { body: cfg["body"] } : {}),
      },
      auth: { secretId },
    },
  };
}

function JsonValueField(props: {
  label: string;
  value: unknown;
  onApply: (next: unknown) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(stringifyJson(props.value));
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setText(stringifyJson(props.value));
    setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  return (
    <div className="grid gap-1.5">
      <Label>{props.label}</Label>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr("");
        }}
        rows={props.rows ?? 6}
        placeholder={props.placeholder}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const parsed = safeJsonParse(text);
            if (!parsed.ok) {
              setErr("Invalid JSON");
              return;
            }
            props.onApply(parsed.value);
          }}
        >
          Apply
        </Button>
        {err ? <div className="text-xs text-red-700">{err}</div> : null}
      </div>
    </div>
  );
}

export function WorkflowGraphEditor({ workflowId, locale, variant = "full" }: WorkflowGraphEditorProps) {
  const orgId = useActiveOrgId() ?? null;
  const workflowQuery = useWorkflow(orgId, workflowId);
  const updateDraft = useUpdateWorkflowDraft(orgId, workflowId);
  const orgSettingsQuery = useOrgSettings(orgId);
  const secretsQuery = useSecrets(orgId);

  const [instance, setInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>("");
  const [configJson, setConfigJson] = useState<string>("{}");
  const [configJsonDirty, setConfigJsonDirty] = useState<boolean>(false);
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("always");
  const [nameDraft, setNameDraft] = useState<string>("");
  const [issues, setIssues] = useState<GraphValidationIssue[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("form");

  const bulkInitRef = useRef(false);
  const [bulkAgentLlm, setBulkAgentLlm] = useState<LlmConfigValue>({ providerId: "openai", modelId: "gpt-4.1-mini", secretId: null });
  const [bulkTeammateModel, setBulkTeammateModel] = useState<string>("gpt-4.1-mini");

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

  const orgDefaultAgentLlm = useMemo(() => readOrgDefaultAgentLlm(orgSettingsQuery.data?.settings), [orgSettingsQuery.data?.settings]);

  useEffect(() => {
    if (bulkInitRef.current) return;
    setBulkAgentLlm(orgDefaultAgentLlm);
    setBulkTeammateModel(orgDefaultAgentLlm.modelId);
    bulkInitRef.current = true;
  }, [orgDefaultAgentLlm]);

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
    setConfigJsonDirty(false);
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    if (inspectorTab !== "form") {
      return;
    }
    if (!selectedNodeId) {
      return;
    }
    if (configJsonDirty) {
      return;
    }
    const node = nodes.find((n) => n.id === selectedNodeId) as any;
    const cfg = node?.data?.node?.config ?? null;
    setConfigJson(JSON.stringify(cfg ?? {}, null, 2));
  }, [inspectorTab, selectedNodeId, nodes, configJsonDirty]);

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

  function updateNode(nodeId: string, updater: (current: WorkflowNodeAny) => WorkflowNodeAny) {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== nodeId) {
          return n;
        }
        const current = (n as any).data?.node as WorkflowNodeAny;
        const next = updater(current);
        return { ...n, data: { ...(n as any).data, label: next.type, node: next } };
      })
    );
  }

  function addNode(type: WorkflowNodeAny["type"]) {
    const id = `${type.replaceAll(".", "_")}-${Math.floor(Math.random() * 100000)}`;
    const secrets = secretsQuery.data?.secrets ?? [];
    const nodeBase = defaultNodeByType({ type, orgDefaultAgentLlm, secrets });
    const node: WorkflowNodeAny = { ...nodeBase, id, type };
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
    setInspectorTab("form");
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
    const selected = nodes.find((n) => n.id === selectedNodeId) as any;
    const current = selected?.data?.node as WorkflowNodeAny | undefined;
    if (!current) {
      return;
    }
    const candidate = { id: current.id, type: current.type, config: parsed.value };
    const validated = workflowNodeSchema.safeParse(candidate);
    if (!validated.success) {
      toast.error(`Invalid config: ${validated.error.issues[0]?.message ?? "Validation error"}`);
      return;
    }
    updateNode(selectedNodeId, (cur) => ({ ...cur, config: parsed.value }));
    setConfigJsonDirty(false);
    toast.success("Node updated");
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

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const hit = nodes.find((n) => n.id === selectedNodeId) as any;
    return (hit?.data?.node as WorkflowNodeAny) ?? null;
  }, [nodes, selectedNodeId]);

  function renderExecutionSection(params: {
    nodeId: string;
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    label?: string;
  }) {
    const exec = asObject(params.config["execution"]) ?? {};
    const mode = (exec["mode"] === "executor" ? "executor" : "cloud") as "cloud" | "executor";
    const selector = asObject(exec["selector"]) ?? null;
    const selectorKind =
      selector && typeof selector["tag"] === "string"
        ? "tag"
        : selector && typeof selector["executorId"] === "string"
          ? "executorId"
        : selector && typeof selector["group"] === "string"
            ? "group"
            : "none";
    const selectorValue =
      selectorKind === "tag"
        ? String(selector?.tag ?? "")
        : selectorKind === "executorId"
          ? String(selector?.executorId ?? "")
          : selectorKind === "group"
            ? String(selector?.group ?? "")
            : "";

    return (
      <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
        <div className="text-sm font-medium text-text">{params.label ?? "Execution"}</div>
        <div className="grid gap-1.5">
          <Label>Mode</Label>
          <Select
            value={mode}
            onValueChange={(v) => {
              const nextMode = v === "executor" ? "executor" : "cloud";
              params.onChange({
                ...params.config,
                execution: {
                  ...exec,
                  mode: nextMode,
                  ...(nextMode === "cloud" ? { selector: undefined } : {}),
                  ...(nextMode === "executor" && !selector ? { selector: { pool: "managed" } } : {}),
                },
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloud">cloud</SelectItem>
              <SelectItem value="executor">executor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "executor" ? (
          <div className="grid gap-2">
            <div className="grid gap-1.5">
              <Label>Selector</Label>
              <Select
                value={selectorKind}
                onValueChange={(v) => {
                  if (v === "none") {
                    params.onChange({ ...params.config, execution: { ...exec, mode, selector: undefined } });
                    return;
                  }
                  const nextSel =
                    v === "tag"
                      ? { pool: "managed", tag: "" }
                      : v === "executorId"
                        ? { pool: "managed", executorId: "" }
                        : v === "group"
                          ? { pool: "managed", group: "" }
                          : undefined;
                  params.onChange({ ...params.config, execution: { ...exec, mode, selector: nextSel } });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">none</SelectItem>
                  <SelectItem value="tag">tag</SelectItem>
                  <SelectItem value="executorId">executorId</SelectItem>
                  <SelectItem value="group">group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectorKind !== "none" ? (
              <div className="grid gap-1.5">
                <Label>Value</Label>
                <Input
                  value={selectorValue}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const nextSel =
                      selectorKind === "tag"
                        ? { pool: "managed", tag: raw }
                        : selectorKind === "executorId"
                          ? { pool: "managed", executorId: raw }
                          : selectorKind === "group"
                            ? { pool: "managed", group: raw }
                            : undefined;
                    params.onChange({ ...params.config, execution: { ...exec, mode, selector: nextSel } });
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderAgentRunForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const prompt = asObject(cfg["prompt"]) ?? {};
    const llm = asObject(cfg["llm"]) ?? {};
    const llmAuth = asObject(llm["auth"]) ?? {};
    const tools = asObject(cfg["tools"]) ?? {};
    const limits = asObject(cfg["limits"]) ?? {};
    const output = asObject(cfg["output"]) ?? {};
    const engine = asObject(cfg["engine"]) ?? {};
    const team = asObject(cfg["team"]);

    const llmValue: LlmConfigValue = {
      providerId: (typeof llm["provider"] === "string" ? llm["provider"] : "openai") as any,
      modelId: asString(llm["model"], "gpt-4.1-mini"),
      secretId: typeof llmAuth["secretId"] === "string" ? (llmAuth["secretId"] as string) : null,
    };

    const toolsAllowText = (Array.isArray(tools["allow"]) ? tools["allow"] : []).filter((v) => typeof v === "string").join("\n");
    const toolsExecution = tools["execution"] === "executor" ? "executor" : "cloud";

    const outputMode = output["mode"] === "json" ? "json" : "text";

    const maxTurns = asNumber(limits["maxTurns"], 8);
    const maxToolCalls = asNumber(limits["maxToolCalls"], 20);
    const timeoutMs = asNumber(limits["timeoutMs"], 60_000);

    const engineId =
      engine["id"] === "gateway.codex.v2" || engine["id"] === "gateway.claude.v2" || engine["id"] === "gateway.loop.v2"
        ? (engine["id"] as string)
        : "gateway.loop.v2";

    const toolsetId = typeof cfg["toolsetId"] === "string" ? (cfg["toolsetId"] as string) : "";

    const teamEnabled = Boolean(team);
    const teamLeadMode =
      team && (team["leadMode"] === "delegate_only" || team["leadMode"] === "normal") ? (team["leadMode"] as string) : "normal";
    const teamMaxParallel = team ? asNumber(team["maxParallel"], 3) : 3;
    const teammates = team && Array.isArray(team["teammates"]) ? (team["teammates"] as any[]) : [];

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">LLM</div>
          <LlmConfigField
            orgId={orgId}
            mode="workflowAgentRun"
            value={llmValue}
            onChange={(next) => {
              updateNode(node.id, (cur) => {
                const curCfg = asObject(cur.config) ?? {};
                const curLlm = asObject(curCfg["llm"]) ?? {};
                const provider = next.providerId;
                const model = next.modelId;
                const secretId = next.secretId;
                return {
                  ...cur,
                  config: {
                    ...curCfg,
                    llm: {
                      ...curLlm,
                      provider,
                      model,
                      auth: { ...(secretId ? { secretId } : {}), fallbackToEnv: true },
                    },
                  },
                };
              });
            }}
          />
          {isOAuthRequiredProvider(llmValue.providerId) && !llmValue.secretId ? (
            <div className="text-xs text-warn">Selected provider requires secretId.</div>
          ) : null}
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Prompt</div>
          <div className="grid gap-1.5">
            <Label>Instructions</Label>
            <Textarea
              value={asString(prompt["instructions"], "")}
              onChange={(e) => {
                const val = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curPrompt = asObject(curCfg["prompt"]) ?? {};
                  return { ...cur, config: { ...curCfg, prompt: { ...curPrompt, instructions: val } } };
                });
              }}
              rows={5}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>System (optional)</Label>
            <Textarea
              value={typeof prompt["system"] === "string" ? (prompt["system"] as string) : ""}
              onChange={(e) => {
                const val = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curPrompt = asObject(curCfg["prompt"]) ?? {};
                  return { ...cur, config: { ...curCfg, prompt: { ...curPrompt, system: val.trim().length ? val : undefined } } };
                });
              }}
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Input template (optional)</Label>
            <Textarea
              value={typeof prompt["inputTemplate"] === "string" ? (prompt["inputTemplate"] as string) : ""}
              onChange={(e) => {
                const val = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curPrompt = asObject(curCfg["prompt"]) ?? {};
                  return {
                    ...cur,
                    config: { ...curCfg, prompt: { ...curPrompt, inputTemplate: val.trim().length ? val : undefined } },
                  };
                });
              }}
              rows={3}
            />
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Tools</div>
          <div className="grid gap-1.5">
            <Label>Allowlist (one per line)</Label>
            <Textarea
              value={toolsAllowText}
              onChange={(e) => {
                const nextAllow = normalizeStringArray(e.target.value);
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curTools = asObject(curCfg["tools"]) ?? {};
                  return { ...cur, config: { ...curCfg, tools: { ...curTools, allow: nextAllow } } };
                });
              }}
              rows={4}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Execution</Label>
            <Select
              value={toolsExecution}
              onValueChange={(v) => {
                const nextExec = v === "executor" ? "executor" : "cloud";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curTools = asObject(curCfg["tools"]) ?? {};
                  return { ...cur, config: { ...curCfg, tools: { ...curTools, execution: nextExec } } };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cloud">cloud</SelectItem>
                <SelectItem value="executor">executor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <JsonValueField
            label="Auth defaults (advanced)"
            value={(tools as any)["authDefaults"] ?? {}}
            onApply={(next) => {
              updateNode(node.id, (cur) => {
                const curCfg = asObject(cur.config) ?? {};
                const curTools = asObject(curCfg["tools"]) ?? {};
                return { ...cur, config: { ...curCfg, tools: { ...curTools, authDefaults: next } } };
              });
            }}
            rows={6}
            placeholder='Example: { "connectors": { "github": { "secretId": "uuid" } } }'
          />
        </div>

        {renderExecutionSection({
          nodeId: node.id,
          config: cfg,
          onChange: (next) => updateNode(node.id, (cur) => ({ ...cur, config: next })),
        })}

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Output</div>
          <div className="grid gap-1.5">
            <Label>Mode</Label>
            <Select
              value={outputMode}
              onValueChange={(v) => {
                const nextMode = v === "json" ? "json" : "text";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curOut = asObject(curCfg["output"]) ?? {};
                  return { ...cur, config: { ...curCfg, output: { ...curOut, mode: nextMode } } };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">text</SelectItem>
                <SelectItem value="json">json</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {outputMode === "json" ? (
            <JsonValueField
              label="JSON schema (optional)"
              value={(output as any)["jsonSchema"] ?? {}}
              onApply={(next) => {
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curOut = asObject(curCfg["output"]) ?? {};
                  return { ...cur, config: { ...curCfg, output: { ...curOut, jsonSchema: next } } };
                });
              }}
              rows={6}
            />
          ) : null}
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Team</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={teamEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  if (!enabled) {
                    const { team: _team, ...rest } = curCfg as any;
                    return { ...cur, config: rest };
                  }
                  const teammate1 = {
                    id: "teammate-1",
                    prompt: { instructions: "Help the lead agent by completing delegated tasks." },
                    tools: { allow: [], execution: "cloud" },
                    limits: { maxTurns: 8, maxToolCalls: 20, timeoutMs: 60_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 },
                    output: { mode: "text" },
                  };
                  return {
                    ...cur,
                    config: {
                      ...curCfg,
                      team: {
                        mode: "supervisor",
                        maxParallel: 3,
                        leadMode: "normal",
                        teammates: [teammate1],
                      },
                    },
                  };
                });
              }}
            />
            Enable team
          </label>

          {teamEnabled ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Lead mode</Label>
                <Select
                  value={teamLeadMode}
                  onValueChange={(v) => {
                    const nextMode = v === "delegate_only" ? "delegate_only" : "normal";
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curTeam = asObject((curCfg as any)["team"]) ?? {};
                      return { ...cur, config: { ...curCfg, team: { ...curTeam, leadMode: nextMode } } };
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">normal</SelectItem>
                    <SelectItem value="delegate_only">delegate_only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Max parallel</Label>
                <Input
                  type="number"
                  value={String(teamMaxParallel)}
                  onChange={(e) => {
                    const next = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curTeam = asObject((curCfg as any)["team"]) ?? {};
                      return { ...cur, config: { ...curCfg, team: { ...curTeam, maxParallel: next } } };
                    });
                  }}
                />
              </div>

              <div className="grid gap-2">
                <div className="text-sm font-medium text-text">Teammates</div>
                {teammates.map((tm, idx) => {
                  const tmObj = asObject(tm) ?? {};
                  const tmPrompt = asObject(tmObj["prompt"]) ?? {};
                  const tmTools = asObject(tmObj["tools"]) ?? {};
                  const tmOutput = asObject(tmObj["output"]) ?? {};
                  const tmLlm = asObject(tmObj["llm"]);
                  const tmId = asString(tmObj["id"], `teammate-${idx + 1}`);
                  const canRemove = teammates.length > 1;
                  const tmAllowText = (Array.isArray(tmTools["allow"]) ? tmTools["allow"] : []).filter((v) => typeof v === "string").join("\n");
                  const tmOutMode = tmOutput["mode"] === "json" ? "json" : "text";
                  const tmModel = tmLlm ? asString(tmLlm["model"], "") : "";

                  return (
                    <div key={`${tmId}-${idx}`} className="grid gap-2 rounded-lg border border-border bg-panel/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-text">{idx + 1}. {tmId}</div>
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={idx === 0}
                            onClick={() => {
                              updateNode(node.id, (cur) => {
                                const curCfg = asObject(cur.config) ?? {};
                                const curTeam = asObject((curCfg as any)["team"]) ?? {};
                                const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                                const a = list[idx - 1];
                                const b = list[idx];
                                if (!a || !b) return cur;
                                list[idx - 1] = b;
                                list[idx] = a;
                                return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                              });
                            }}
                          >
                            Up
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={idx === teammates.length - 1}
                            onClick={() => {
                              updateNode(node.id, (cur) => {
                                const curCfg = asObject(cur.config) ?? {};
                                const curTeam = asObject((curCfg as any)["team"]) ?? {};
                                const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                                const a = list[idx];
                                const b = list[idx + 1];
                                if (!a || !b) return cur;
                                list[idx] = b;
                                list[idx + 1] = a;
                                return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                              });
                            }}
                          >
                            Down
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={!canRemove}
                            onClick={() => {
                              updateNode(node.id, (cur) => {
                                const curCfg = asObject(cur.config) ?? {};
                                const curTeam = asObject((curCfg as any)["team"]) ?? {};
                                const list = Array.isArray((curTeam as any)["teammates"])
                                  ? ([(curTeam as any)["teammates"]].flat() as any[])
                                  : [];
                                const next = list.filter((_, i) => i !== idx);
                                return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: next } } };
                              });
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Id</Label>
                        <Input
                          value={tmId}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              list[idx] = { ...hit, id: v };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Display name (optional)</Label>
                        <Input
                          value={typeof tmObj["displayName"] === "string" ? (tmObj["displayName"] as string) : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              list[idx] = { ...hit, displayName: v.trim().length ? v : undefined };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Instructions</Label>
                        <Textarea
                          value={asString(tmPrompt["instructions"], "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              const hitPrompt = asObject((hit as any)["prompt"]) ?? {};
                              list[idx] = { ...hit, prompt: { ...hitPrompt, instructions: v } };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                          rows={3}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Model override (optional)</Label>
                        <ModelPickerField
                          value={tmModel}
                          onChange={(next) => {
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              if (!next.trim()) {
                                const { llm: _llm, ...rest } = hit as any;
                                list[idx] = rest;
                              } else {
                                list[idx] = { ...hit, llm: { model: next.trim() } };
                              }
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                          placeholder="(inherit)"
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Tools allowlist (one per line)</Label>
                        <Textarea
                          value={tmAllowText}
                          onChange={(e) => {
                            const nextAllow = normalizeStringArray(e.target.value);
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              const hitTools = asObject((hit as any)["tools"]) ?? {};
                              list[idx] = { ...hit, tools: { ...hitTools, allow: nextAllow, execution: "cloud" } };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                          rows={3}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <Label>Output mode</Label>
                        <Select
                          value={tmOutMode}
                          onValueChange={(v) => {
                            const nextMode = v === "json" ? "json" : "text";
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              const hitOut = asObject((hit as any)["output"]) ?? {};
                              list[idx] = { ...hit, output: { ...hitOut, mode: nextMode } };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">text</SelectItem>
                            <SelectItem value="json">json</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {tmOutMode === "json" ? (
                        <JsonValueField
                          label="JSON schema (optional)"
                          value={(tmOutput as any)["jsonSchema"] ?? {}}
                          onApply={(next) => {
                            updateNode(node.id, (cur) => {
                              const curCfg = asObject(cur.config) ?? {};
                              const curTeam = asObject((curCfg as any)["team"]) ?? {};
                              const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                              const hit = asObject(list[idx]) ?? {};
                              const hitOut = asObject((hit as any)["output"]) ?? {};
                              list[idx] = { ...hit, output: { ...hitOut, jsonSchema: next } };
                              return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: list } } };
                            });
                          }}
                          rows={6}
                        />
                      ) : null}
                    </div>
                  );
                })}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={teammates.length >= 32}
                  onClick={() => {
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curTeam = asObject((curCfg as any)["team"]) ?? {};
                      const list = Array.isArray((curTeam as any)["teammates"]) ? ([...(curTeam as any)["teammates"]] as any[]) : [];
                      const nextIdx = list.length + 1;
                      const next = {
                        id: `teammate-${nextIdx}`,
                        prompt: { instructions: "Help the lead agent by completing delegated tasks." },
                        tools: { allow: [], execution: "cloud" },
                        limits: { maxTurns: 8, maxToolCalls: 20, timeoutMs: 60_000, maxOutputChars: 50_000, maxRuntimeChars: 200_000 },
                        output: { mode: "text" },
                      };
                      return { ...cur, config: { ...curCfg, team: { ...curTeam, teammates: [...list, next] } } };
                    });
                  }}
                >
                  Add teammate
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Advanced</div>

          <div className="grid gap-1.5">
            <Label>Toolset ID (optional)</Label>
            <Input
              value={toolsetId}
              onChange={(e) => {
                const v = e.target.value.trim();
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  return { ...cur, config: { ...curCfg, toolsetId: v.length ? v : undefined } };
                });
              }}
              placeholder="uuid"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Engine</Label>
            <Select
              value={engineId}
              onValueChange={(v) => {
                const nextId = v === "gateway.codex.v2" || v === "gateway.claude.v2" ? v : "gateway.loop.v2";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  return {
                    ...cur,
                    config: {
                      ...curCfg,
                      engine: { id: nextId },
                    },
                  };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gateway.loop.v2">gateway.loop.v2</SelectItem>
                <SelectItem value="gateway.claude.v2">gateway.claude.v2</SelectItem>
                <SelectItem value="gateway.codex.v2">gateway.codex.v2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>maxTurns</Label>
              <Input
                type="number"
                value={String(maxTurns)}
                onChange={(e) => {
                  const next = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                  updateNode(node.id, (cur) => {
                    const curCfg = asObject(cur.config) ?? {};
                    const curLimits = asObject((curCfg as any)["limits"]) ?? {};
                    return { ...cur, config: { ...curCfg, limits: { ...curLimits, maxTurns: next } } };
                  });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>maxToolCalls</Label>
              <Input
                type="number"
                value={String(maxToolCalls)}
                onChange={(e) => {
                  const next = Math.max(0, Math.min(200, Number(e.target.value) || 0));
                  updateNode(node.id, (cur) => {
                    const curCfg = asObject(cur.config) ?? {};
                    const curLimits = asObject((curCfg as any)["limits"]) ?? {};
                    return { ...cur, config: { ...curCfg, limits: { ...curLimits, maxToolCalls: next } } };
                  });
                }}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>timeoutMs</Label>
            <Input
              type="number"
              value={String(timeoutMs)}
              onChange={(e) => {
                const next = Math.max(1000, Math.min(10 * 60 * 1000, Number(e.target.value) || 1000));
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curLimits = asObject((curCfg as any)["limits"]) ?? {};
                  return { ...cur, config: { ...curCfg, limits: { ...curLimits, timeoutMs: next } } };
                });
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderAgentExecuteForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const task = asObject(cfg["task"]) ?? {};
    const sandbox = asObject(cfg["sandbox"]) ?? {};
    const docker = asObject(sandbox["docker"]) ?? {};
    const env = asObject(task["env"]) ?? {};

    const script = asString(task["script"], "");
    const shell = task["shell"] === "bash" ? "bash" : "sh";
    const backend =
      sandbox["backend"] === "host" || sandbox["backend"] === "provider" || sandbox["backend"] === "docker" ? (sandbox["backend"] as string) : "docker";
    const network = sandbox["network"] === "enabled" ? "enabled" : "none";
    const timeoutMs = asNumber(sandbox["timeoutMs"], 60_000);
    const dockerImage = typeof docker["image"] === "string" ? (docker["image"] as string) : "";
    const envPassthroughText = Array.isArray(sandbox["envPassthroughAllowlist"])
      ? (sandbox["envPassthroughAllowlist"] as any[]).filter((v) => typeof v === "string").join("\n")
      : "";

    return (
      <div className="grid gap-3">
        {renderExecutionSection({
          nodeId: node.id,
          config: cfg,
          onChange: (next) => updateNode(node.id, (cur) => ({ ...cur, config: next })),
        })}

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Task</div>
          <div className="grid gap-1.5">
            <Label>Shell</Label>
            <Select
              value={shell}
              onValueChange={(v) => {
                const nextShell = v === "bash" ? "bash" : "sh";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curTask = asObject((curCfg as any)["task"]) ?? {};
                  return { ...cur, config: { ...curCfg, task: { ...curTask, type: "shell", shell: nextShell } } };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sh">sh</SelectItem>
                <SelectItem value="bash">bash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Script</Label>
            <Textarea
              value={script}
              onChange={(e) => {
                const v = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curTask = asObject((curCfg as any)["task"]) ?? {};
                  return { ...cur, config: { ...curCfg, task: { ...curTask, type: "shell", script: v, shell } } };
                });
              }}
              rows={6}
            />
          </div>
          <JsonValueField
            label="Env (optional)"
            value={env}
            onApply={(next) => {
              updateNode(node.id, (cur) => {
                const curCfg = asObject(cur.config) ?? {};
                const curTask = asObject((curCfg as any)["task"]) ?? {};
                return { ...cur, config: { ...curCfg, task: { ...curTask, type: "shell", env: next } } };
              });
            }}
            rows={6}
            placeholder='Example: { "FOO": "bar" }'
          />
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Sandbox (advanced)</div>
          <div className="grid gap-1.5">
            <Label>Backend</Label>
            <Select
              value={backend}
              onValueChange={(v) => {
                const next = v === "host" || v === "provider" ? v : "docker";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curSandbox = asObject((curCfg as any)["sandbox"]) ?? {};
                  return { ...cur, config: { ...curCfg, sandbox: { ...curSandbox, backend: next } } };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="docker">docker</SelectItem>
                <SelectItem value="host">host</SelectItem>
                <SelectItem value="provider">provider</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Network</Label>
            <Select
              value={network}
              onValueChange={(v) => {
                const next = v === "enabled" ? "enabled" : "none";
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curSandbox = asObject((curCfg as any)["sandbox"]) ?? {};
                  return { ...cur, config: { ...curCfg, sandbox: { ...curSandbox, network: next } } };
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="enabled">enabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Timeout (ms)</Label>
            <Input
              type="number"
              value={String(timeoutMs)}
              onChange={(e) => {
                const next = Math.max(1000, Math.min(10 * 60 * 1000, Number(e.target.value) || 1000));
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curSandbox = asObject((curCfg as any)["sandbox"]) ?? {};
                  return { ...cur, config: { ...curCfg, sandbox: { ...curSandbox, timeoutMs: next } } };
                });
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Docker image (optional)</Label>
            <Input
              value={dockerImage}
              onChange={(e) => {
                const v = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curSandbox = asObject((curCfg as any)["sandbox"]) ?? {};
                  const curDocker = asObject((curSandbox as any)["docker"]) ?? {};
                  return { ...cur, config: { ...curCfg, sandbox: { ...curSandbox, docker: { ...curDocker, image: v.trim().length ? v : undefined } } } };
                });
              }}
              placeholder="e.g. node:20-alpine"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Env passthrough allowlist (one per line)</Label>
            <Textarea
              value={envPassthroughText}
              onChange={(e) => {
                const next = normalizeStringArray(e.target.value);
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curSandbox = asObject((curCfg as any)["sandbox"]) ?? {};
                  return { ...cur, config: { ...curCfg, sandbox: { ...curSandbox, envPassthroughAllowlist: next } } };
                });
              }}
              rows={4}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderConnectorActionForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const auth = asObject(cfg["auth"]) ?? {};
    const connectorId = asString(cfg["connectorId"], "");
    const actionId = asString(cfg["actionId"], "");
    const secretId = typeof auth["secretId"] === "string" ? (auth["secretId"] as string) : null;

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Action</div>
          <div className="grid gap-1.5">
            <Label>connectorId</Label>
            <Input
              value={connectorId}
              onChange={(e) => {
                const next = e.target.value;
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curAuth = asObject((curCfg as any)["auth"]) ?? {};
                  // Changing the connector should clear secret selection by default.
                  const nextAuth = next !== asString(curCfg["connectorId"], "") ? { ...curAuth, secretId: undefined } : curAuth;
                  return { ...cur, config: { ...curCfg, connectorId: next, auth: nextAuth } };
                });
              }}
              placeholder="github"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>actionId</Label>
            <Input value={actionId} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), actionId: e.target.value } }))} />
          </div>

          <div className="grid gap-1.5">
            <Label>Secret</Label>
            <SecretSelectField
              orgId={orgId}
              connectorId={connectorId || "github"}
              value={secretId}
              onChange={(next) => {
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curAuth = asObject((curCfg as any)["auth"]) ?? {};
                  return { ...cur, config: { ...curCfg, auth: { ...curAuth, secretId: next ?? "" } } };
                });
              }}
              required
            />
          </div>

          <JsonValueField
            label="Input (JSON)"
            value={cfg["input"] ?? {}}
            onApply={(next) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), input: next } }))}
            rows={8}
          />
        </div>

        {renderExecutionSection({
          nodeId: node.id,
          config: cfg,
          onChange: (next) => updateNode(node.id, (cur) => ({ ...cur, config: next })),
        })}
      </div>
    );
  }

  function renderLegacyGithubIssueCreateForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const auth = asObject(cfg["auth"]) ?? {};
    const secretId = typeof auth["secretId"] === "string" ? (auth["secretId"] as string) : null;
    const repo = asString(cfg["repo"], "");
    const title = asString(cfg["title"], "");
    const body = typeof cfg["body"] === "string" ? (cfg["body"] as string) : "";

    return (
      <div className="grid gap-3">
        <div className="rounded-lg border border-border bg-panel/50 p-3 text-xs text-muted">
          Legacy node type. Prefer <span className="font-mono">connector.action</span>.
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">GitHub Issue</div>
          <div className="grid gap-1.5">
            <Label>repo</Label>
            <Input value={repo} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), repo: e.target.value } }))} placeholder="owner/repo" />
          </div>
          <div className="grid gap-1.5">
            <Label>title</Label>
            <Input value={title} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), title: e.target.value } }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>body (optional)</Label>
            <Textarea value={body} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), body: e.target.value } }))} rows={6} />
          </div>
          <div className="grid gap-1.5">
            <Label>Secret</Label>
            <SecretSelectField
              orgId={orgId}
              connectorId="github"
              value={secretId}
              onChange={(next) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), auth: { secretId: next ?? "" } } }))}
              required
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            updateNode(node.id, (cur) => upgradeLegacyGithubIssueCreate(cur));
            toast.success("Upgraded node to connector.action");
          }}
        >
          Upgrade to connector.action (github issue.create)
        </Button>
      </div>
    );
  }

  function renderHttpRequestForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const method =
      cfg["method"] === "GET" ||
      cfg["method"] === "POST" ||
      cfg["method"] === "PUT" ||
      cfg["method"] === "PATCH" ||
      cfg["method"] === "DELETE" ||
      cfg["method"] === "HEAD" ||
      cfg["method"] === "OPTIONS"
        ? (cfg["method"] as string)
        : "GET";
    const url = asString(cfg["url"], "");
    const headers = asObject(cfg["headers"]) ?? {};
    const entries = Object.entries(headers).filter(([k, v]) => typeof k === "string" && typeof v === "string") as Array<[string, string]>;

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Request</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), method: v } }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>URL</Label>
              <Input value={url} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), url: e.target.value } }))} placeholder="https://example.com" />
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium text-text">Headers</div>
            {entries.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={k}
                  onChange={(e) => {
                    const nextKey = e.target.value;
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curHeaders = asObject((curCfg as any)["headers"]) ?? {};
                      const val = curHeaders[k];
                      const nextHeaders: Record<string, unknown> = { ...curHeaders };
                      delete nextHeaders[k];
                      if (nextKey.trim().length) {
                        nextHeaders[nextKey] = typeof val === "string" ? val : "";
                      }
                      return { ...cur, config: { ...curCfg, headers: nextHeaders } };
                    });
                  }}
                  placeholder="header"
                />
                <Input
                  value={v}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curHeaders = asObject((curCfg as any)["headers"]) ?? {};
                      return { ...cur, config: { ...curCfg, headers: { ...curHeaders, [k]: nextVal } } };
                    });
                  }}
                  placeholder="value"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    updateNode(node.id, (cur) => {
                      const curCfg = asObject(cur.config) ?? {};
                      const curHeaders = asObject((curCfg as any)["headers"]) ?? {};
                      const nextHeaders: Record<string, unknown> = { ...curHeaders };
                      delete nextHeaders[k];
                      return { ...cur, config: { ...curCfg, headers: nextHeaders } };
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                updateNode(node.id, (cur) => {
                  const curCfg = asObject(cur.config) ?? {};
                  const curHeaders = asObject((curCfg as any)["headers"]) ?? {};
                  const baseKey = "x-header";
                  let key = baseKey;
                  let i = 1;
                  while (Object.prototype.hasOwnProperty.call(curHeaders, key)) {
                    key = `${baseKey}-${i}`;
                    i += 1;
                  }
                  return { ...cur, config: { ...curCfg, headers: { ...curHeaders, [key]: "" } } };
                });
              }}
            >
              Add header
            </Button>
          </div>

          <JsonValueField
            label="Body (JSON, optional)"
            value={cfg["body"] ?? {}}
            onApply={(next) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), body: next } }))}
            rows={8}
          />
        </div>
      </div>
    );
  }

  function renderConditionForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const path = asString(cfg["path"], "");
    const op =
      cfg["op"] === "eq" ||
      cfg["op"] === "neq" ||
      cfg["op"] === "contains" ||
      cfg["op"] === "exists" ||
      cfg["op"] === "gt" ||
      cfg["op"] === "gte" ||
      cfg["op"] === "lt" ||
      cfg["op"] === "lte"
        ? (cfg["op"] as string)
        : "eq";
    const rawValue = (cfg as any)["value"];
    const valueText = typeof rawValue === "string" ? rawValue : rawValue === null ? "null" : typeof rawValue === "number" || typeof rawValue === "boolean" ? String(rawValue) : "";

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Condition</div>
          <div className="grid gap-1.5">
            <Label>path</Label>
            <Input value={path} onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), path: e.target.value } }))} placeholder="$.ok" />
          </div>
          <div className="grid gap-1.5">
            <Label>op</Label>
            <Select value={op} onValueChange={(v) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), op: v } }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["eq", "neq", "contains", "exists", "gt", "gte", "lt", "lte"].map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {op !== "exists" ? (
            <div className="grid gap-1.5">
              <Label>value</Label>
              <Input
                value={valueText}
                onChange={(e) => {
                  const v = e.target.value;
                  let parsed: unknown = v;
                  const json = safeJsonParse(v);
                  if (json.ok && (typeof json.value === "string" || typeof json.value === "number" || typeof json.value === "boolean" || json.value === null)) {
                    parsed = json.value;
                  }
                  updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), value: parsed } }));
                }}
                placeholder='Try: "foo", 123, true, null'
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderParallelJoinForm(node: WorkflowNodeAny) {
    const cfg = asObject(node.config) ?? {};
    const failFast = asBoolean(cfg["failFast"], true);
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
          <div className="text-sm font-medium text-text">Join</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={failFast}
              onChange={(e) => updateNode(node.id, (cur) => ({ ...cur, config: { ...(asObject(cur.config) ?? {}), failFast: e.target.checked } }))}
            />
            failFast
          </label>
        </div>
      </div>
    );
  }

  function renderNodeInspector(node: WorkflowNodeAny) {
    if (inspectorTab === "json") {
      return (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="node-config">Config (JSON)</Label>
            <Textarea
              id="node-config"
              value={configJson}
              onChange={(e) => {
                setConfigJson(e.target.value);
                setConfigJsonDirty(true);
              }}
              rows={12}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="accent" onClick={saveSelectedNodeConfig}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConfigJson(stringifyJson(node.config));
                setConfigJsonDirty(false);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      );
    }

    if (node.type === "agent.run") return renderAgentRunForm(node);
    if (node.type === "agent.execute") return renderAgentExecuteForm(node);
    if (node.type === "connector.action") return renderConnectorActionForm(node);
    if (node.type === "connector.github.issue.create") return renderLegacyGithubIssueCreateForm(node);
    if (node.type === "http.request") return renderHttpRequestForm(node);
    if (node.type === "condition") return renderConditionForm(node);
    if (node.type === "parallel.join") return renderParallelJoinForm(node);

    return (
      <div className="grid gap-3">
        <div className="rounded-lg border border-border bg-panel/50 p-3 text-sm text-muted">
          No guided form available for node type <span className="font-mono">{node.type}</span>.
        </div>
      </div>
    );
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

                <AdvancedSection
                  id="workflow-graph-bulk-actions"
                  title="Advanced settings"
                  description="Bulk model actions and teammate overrides."
                  labels={{ show: "Show", hide: "Hide" }}
                >
                <div className="grid gap-2 rounded-lg border border-border bg-panel/50 p-3">
                  <div className="text-sm font-medium text-text">Bulk model actions</div>

                  <div className="grid gap-2">
                    <div className="text-xs text-muted">Agent.run default model (apply to nodes)</div>
                    <LlmConfigField orgId={orgId} mode="workflowAgentRun" value={bulkAgentLlm} onChange={setBulkAgentLlm} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setBulkAgentLlm(orgDefaultAgentLlm)}
                        disabled={!orgId}
                      >
                        Reset to org default
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              const nodeAny = (n as any).data?.node as WorkflowNodeAny | undefined;
                              if (!nodeAny || nodeAny.type !== "agent.run") return n;
                              const cfg = asObject(nodeAny.config) ?? {};
                              const llm = asObject((cfg as any)["llm"]) ?? {};
                              const nextCfg = {
                                ...cfg,
                                llm: {
                                  ...llm,
                                  provider: bulkAgentLlm.providerId,
                                  model: bulkAgentLlm.modelId,
                                  auth: { ...(bulkAgentLlm.secretId ? { secretId: bulkAgentLlm.secretId } : {}), fallbackToEnv: true },
                                },
                              };
                              const nextNode: WorkflowNodeAny = { ...nodeAny, config: nextCfg };
                              return { ...n, data: { ...(n as any).data, label: nextNode.type, node: nextNode } };
                            })
                          );
                          toast.success("Applied model to all agent.run nodes");
                        }}
                        disabled={!orgId}
                      >
                        Apply to all agent.run nodes
                      </Button>
                      {selectedNode?.type === "agent.run" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const cfg = asObject(selectedNode.config) ?? {};
                            const llm = asObject((cfg as any)["llm"]) ?? {};
                            const auth = asObject((llm as any)["auth"]) ?? {};
                            const nextBulk: LlmConfigValue = {
                              providerId: (typeof llm["provider"] === "string" ? llm["provider"] : "openai") as any,
                              modelId: asString(llm["model"], "gpt-4.1-mini"),
                              secretId: typeof auth["secretId"] === "string" ? (auth["secretId"] as string) : null,
                            };
                            setBulkAgentLlm(nextBulk);
                            toast.success("Copied selected agent.run model into bulk editor");
                          }}
                        >
                          Use selected agent.run model
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-2 pt-2">
                    <div className="text-xs text-muted">Teammate model overrides (model-only)</div>
                    <ModelPickerField value={bulkTeammateModel} onChange={setBulkTeammateModel} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const model = bulkTeammateModel.trim();
                          if (!model) {
                            toast.error("Model is required");
                            return;
                          }
                          setNodes((prev) =>
                            prev.map((n) => {
                              const nodeAny = (n as any).data?.node as WorkflowNodeAny | undefined;
                              if (!nodeAny || nodeAny.type !== "agent.run") return n;
                              const cfg = asObject(nodeAny.config) ?? {};
                              const team = asObject((cfg as any)["team"]);
                              if (!team) return n;
                              const teammates = Array.isArray((team as any)["teammates"]) ? ([...(team as any)["teammates"]] as any[]) : [];
                              const nextTeammates = teammates.map((t) => {
                                const tm = asObject(t) ?? {};
                                return { ...tm, llm: { model } };
                              });
                              const nextCfg = { ...cfg, team: { ...team, teammates: nextTeammates } };
                              const nextNode: WorkflowNodeAny = { ...nodeAny, config: nextCfg };
                              return { ...n, data: { ...(n as any).data, node: nextNode } };
                            })
                          );
                          toast.success("Applied teammate model override");
                        }}
                      >
                        Apply to all teammates
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              const nodeAny = (n as any).data?.node as WorkflowNodeAny | undefined;
                              if (!nodeAny || nodeAny.type !== "agent.run") return n;
                              const cfg = asObject(nodeAny.config) ?? {};
                              const team = asObject((cfg as any)["team"]);
                              if (!team) return n;
                              const teammates = Array.isArray((team as any)["teammates"]) ? ([...(team as any)["teammates"]] as any[]) : [];
                              const nextTeammates = teammates.map((t) => {
                                const tm = asObject(t) ?? {};
                                const { llm: _llm, ...rest } = tm as any;
                                return rest;
                              });
                              const nextCfg = { ...cfg, team: { ...team, teammates: nextTeammates } };
                              const nextNode: WorkflowNodeAny = { ...nodeAny, config: nextCfg };
                              return { ...n, data: { ...(n as any).data, node: nextNode } };
                            })
                          );
                          toast.success("Cleared teammate model overrides");
                        }}
                      >
                        Clear teammate overrides
                      </Button>
                    </div>
                  </div>
                </div>
                </AdvancedSection>

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

            {selectedNodeId && selectedNode ? (
              <Card>
                <CardHeader>
                  <CardTitle>Node</CardTitle>
                  <CardDescription className="break-all">
                    <div className="font-mono text-xs">{selectedNode.type}</div>
                    <div className="mt-1">{selectedNodeId}</div>
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {inspectorTab === "json" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setConfigJson(stringifyJson(selectedNode.config));
                          setConfigJsonDirty(false);
                          setInspectorTab("form");
                        }}
                      >
                        Back to guided form
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => setSelectedNodeId("")}>
                      Close
                    </Button>
                  </div>

                  {inspectorTab === "json" ? (
                    renderNodeInspector(selectedNode)
                  ) : (
                    <>
                      {renderNodeInspector(selectedNode)}
                      <AdvancedSection
                        id={`workflow-node-json-${selectedNodeId}`}
                        title="Advanced settings"
                        description="Edit node config directly as JSON."
                        labels={{ show: "Show", hide: "Hide" }}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setConfigJson(stringifyJson(selectedNode.config));
                            setConfigJsonDirty(false);
                            setInspectorTab("json");
                          }}
                        >
                          Edit JSON config
                        </Button>
                      </AdvancedSection>
                    </>
                  )}
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
