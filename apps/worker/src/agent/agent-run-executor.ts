import type { WorkflowNodeExecutor } from "@vespid/shared";
import { z } from "zod";
import { openAiChatCompletion, type OpenAiChatMessage } from "./openai.js";
import { resolveAgentTool } from "./tools/index.js";

type AgentRunRuntimeState = {
  pendingToolCall?: {
    toolId: string;
    input: unknown;
    dispatchNodeId: string;
  };
  toolCalls: number;
  turns: number;
};

type WorkflowRuntime = {
  agentRuns?: Record<string, AgentRunRuntimeState>;
  pendingRemoteResult?: { requestId: string; result: unknown };
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseRuntime(value: unknown): WorkflowRuntime {
  const obj = asObject(value);
  if (!obj) {
    return {};
  }
  return obj as WorkflowRuntime;
}

function setAgentRunState(runtime: WorkflowRuntime, nodeId: string, state: AgentRunRuntimeState | null): WorkflowRuntime {
  const next: WorkflowRuntime = { ...runtime };
  const agentRuns = { ...(runtime.agentRuns ?? {}) };
  if (state) {
    agentRuns[nodeId] = state;
  } else {
    delete agentRuns[nodeId];
  }
  next.agentRuns = agentRuns;
  return next;
}

function clearPendingRemoteResult(runtime: WorkflowRuntime): WorkflowRuntime {
  return { ...runtime, pendingRemoteResult: null as any };
}

const agentRunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent.run"),
  config: z.object({
    llm: z.object({
      provider: z.literal("openai"),
      model: z.string().min(1),
      auth: z.object({
        secretId: z.string().uuid().optional(),
        fallbackToEnv: z.literal(true).optional(),
      }),
    }),
    prompt: z.object({
      system: z.string().optional(),
      instructions: z.string().min(1),
      inputTemplate: z.string().optional(),
    }),
    tools: z.object({
      allow: z.array(z.string().min(1)).min(1),
      execution: z.enum(["cloud", "node"]).default("cloud"),
    }),
    limits: z.object({
      maxTurns: z.number().int().min(1).max(64).default(8),
      maxToolCalls: z.number().int().min(0).max(200).default(20),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).default(60_000),
      maxOutputChars: z.number().int().min(256).max(1_000_000).default(50_000),
    }),
    output: z.object({
      mode: z.enum(["text", "json"]).default("text"),
      jsonSchema: z.unknown().optional(),
    }),
  }),
});

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  // Minimal templating: replace {{key}} with JSON-serialized values.
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const value = vars[key];
    try {
      return value === undefined ? "" : JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

function safeTruncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function strictParseEnvelope(raw: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "INVALID_AGENT_OUTPUT" };
    }
    return { ok: true, value: parsed as any };
  } catch {
    return { ok: false, error: "INVALID_AGENT_OUTPUT" };
  }
}

