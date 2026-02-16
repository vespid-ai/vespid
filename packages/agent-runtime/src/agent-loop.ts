import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import type { WorkflowNodeExecutorResult } from "@vespid/shared";
import { z } from "zod";
import type { OpenAiChatMessage } from "./openai.js";
import { openAiChatCompletion } from "./openai.js";
import { anthropicChatCompletion } from "./anthropic.js";
import { geminiGenerateContent } from "./gemini.js";
import { vertexGenerateContent } from "./vertex.js";
import { resolveAgentTool } from "./tools/index.js";
import type { AgentToolExecutionMode } from "./tools/types.js";

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

export type AgentTeamMeta = {
  teammateId: string;
  parentNodeId: string;
  parentCallIndex: number;
};

export type AgentLoopConfig = {
  llm: { provider: "openai" | "anthropic" | "gemini" | "vertex"; model: string; auth: { secretId?: string; fallbackToEnv?: true } };
  prompt: { system?: string; instructions: string; inputTemplate?: string };
  tools: {
    allow: string[];
    execution: AgentToolExecutionMode;
    authDefaults?: { connectors?: Record<string, { secretId: string }> };
  };
  limits: {
    maxTurns: number;
    maxToolCalls: number;
    timeoutMs: number;
    maxOutputChars: number;
    maxRuntimeChars: number;
  };
  output: { mode: "text" | "json"; jsonSchema?: unknown };
};

export type AgentLoopInput = {
  organizationId: string;
  workflowId: string;
  runId: string;
  attemptCount: number;
  requestedByUserId: string;
  nodeId: string;
  nodeType: string;
  runInput?: unknown;
  steps?: unknown;
  organizationSettings?: unknown;
  runtime?: unknown;
  pendingRemoteResult?: unknown;
  githubApiBaseUrl: string;
  loadSecretValue: (input: { organizationId: string; userId: string; secretId: string }) => Promise<string>;
  fetchImpl: typeof fetch;
  config: AgentLoopConfig;
  managedCredits?: {
    ensureAvailable: (input: { minCredits: number }) => Promise<boolean>;
    charge: (input: {
      credits: number;
      inputTokens: number;
      outputTokens: number;
      provider: AgentLoopConfig["llm"]["provider"];
      model: string;
      turn: number;
    }) => Promise<void>;
  } | null;
  // When set, the loop persists state under runtime.agentRuns[persistNodeId].
  persistNodeId?: string | null;
  // When false, any tool that returns status:"blocked" fails the loop.
  allowRemoteBlocked?: boolean;
  emitEvent?: (event: {
    eventType: string;
    level: "info" | "warn" | "error";
    message?: string | null;
    payload?: unknown;
  }) => Promise<void>;
  checkpointRuntime?: (runtime: unknown) => Promise<void>;
  teamMeta?: AgentTeamMeta;
  // Optional team configuration passed through to tools like team.delegate/team.map.
  teamConfig?: unknown;
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

const ajv = new (Ajv as any)({ allErrors: true, strict: false }) as { compile: (schema: any) => ValidateFunction };
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

type ResolvedLlmAuth =
  | { kind: "api_key"; apiKey: string }
  | { kind: "vertex_oauth"; refreshToken: string; projectId: string; location: string };

async function resolveLlmAuth(input: {
  llm: AgentLoopConfig["llm"];
  organizationId: string;
  userId: string;
  loadSecretValue: AgentLoopInput["loadSecretValue"];
}): Promise<ResolvedLlmAuth | null> {
  if (input.llm.provider === "vertex") {
    if (!input.llm.auth.secretId) {
      return null;
    }
    const raw = await input.loadSecretValue({
      organizationId: input.organizationId,
      userId: input.userId,
      secretId: input.llm.auth.secretId,
    });
    try {
      const parsed = z
        .object({
          refreshToken: z.string().min(1),
          projectId: z.string().min(1),
          location: z.string().min(1),
        })
        .safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return null;
      }
      return {
        kind: "vertex_oauth",
        refreshToken: parsed.data.refreshToken,
        projectId: parsed.data.projectId,
        location: parsed.data.location,
      };
    } catch {
      return null;
    }
  }

  if (input.llm.auth.secretId) {
    const value = await input.loadSecretValue({
      organizationId: input.organizationId,
      userId: input.userId,
      secretId: input.llm.auth.secretId,
    });
    const apiKey = value && value.trim().length > 0 ? value : null;
    return apiKey ? { kind: "api_key", apiKey } : null;
  }

  const env =
    input.llm.provider === "anthropic"
      ? (process.env.ANTHROPIC_API_KEY ?? null)
      : input.llm.provider === "gemini"
        ? (process.env.GEMINI_API_KEY ?? null)
        : (process.env.OPENAI_API_KEY ?? null);
  const apiKey = env && env.trim().length > 0 ? env : null;
  return apiKey ? { kind: "api_key", apiKey } : null;
}

