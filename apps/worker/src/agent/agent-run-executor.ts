import type { WorkflowNodeExecutor } from "@vespid/shared";
import { z } from "zod";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { openAiChatCompletion, type OpenAiChatMessage } from "./openai.js";
import { resolveAgentTool } from "./tools/index.js";

type AgentRunHistoryEntry =
  | {
      kind: "tool_call";
      toolId: string;
      callIndex: number;
      inputSummary?: unknown;
    }
  | {
      kind: "tool_result";
      toolId: string;
      callIndex: number;
      status: "succeeded" | "failed";
      outputSummary?: unknown;
      error?: string | null;
    };

type AgentRunRuntimeState = {
  // Persisted so retries/resumes can continue idempotently.
  toolCalls: number;
  turns: number;
  history: AgentRunHistoryEntry[];
  toolResultsByCallIndex: Record<
    string,
    { toolId: string; status: "succeeded" | "failed"; outputSummary?: unknown; error?: string | null }
  >;
  pendingToolCall?: {
    toolId: string;
    input: unknown;
    dispatchNodeId: string;
    callIndex: number;
  };
};

type WorkflowRuntime = {
  agentRuns?: Record<string, AgentRunRuntimeState>;
  pendingRemoteResult?: { requestId: string; result: unknown } | null;
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
  return { ...runtime, pendingRemoteResult: null };
}

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

function summarizeJson(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) {
      return value;
    }
    return {
      truncated: true,
      preview: json.slice(0, maxChars),
      originalLength: json.length,
    };
  } catch {
    return {
      truncated: true,
      preview: String(value).slice(0, maxChars),
      originalLength: null,
    };
  }
}

function extractJsonObjectCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence && typeof fence[1] === "string") {
    return fence[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return null;
}

function parseEnvelope(raw: string): { ok: true; value: any } | { ok: false; error: string } {
  const direct = raw.trim();
  const candidates = [direct, extractJsonObjectCandidate(direct)].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const obj = parsed as any;
      if (typeof obj.type !== "string" || obj.type.trim().length === 0) {
        continue;
      }
      return { ok: true, value: obj };
    } catch {
      // continue
    }
  }

  return { ok: false, error: "INVALID_AGENT_OUTPUT" };
}

function parseShellRunEnabled(settings: unknown): boolean {
  const root = asObject(settings);
  const tools = root ? asObject(root.tools) : null;
  return Boolean(tools && typeof tools.shellRunEnabled === "boolean" ? tools.shellRunEnabled : false);
}

function trimAgentState(state: AgentRunRuntimeState, maxChars: number): { state: AgentRunRuntimeState; trimmed: boolean } {
  let trimmed = false;
  const next: AgentRunRuntimeState = {
    ...state,
    history: [...(state.history ?? [])],
    toolResultsByCallIndex: { ...(state.toolResultsByCallIndex ?? {}) },
  };

  // Ensure JSON serializable and bounded. Drop oldest history entries until within budget.
  for (let i = 0; i < 10_000; i += 1) {
    let size = 0;
    try {
      size = JSON.stringify(next).length;
    } catch {
      // If somehow not serializable, aggressively drop history and tool results.
      next.history = [];
      next.toolResultsByCallIndex = {};
      trimmed = true;
      break;
    }

    if (size <= maxChars) {
      break;
    }

    if (next.history.length === 0) {
      break;
    }

    next.history.shift();
    trimmed = true;

    const keep = new Set<number>();
    for (const entry of next.history) {
      keep.add(entry.callIndex);
    }
    if (next.pendingToolCall) {
      keep.add(next.pendingToolCall.callIndex);
    }

    for (const k of Object.keys(next.toolResultsByCallIndex ?? {})) {
      const idx = Number(k);
      if (!Number.isFinite(idx) || !keep.has(idx)) {
        delete (next.toolResultsByCallIndex as any)[k];
      }
    }
  }

  return { state: next, trimmed };
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
      allow: z.array(z.string().min(1)),
      execution: z.enum(["cloud", "node"]).default("cloud"),
      authDefaults: z
        .object({
          connectors: z.record(z.string().min(1).max(80), z.object({ secretId: z.string().uuid() })).optional(),
        })
        .optional(),
    }),
    limits: z.object({
      maxTurns: z.number().int().min(1).max(64).default(8),
      maxToolCalls: z.number().int().min(0).max(200).default(20),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).default(60_000),
      maxOutputChars: z.number().int().min(256).max(1_000_000).default(50_000),
      maxRuntimeChars: z.number().int().min(1024).max(2_000_000).default(200_000),
    }),
    output: z.object({
      mode: z.enum(["text", "json"]).default("text"),
      jsonSchema: z.unknown().optional(),
    }),
  }),
});