export function createAgentRunExecutor(input: {
  githubApiBaseUrl: string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    nodeType: "agent.run",
    async execute(context) {
      const nodeParsed = agentRunNodeSchema.safeParse(context.node);
      if (!nodeParsed.success) {
        return { status: "failed", error: "INVALID_NODE_CONFIG" };
      }

      const node = nodeParsed.data;
      const deadline = Date.now() + node.config.limits.timeoutMs;

      const runtime = parseRuntime(context.runtime);
      const prior = runtime.agentRuns?.[node.id] ?? null;
      const state: AgentRunRuntimeState = prior ? { ...prior } : { toolCalls: 0, turns: 0 };

      const allowedTools = new Set(node.config.tools.allow);
      const toolMode = node.config.tools.execution;

      const baseSystem = [
        node.config.prompt.system ? node.config.prompt.system : null,
        "You are a workflow agent node in Vespid.",
        "You MUST respond with a single JSON object and nothing else.",
        "Valid response envelopes:",
        '1) {"type":"final","output":<any>}',
        '2) {"type":"tool_call","toolId":"<toolId>","input":<object>}',
        `Allowed toolIds: ${JSON.stringify([...allowedTools.values()])}`,
      ]
        .filter(Boolean)
        .join("\n");

      const steps = Array.isArray(context.steps) ? context.steps : [];

      const renderedTemplate = node.config.prompt.inputTemplate
        ? renderTemplate(node.config.prompt.inputTemplate, {
            runInput: context.runInput ?? null,
            steps,
          })
        : null;

      const baseUser = [
        JSON.stringify(
          {
            instructions: node.config.prompt.instructions,
            runInput: context.runInput ?? null,
            steps,
          },
          null,
          2
        ),
        renderedTemplate ? "\n\n" + renderedTemplate : null,
      ]
        .filter(Boolean)
        .join("");

      const messages: OpenAiChatMessage[] = [
        { role: "system", content: baseSystem },
        { role: "user", content: baseUser },
      ];

      // Resume after remote tool execution: attach pending tool result if present.
      const pendingRemote = context.pendingRemoteResult ? (context.pendingRemoteResult as any) : null;
      if (pendingRemote) {
        if (!state.pendingToolCall) {
          return { status: "failed", error: "REMOTE_RESULT_UNEXPECTED" };
        }
        messages.push({
          role: "assistant",
          content: JSON.stringify({ type: "tool_call", toolId: state.pendingToolCall.toolId, input: state.pendingToolCall.input }),
        });
        messages.push({
          role: "user",
          content: JSON.stringify({ type: "tool_result", toolId: state.pendingToolCall.toolId, result: pendingRemote }),
        });
      }

      // If we resumed, clear pending state up-front. The agent decides what to do next.
      let nextRuntime: WorkflowRuntime = runtime;
      if (pendingRemote && state.pendingToolCall) {
        nextRuntime = clearPendingRemoteResult(nextRuntime);
        delete state.pendingToolCall;
        nextRuntime = setAgentRunState(nextRuntime, node.id, { ...state });
      }

      for (;;) {
        if (Date.now() >= deadline) {
          return { status: "failed", error: "LLM_TIMEOUT" };
        }
        if (state.turns >= node.config.limits.maxTurns) {
          return { status: "failed", error: "AGENT_MAX_TURNS" };
        }

        state.turns += 1;

        const apiKey =
          node.config.llm.auth.secretId
            ? await input.loadSecretValue({
                organizationId: context.organizationId,
                userId: context.requestedByUserId,
                secretId: node.config.llm.auth.secretId,
              })
            : process.env.OPENAI_API_KEY ?? null;

        if (!apiKey || apiKey.trim().length === 0) {
          return { status: "failed", error: "LLM_AUTH_NOT_CONFIGURED" };
        }

        const llm = await openAiChatCompletion({
          apiKey,
          model: node.config.llm.model,
          messages,
          timeoutMs: Math.max(1000, deadline - Date.now()),
          fetchImpl,
        });

        if (!llm.ok) {
          return { status: "failed", error: llm.error };
        }

        const content = safeTruncate(llm.content.trim(), node.config.limits.maxOutputChars);
        messages.push({ role: "assistant", content });

        const envelope = strictParseEnvelope(content);
        if (!envelope.ok) {
          return { status: "failed", error: envelope.error };
        }

        const type = envelope.value.type;
        if (type === "final") {
          return {
            status: "succeeded",
            output: envelope.value.output,
            runtime: setAgentRunState(nextRuntime, node.id, null),
          };
        }

        if (type !== "tool_call") {
          return { status: "failed", error: "INVALID_AGENT_OUTPUT" };
        }

        const toolId = envelope.value.toolId;
        const toolInput = envelope.value.input;
        if (typeof toolId !== "string" || toolId.trim().length === 0) {
          return { status: "failed", error: "INVALID_AGENT_OUTPUT" };
        }
        if (!allowedTools.has(toolId)) {
          return { status: "failed", error: `TOOL_NOT_ALLOWED:${toolId}` };
        }
        if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
          return { status: "failed", error: "INVALID_TOOL_INPUT" };
        }

        if (state.toolCalls >= node.config.limits.maxToolCalls) {
          return { status: "failed", error: "AGENT_MAX_TOOL_CALLS" };
        }

        const resolved = resolveAgentTool(toolId);
        if (!resolved) {
          return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
        }

        const mergedArgs = { ...resolved.args, ...(toolInput as Record<string, unknown>) };
        const toolCtx = {
          organizationId: context.organizationId,
          userId: context.requestedByUserId,
          runId: context.runId,
          workflowId: context.workflowId,
          attemptCount: context.attemptCount,
          nodeId: node.id,
          githubApiBaseUrl: input.githubApiBaseUrl,
          loadSecretValue: input.loadSecretValue,
          fetchImpl,
        };

        const toolResult = await resolved.tool.execute(toolCtx, { mode: toolMode, args: mergedArgs });
        state.toolCalls += 1;

        if (toolResult.status === "blocked") {
          // Make gateway request IDs unique per tool call within a node.
          const dispatchNodeId = `${node.id}:tool:${state.toolCalls}`;
          const pendingToolCall = { toolId, input: toolInput, dispatchNodeId };

          nextRuntime = setAgentRunState(nextRuntime, node.id, {
            ...state,
            pendingToolCall,
          });

          let payload = toolResult.block.payload;
          if (toolResult.block.kind === "agent.execute") {
            const obj = asObject(payload);
            if (obj && typeof obj.nodeId === "string") {
              obj.nodeId = dispatchNodeId;
            }
            const nodeObj = obj && asObject(obj.node);
            if (nodeObj && typeof nodeObj.id === "string") {
              nodeObj.id = dispatchNodeId;
            }
            payload = obj ?? payload;
          }

          return {
            status: "blocked",
            block: {
              ...toolResult.block,
              payload,
              dispatchNodeId,
            },
            runtime: nextRuntime,
          };
        }

        if (toolResult.status === "failed") {
          messages.push({
            role: "user",
            content: JSON.stringify({ type: "tool_result", toolId, status: "failed", error: toolResult.error, output: toolResult.output ?? null }),
          });
          continue;
        }

        messages.push({
          role: "user",
          content: JSON.stringify({ type: "tool_result", toolId, status: "succeeded", output: toolResult.output ?? null }),
        });
      }
    },
  };
}