export async function runAgentLoop(input: AgentLoopInput): Promise<WorkflowNodeExecutorResult> {
  const deadline = Date.now() + input.config.limits.timeoutMs;
  const allowRemoteBlocked = input.allowRemoteBlocked !== false;

  const runtime = parseRuntime(input.runtime);
  const persistedNodeId = input.persistNodeId ?? null;
  const prior = persistedNodeId ? runtime.agentRuns?.[persistedNodeId] ?? null : null;
  const state: AgentRunRuntimeState = prior
    ? {
        toolCalls: prior.toolCalls ?? 0,
        turns: prior.turns ?? 0,
        history: Array.isArray(prior.history) ? prior.history : [],
        toolResultsByCallIndex: prior.toolResultsByCallIndex ?? {},
        ...(prior.pendingToolCall ? { pendingToolCall: prior.pendingToolCall } : {}),
      }
    : { toolCalls: 0, turns: 0, history: [], toolResultsByCallIndex: {} };

  const allowedTools = new Set(input.config.tools.allow);
  const toolMode = input.config.tools.execution;
  const shellRunEnabled = parseShellRunEnabled(input.organizationSettings);

  const baseSystem = [
    input.config.prompt.system ? input.config.prompt.system : null,
    "You are a workflow agent node in Vespid.",
    "You MUST respond with a single JSON object and nothing else.",
    "Valid response envelopes:",
    '1) {"type":"final","output":<any>}',
    '2) {"type":"tool_call","toolId":"<toolId>","input":<object>}',
    `Allowed toolIds: ${JSON.stringify([...allowedTools.values()])}`,
  ]
    .filter(Boolean)
    .join("\n");

  const steps = Array.isArray(input.steps) ? (input.steps as unknown[]) : [];
  const renderedTemplate = input.config.prompt.inputTemplate
    ? renderTemplate(input.config.prompt.inputTemplate, {
        runInput: input.runInput ?? null,
        steps,
      })
    : null;

  const baseUser = [
    JSON.stringify(
      {
        instructions: input.config.prompt.instructions,
        runInput: input.runInput ?? null,
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

  let nextRuntime: WorkflowRuntime = runtime;

  async function persistState(options?: { checkpoint?: boolean }) {
    if (!persistedNodeId) {
      return;
    }

    const trimmed = trimAgentState(state, input.config.limits.maxRuntimeChars);
    if (trimmed.trimmed) {
      state.history = trimmed.state.history;
      state.toolResultsByCallIndex = trimmed.state.toolResultsByCallIndex;
      if (trimmed.state.pendingToolCall) {
        state.pendingToolCall = trimmed.state.pendingToolCall;
      } else {
        delete state.pendingToolCall;
      }
      await input.emitEvent?.({
        eventType: "agent_runtime_trimmed",
        level: "warn",
        payload: { maxRuntimeChars: input.config.limits.maxRuntimeChars, ...(input.teamMeta ? { team: input.teamMeta } : {}) },
      });
    }

    nextRuntime = setAgentRunState(nextRuntime, persistedNodeId, { ...state });

    if (options?.checkpoint) {
      await input.checkpointRuntime?.(nextRuntime);
    }
  }

  // Resume after remote tool execution.
  const pendingRemote = input.pendingRemoteResult ? (input.pendingRemoteResult as any) : null;
  if (pendingRemote) {
    const remote = pendingRemote && typeof pendingRemote === "object" && "result" in pendingRemote ? (pendingRemote as any).result : pendingRemote;
    if (!state.pendingToolCall) {
      return { status: "failed", error: "REMOTE_RESULT_UNEXPECTED" };
    }

    const pending = state.pendingToolCall;
    const remoteStatus = typeof remote?.status === "string" ? remote.status : "succeeded";
    const toolStatus: "succeeded" | "failed" = remoteStatus === "failed" ? "failed" : "succeeded";

    const outputSummary = summarizeJson(remote?.output ?? null, 20_000);
    const error = toolStatus === "failed" ? String(remote?.error ?? "REMOTE_EXEC_FAILED") : null;

    state.history.push({
      kind: "tool_result",
      toolId: pending.toolId,
      callIndex: pending.callIndex,
      status: toolStatus,
      outputSummary,
      error,
    });
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

    await input.emitEvent?.({
      eventType: "agent_tool_result",
      level: toolStatus === "failed" ? "warn" : "info",
      payload: {
        toolId: pending.toolId,
        callIndex: pending.callIndex,
        status: toolStatus,
        ...(toolStatus === "failed" ? { error } : {}),
        ...(input.teamMeta ? { team: input.teamMeta } : {}),
      },
    });

    nextRuntime = clearPendingRemoteResult(nextRuntime);
    delete state.pendingToolCall;
    await persistState({ checkpoint: true });
  }

  const llmAuth = await resolveLlmAuth({
    llm: input.config.llm,
    organizationId: input.organizationId,
    userId: input.requestedByUserId,
    loadSecretValue: input.loadSecretValue,
  });
  if (!llmAuth) {
    return { status: "failed", error: "LLM_AUTH_NOT_CONFIGURED" };
  }

  const usesManagedCredits = input.config.llm.provider !== "vertex" && !input.config.llm.auth.secretId && Boolean(input.managedCredits);

  for (;;) {
    if (Date.now() >= deadline) {
      await persistState();
      return { status: "failed", error: "LLM_TIMEOUT", runtime: persistedNodeId ? setAgentRunState(nextRuntime, persistedNodeId, { ...state }) : undefined };
    }
    if (state.turns >= input.config.limits.maxTurns) {
      await persistState();
      return {
        status: "failed",
        error: "AGENT_MAX_TURNS",
        runtime: persistedNodeId ? setAgentRunState(nextRuntime, persistedNodeId, { ...state }) : undefined,
      };
    }

    state.turns += 1;
    await input.emitEvent?.({
      eventType: "agent_turn_started",
      level: "info",
      payload: { turn: state.turns, ...(input.teamMeta ? { team: input.teamMeta } : {}) },
    });

    if (usesManagedCredits && input.managedCredits) {
      const ok = await input.managedCredits.ensureAvailable({ minCredits: 1 });
      if (!ok) {
        await persistState();
        return {
          status: "failed",
          error: "CREDITS_EXHAUSTED",
          runtime: persistedNodeId ? setAgentRunState(nextRuntime, persistedNodeId, { ...state }) : undefined,
        };
      }
    }

    await input.emitEvent?.({
      eventType: "agent_llm_request",
      level: "info",
      payload: {
        provider: input.config.llm.provider,
        model: input.config.llm.model,
        turn: state.turns,
        messageCount: messages.length,
        messageSizes: messages.map((m) => m.content.length),
        ...(input.teamMeta ? { team: input.teamMeta } : {}),
      },
      });

    const llm = await (async () => {
      const timeoutMs = Math.max(1000, deadline - Date.now());

      if (input.config.llm.provider === "vertex") {
        if (llmAuth.kind !== "vertex_oauth") {
          return { ok: false as const, error: "LLM_AUTH_NOT_CONFIGURED" };
        }
        return vertexGenerateContent({
          refreshToken: llmAuth.refreshToken,
          projectId: llmAuth.projectId,
          location: llmAuth.location,
          model: input.config.llm.model,
          messages: messages as any,
          timeoutMs,
          maxOutputChars: input.config.limits.maxOutputChars,
          fetchImpl: input.fetchImpl,
        });
      }

      if (llmAuth.kind !== "api_key") {
        return { ok: false as const, error: "LLM_AUTH_NOT_CONFIGURED" };
      }

      if (input.config.llm.provider === "anthropic") {
        return anthropicChatCompletion({
          apiKey: llmAuth.apiKey,
          model: input.config.llm.model,
          messages,
          timeoutMs,
          maxOutputChars: input.config.limits.maxOutputChars,
          fetchImpl: input.fetchImpl,
        });
      }

      if (input.config.llm.provider === "gemini") {
        return geminiGenerateContent({
          apiKey: llmAuth.apiKey,
          model: input.config.llm.model,
          messages: messages as any,
          timeoutMs,
          maxOutputChars: input.config.limits.maxOutputChars,
          fetchImpl: input.fetchImpl,
        });
      }

      return openAiChatCompletion({
        apiKey: llmAuth.apiKey,
        model: input.config.llm.model,
        messages,
        timeoutMs,
        maxOutputChars: input.config.limits.maxOutputChars,
        fetchImpl: input.fetchImpl,
      });
    })();

    if (!llm.ok) {
      await persistState();
      return { status: "failed", error: llm.error };
    }

    if (usesManagedCredits && input.managedCredits) {
      const inputTokens = llm.usage?.inputTokens ?? 0;
      const outputTokens = llm.usage?.outputTokens ?? 0;
      const credits = Math.max(1, Math.ceil((inputTokens + outputTokens) / 1000));
      try {
        await input.managedCredits.charge({
          credits,
          inputTokens,
          outputTokens,
          provider: input.config.llm.provider,
          model: input.config.llm.model,
          turn: state.turns,
        });
      } catch {
        await input.emitEvent?.({
          eventType: "agent_credits_charge_failed",
          level: "warn",
          payload: { turn: state.turns, credits, ...(input.teamMeta ? { team: input.teamMeta } : {}) },
        });
      }
    }

    const content = safeTruncate(llm.content.trim(), input.config.limits.maxOutputChars);
    await input.emitEvent?.({
      eventType: "agent_llm_response",
      level: "info",
      payload: { turn: state.turns, content: safeTruncate(content, 4000), ...(input.teamMeta ? { team: input.teamMeta } : {}) },
    });

    messages.push({ role: "assistant", content });

    const envelope = parseEnvelope(content);
    if (!envelope.ok) {
      await persistState();
      return { status: "failed", error: envelope.error };
    }

    const type = envelope.value.type;
    if (type === "final") {
      const output = envelope.value.output;

      if (input.config.output.mode === "json") {
        try {
          JSON.stringify(output);
        } catch {
          await persistState();
          return { status: "failed", error: "INVALID_AGENT_JSON_OUTPUT" };
        }

        if (input.config.output.jsonSchema !== undefined) {
          const compiled = compileJsonSchema(input.config.output.jsonSchema);
          if (!compiled.ok) {
            await persistState();
            return { status: "failed", error: compiled.error };
          }
          const ok = Boolean(compiled.validate(output));
          if (!ok) {
                await input.emitEvent?.({
                  eventType: "agent_json_schema_validation_failed",
                  level: "warn",
                  payload: {
                    errors: summarizeJson(compiled.validate.errors ?? null, 10_000),
                    ...(input.teamMeta ? { team: input.teamMeta } : {}),
                  },
                });
                await persistState();
                return { status: "failed", error: "INVALID_AGENT_JSON_OUTPUT" };
              }
            }
      }

      return {
        status: "succeeded",
        output,
        ...(persistedNodeId ? { runtime: setAgentRunState(nextRuntime, persistedNodeId, null) } : {}),
      };
    }

    if (type !== "tool_call") {
      await persistState();
      return { status: "failed", error: "INVALID_AGENT_OUTPUT" };
    }

    const toolId = envelope.value.toolId;
    const toolInput = envelope.value.input;
    if (typeof toolId !== "string" || toolId.trim().length === 0) {
      await persistState();
      return { status: "failed", error: "INVALID_AGENT_OUTPUT" };
    }
    if (!allowedTools.has(toolId)) {
      await persistState();
      return { status: "failed", error: `TOOL_NOT_ALLOWED:${toolId}` };
    }
    if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
      await persistState();
      return { status: "failed", error: "INVALID_TOOL_INPUT" };
    }
    if (state.toolCalls >= input.config.limits.maxToolCalls) {
      await persistState();
      return { status: "failed", error: "AGENT_MAX_TOOL_CALLS" };
    }

    const callIndex = state.toolCalls + 1;
    state.toolCalls = callIndex;

    await input.emitEvent?.({
      eventType: "agent_tool_call",
      level: "info",
      payload: { toolId, callIndex, input: summarizeJson(toolInput, 4000), ...(input.teamMeta ? { team: input.teamMeta } : {}) },
    });

    state.history.push({
      kind: "tool_call",
      toolId,
      callIndex,
      inputSummary: summarizeJson(toolInput, 4000),
    });

    await persistState();

    const cachedResult = state.toolResultsByCallIndex[String(callIndex)] ?? null;
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
      await input.emitEvent?.({
        eventType: "agent_tool_result",
        level: "warn",
        payload: { toolId, callIndex, status: "failed", error: "TOOL_POLICY_DENIED:shell.run", ...(input.teamMeta ? { team: input.teamMeta } : {}) },
      });
      await persistState();
      return { status: "failed", error: "TOOL_POLICY_DENIED:shell.run" };
    }

    const resolved = resolveAgentTool(toolId);
    if (!resolved) {
      await persistState();
      return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
    }

    const mergedArgs = { ...resolved.args, ...(toolInput as Record<string, unknown>) };
    const toolAuthDefaults =
      input.config.tools.authDefaults?.connectors ? { connectors: input.config.tools.authDefaults.connectors } : null;

    const toolCtx = {
      organizationId: input.organizationId,
      userId: input.requestedByUserId,
      runId: input.runId,
      workflowId: input.workflowId,
      attemptCount: input.attemptCount,
      nodeId: input.nodeId,
      callIndex,
      toolAuthDefaults,
      githubApiBaseUrl: input.githubApiBaseUrl,
      loadSecretValue: input.loadSecretValue,
      fetchImpl: input.fetchImpl,
      emitEvent: input.emitEvent,
      teamConfig: input.teamConfig ?? null,
      managedCredits: input.managedCredits ?? null,
    };

    const toolResult = await resolved.tool.execute(toolCtx as any, { mode: toolMode, args: mergedArgs });

    if (toolResult.status === "blocked") {
      if (!allowRemoteBlocked) {
        await persistState();
        return { status: "failed", error: "TEAM_REMOTE_EXEC_NOT_SUPPORTED" };
      }

      const dispatchNodeId = `${input.nodeId}:tool:${callIndex}`;
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
        ...(persistedNodeId ? { runtime: setAgentRunState(nextRuntime, persistedNodeId, { ...state }) } : {}),
      };
    }

    const outputSummary = summarizeJson(toolResult.output ?? null, 20_000);
    const status: "succeeded" | "failed" = toolResult.status === "failed" ? "failed" : "succeeded";
    const error = toolResult.status === "failed" ? toolResult.error : null;

    state.toolResultsByCallIndex[String(callIndex)] = { toolId, status, outputSummary, error };
    state.history.push({ kind: "tool_result", toolId, callIndex, status, outputSummary, error });

    await input.emitEvent?.({
      eventType: "agent_tool_result",
      level: status === "failed" ? "warn" : "info",
      payload: { toolId, callIndex, status, ...(status === "failed" ? { error } : {}), ...(input.teamMeta ? { team: input.teamMeta } : {}) },
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
}