export function createAgentRunExecutor(input: {
  githubApiBaseUrl: string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}): WorkflowNodeExecutor {
  const fetchImpl = input.fetchImpl ?? fetch;
  const ajv = new (Ajv as any)({ allErrors: true, strict: false }) as { compile: (schema: any) => ValidateFunction };

  // Cache compiled validators by stable string key (per worker process).
  const jsonSchemaValidateCache = new Map<string, ValidateFunction>();

  function compileJsonSchema(schema: unknown): { ok: true; validate: ValidateFunction } | { ok: false; error: string } {
    const key = (() => {
      try {
        return JSON.stringify(schema);
      } catch {
        return null;
      }
    })();
    if (!key) {
      return { ok: false, error: "INVALID_JSON_SCHEMA" };
    }

    const cached = jsonSchemaValidateCache.get(key);
    if (cached) {
      return { ok: true, validate: cached };
    }

    try {
      const validate = ajv.compile(schema as any);
      jsonSchemaValidateCache.set(key, validate);
      return { ok: true, validate };
    } catch {
      return { ok: false, error: "INVALID_JSON_SCHEMA" };
    }
  }

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
      const state: AgentRunRuntimeState = prior
        ? {
            toolCalls: prior.toolCalls ?? 0,
            turns: prior.turns ?? 0,
            history: Array.isArray(prior.history) ? prior.history : [],
            toolResultsByCallIndex: prior.toolResultsByCallIndex ?? {},
            ...(prior.pendingToolCall ? { pendingToolCall: prior.pendingToolCall } : {}),
          }
        : { toolCalls: 0, turns: 0, history: [], toolResultsByCallIndex: {} };

      const allowedTools = new Set(node.config.tools.allow);
      const toolMode = node.config.tools.execution;
      const shellRunEnabled = parseShellRunEnabled(context.organizationSettings);

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

      let nextRuntime: WorkflowRuntime = runtime;

      async function persistState(options?: { checkpoint?: boolean }) {
        const trimmed = trimAgentState(state, node.config.limits.maxRuntimeChars);
        if (trimmed.trimmed) {
          state.history = trimmed.state.history;
          state.toolResultsByCallIndex = trimmed.state.toolResultsByCallIndex;
          if (trimmed.state.pendingToolCall) {
            state.pendingToolCall = trimmed.state.pendingToolCall;
          } else {
            delete state.pendingToolCall;
          }
          await context.emitEvent?.({
            eventType: "agent_runtime_trimmed",
            level: "warn",
            payload: { maxRuntimeChars: node.config.limits.maxRuntimeChars },
          });
        }

        nextRuntime = setAgentRunState(nextRuntime, node.id, { ...state });

        if (options?.checkpoint) {
          await context.checkpointRuntime?.(nextRuntime);
        }
      }

      const messages: OpenAiChatMessage[] = [
        { role: "system", content: baseSystem },
        { role: "user", content: baseUser },
      ];

      // Rebuild context from persisted tool history.
      for (const entry of state.history) {
        if (entry.kind === "tool_call") {
          messages.push({
            role: "assistant",
            content: JSON.stringify({ type: "tool_call", toolId: entry.toolId, input: entry.inputSummary ?? null }),
          });
        } else {
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_result",
              toolId: entry.toolId,
              callIndex: entry.callIndex,
              status: entry.status,
              ...(entry.status === "failed" ? { error: entry.error ?? "TOOL_FAILED" } : {}),
              output: entry.outputSummary ?? null,
            }),
          });
        }
      }

      // Resume after remote tool execution: attach pending tool result if present.
      const pendingRemote = context.pendingRemoteResult ? (context.pendingRemoteResult as any) : null;
      if (pendingRemote) {
        if (!state.pendingToolCall) {
          return { status: "failed", error: "REMOTE_RESULT_UNEXPECTED" };
        }

        const pending = state.pendingToolCall;
        const remoteStatus = typeof pendingRemote?.status === "string" ? pendingRemote.status : "succeeded";
        const toolStatus: "succeeded" | "failed" = remoteStatus === "failed" ? "failed" : "succeeded";

        const outputSummary = summarizeJson(pendingRemote?.output ?? null, 20_000);
        const error = toolStatus === "failed" ? String(pendingRemote?.error ?? "REMOTE_EXEC_FAILED") : null;

        state.history.push({
          kind: "tool_result",
          toolId: pending.toolId,
          callIndex: pending.callIndex,
          status: toolStatus,
          outputSummary,
          error,
        });
        state.toolResultsByCallIndex = state.toolResultsByCallIndex ?? {};
        state.toolResultsByCallIndex[String(pending.callIndex)] = {
          toolId: pending.toolId,
          status: toolStatus,
          outputSummary,
          error,
        };

        messages.push({
          role: "user",
          content: JSON.stringify({
            type: "tool_result",
            toolId: pending.toolId,
            callIndex: pending.callIndex,
            status: toolStatus,
            ...(toolStatus === "failed" ? { error } : {}),
            output: outputSummary,
          }),
        });

        await context.emitEvent?.({
          eventType: "agent_tool_result",
          level: toolStatus === "failed" ? "warn" : "info",
          payload: {
            toolId: pending.toolId,
            callIndex: pending.callIndex,
            status: toolStatus,
            ...(toolStatus === "failed" ? { error } : {}),
          },
        });

        // Clear remote result + pending state.
        nextRuntime = clearPendingRemoteResult(nextRuntime);
        delete state.pendingToolCall;

        await persistState({ checkpoint: true });
      }

      for (;;) {
        if (Date.now() >= deadline) {
          return { status: "failed", error: "LLM_TIMEOUT", runtime: setAgentRunState(nextRuntime, node.id, { ...state }) };
        }
        if (state.turns >= node.config.limits.maxTurns) {
          return {
            status: "failed",
            error: "AGENT_MAX_TURNS",
            runtime: setAgentRunState(nextRuntime, node.id, { ...state }),
          };
        }

        state.turns += 1;
        await context.emitEvent?.({
          eventType: "agent_turn_started",
          level: "info",
          payload: { turn: state.turns },
        });

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

        await context.emitEvent?.({
          eventType: "agent_llm_request",
          level: "info",
          payload: {
            model: node.config.llm.model,
            turn: state.turns,
            messageCount: messages.length,
            messageSizes: messages.map((m) => m.content.length),
          },
        });

        const llm = await openAiChatCompletion({
          apiKey,
          model: node.config.llm.model,
          messages,
          timeoutMs: Math.max(1000, deadline - Date.now()),
          maxOutputChars: node.config.limits.maxOutputChars,
          fetchImpl,
        });

        if (!llm.ok) {
          return { status: "failed", error: llm.error };
        }

        const content = safeTruncate(llm.content.trim(), node.config.limits.maxOutputChars);
        await context.emitEvent?.({
          eventType: "agent_llm_response",
          level: "info",
          payload: { turn: state.turns, content: safeTruncate(content, 4000) },
        });

        messages.push({ role: "assistant", content });

        const envelope = parseEnvelope(content);
        if (!envelope.ok) {
          return { status: "failed", error: envelope.error };
        }

        const type = envelope.value.type;
        if (type === "final") {
          const output = envelope.value.output;

          if (node.config.output.mode === "json") {
            try {
              JSON.stringify(output);
            } catch {
              return { status: "failed", error: "INVALID_AGENT_JSON_OUTPUT" };
            }

            if (node.config.output.jsonSchema !== undefined) {
              const compiled = compileJsonSchema(node.config.output.jsonSchema);
              if (!compiled.ok) {
                return { status: "failed", error: compiled.error };
              }
              const ok = Boolean(compiled.validate(output));
              if (!ok) {
                await context.emitEvent?.({
                  eventType: "agent_json_schema_validation_failed",
                  level: "warn",
                  payload: summarizeJson(compiled.validate.errors ?? null, 10_000),
                });
                return { status: "failed", error: "INVALID_AGENT_JSON_OUTPUT" };
              }
            }
          }

          return {
            status: "succeeded",
            output,
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

        const callIndex = state.toolCalls + 1;
        state.toolCalls = callIndex;

        await context.emitEvent?.({
          eventType: "agent_tool_call",
          level: "info",
          payload: { toolId, callIndex, input: summarizeJson(toolInput, 4000) },
        });

        state.history.push({
          kind: "tool_call",
          toolId,
          callIndex,
          inputSummary: summarizeJson(toolInput, 4000),
        });

        await persistState();

        const cachedResult = state.toolResultsByCallIndex?.[String(callIndex)] ?? null;
        if (cachedResult) {
          const cachedStatus = cachedResult.status;
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_result",
              toolId,
              callIndex,
              status: cachedStatus,
              ...(cachedStatus === "failed" ? { error: cachedResult.error ?? "TOOL_FAILED" } : {}),
              output: cachedResult.outputSummary ?? null,
            }),
          });
          state.history.push({
            kind: "tool_result",
            toolId,
            callIndex,
            status: cachedStatus,
            outputSummary: cachedResult.outputSummary ?? null,
            error: cachedResult.error ?? null,
          });
          continue;
        }

        if (toolId === "shell.run" && !shellRunEnabled) {
          await context.emitEvent?.({
            eventType: "agent_tool_result",
            level: "warn",
            payload: { toolId, callIndex, status: "failed", error: "TOOL_POLICY_DENIED:shell.run" },
          });
          return { status: "failed", error: "TOOL_POLICY_DENIED:shell.run" };
        }

        const resolved = resolveAgentTool(toolId);
        if (!resolved) {
          return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
        }

        const mergedArgs = { ...resolved.args, ...(toolInput as Record<string, unknown>) };
        const toolAuthDefaults =
          node.config.tools.authDefaults?.connectors ? { connectors: node.config.tools.authDefaults.connectors } : null;
        const toolCtx = {
          organizationId: context.organizationId,
          userId: context.requestedByUserId,
          runId: context.runId,
          workflowId: context.workflowId,
          attemptCount: context.attemptCount,
          nodeId: node.id,
          toolAuthDefaults,
          githubApiBaseUrl: input.githubApiBaseUrl,
          loadSecretValue: input.loadSecretValue,
          fetchImpl,
        };

        const toolResult = await resolved.tool.execute(toolCtx, { mode: toolMode, args: mergedArgs });

        if (toolResult.status === "blocked") {
          // Make gateway request IDs unique per tool call within a node.
          const dispatchNodeId = `${node.id}:tool:${callIndex}`;
          state.pendingToolCall = { toolId, input: toolInput, dispatchNodeId, callIndex };
          await persistState({ checkpoint: true });

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
            runtime: setAgentRunState(nextRuntime, node.id, { ...state }),
          };
        }

        const outputSummary = summarizeJson(toolResult.output ?? null, 20_000);
        const status: "succeeded" | "failed" = toolResult.status === "failed" ? "failed" : "succeeded";
        const error = toolResult.status === "failed" ? toolResult.error : null;

        state.toolResultsByCallIndex = state.toolResultsByCallIndex ?? {};
        state.toolResultsByCallIndex[String(callIndex)] = { toolId, status, outputSummary, error };

        state.history.push({
          kind: "tool_result",
          toolId,
          callIndex,
          status,
          outputSummary,
          error,
        });

        await context.emitEvent?.({
          eventType: "agent_tool_result",
          level: status === "failed" ? "warn" : "info",
          payload: {
            toolId,
            callIndex,
            status,
            ...(status === "failed" ? { error } : {}),
          },
        });

        messages.push({
          role: "user",
          content: JSON.stringify({
            type: "tool_result",
            toolId,
            callIndex,
            status,
            ...(status === "failed" ? { error } : {}),
            output: outputSummary,
          }),
        });

        await persistState({ checkpoint: true });
      }
    },
  };
}
