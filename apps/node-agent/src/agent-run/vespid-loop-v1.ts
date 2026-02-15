import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import type { SandboxBackend } from "../sandbox/index.js";
import { loadSkillsRegistry } from "../skills/loader.js";
import { executeSkill } from "../skills/execute-skill.js";
import { openAiChatCompletion, type ChatMessage } from "./llm/openai.js";
import { anthropicChatCompletion } from "./llm/anthropic.js";
import { buildToolsetSkillsContext } from "./toolset-skills.js";

type AgentEnvelope =
  | { type: "final"; output: unknown }
  | { type: "tool_call"; toolId: string; input: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
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
  return value.length <= maxChars ? value : value.slice(0, maxChars);
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
    return { truncated: true, preview: json.slice(0, maxChars), originalLength: json.length };
  } catch {
    return { truncated: true, preview: String(value).slice(0, maxChars), originalLength: null };
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

function parseEnvelope(raw: string): { ok: true; value: AgentEnvelope } | { ok: false; error: string } {
  const direct = raw.trim();
  const candidates = [direct, extractJsonObjectCandidate(direct)].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const obj = parsed as any;
      if (obj.type === "final") {
        return { ok: true, value: { type: "final", output: obj.output } };
      }
      if (obj.type === "tool_call") {
        return { ok: true, value: { type: "tool_call", toolId: obj.toolId, input: obj.input } };
      }
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

function parseConnectorToolId(toolId: string): { connectorId: string; actionId: string } | null {
  if (!toolId.startsWith("connector.")) {
    return null;
  }
  const parts = toolId.split(".");
  if (parts.length < 3) {
    return null;
  }
  const connectorId = parts[1];
  const actionId = parts.slice(2).join(".");
  if (!connectorId || !actionId) {
    return null;
  }
  return { connectorId, actionId };
}

const shellRunArgsSchema = z.object({
  script: z.string().min(1).max(200_000),
  shell: z.enum(["sh", "bash"]).optional(),
  env: z.record(z.string().min(1), z.string()).optional(),
  sandbox: z
    .object({
      backend: z.enum(["docker", "host", "provider"]).optional(),
      network: z.enum(["none", "enabled"]).optional(),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
      docker: z.object({ image: z.string().min(1).optional() }).optional(),
      envPassthroughAllowlist: z.array(z.string().min(1)).max(50).optional(),
    })
    .optional(),
});

const connectorToolArgsSchema = z.object({
  connectorId: z.string().min(1),
  actionId: z.string().min(1),
  input: z.unknown().optional(),
  auth: z
    .object({
      secretId: z.string().uuid(),
    })
    .optional(),
});

type TeamTask = { teammateId: string; task: string; input?: unknown };

const teamDelegateArgsSchema = z.object({
  teammateId: z.string().min(1).max(64),
  task: z.string().min(1).max(200_000),
  input: z.unknown().optional(),
});

const teamMapArgsSchema = z.object({
  tasks: z
    .array(
      z.object({
        teammateId: z.string().min(1).max(64),
        task: z.string().min(1).max(200_000),
        input: z.unknown().optional(),
      })
    )
    .min(1)
    .max(64),
  maxParallel: z.number().int().min(1).max(16).optional(),
});

function intersectAllowlist(parent: string[], teammate: string[]): string[] {
  const parentSet = new Set(parent);
  const forbidden = new Set(["team.delegate", "team.map"]);
  return teammate.filter((t) => parentSet.has(t) && !forbidden.has(t));
}

async function runWithConcurrency<T>(input: { items: T[]; maxParallel: number; run: (item: T, index: number) => Promise<any> }) {
  const results: any[] = new Array(input.items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= input.items.length) {
        return;
      }
      results[idx] = await input.run(input.items[idx] as T, idx);
    }
  }

  const workers = new Array(Math.min(input.maxParallel, input.items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

export async function runVespidLoopV1(input: {
  requestId: string;
  organizationId: string;
  userId: string;
  runId: string;
  workflowId: string;
  attemptCount: number;
  nodeId: string;
  node: any; // workflowNodeSchema already validated
  policyToolsAllow: string[] | null;
  effectiveToolsAllow: string[] | null;
  toolset?: { id: string; name: string; mcpServers: unknown; agentSkills: unknown } | null;
  runInput?: unknown;
  steps?: unknown;
  organizationSettings?: unknown;
  githubApiBaseUrl: string;
  secrets: {
    llmApiKey?: string | undefined;
    connectorSecretsByConnectorId?: Record<string, string> | undefined;
  };
  sandbox: SandboxBackend;
  emitEvent?: (event: { ts: number; kind: string; level: "info" | "warn" | "error"; message?: string; payload?: unknown }) => void;
}): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
  const deadline = Date.now() + Math.max(1000, input.node.config.limits.timeoutMs);
  const allowedTools = new Set<string>(input.effectiveToolsAllow ?? input.node.config.tools.allow ?? []);
  const policyToolsAllow = input.policyToolsAllow ?? (input.node.config.tools.allow ?? []);
  const shellRunEnabled = parseShellRunEnabled(input.organizationSettings);
  const skillsRegistry = await loadSkillsRegistry();
  const skillsById = skillsRegistry.skills;

  const emit = (e: { kind: string; level?: "info" | "warn" | "error"; message?: string; payload?: unknown }) => {
    if (typeof input.emitEvent !== "function") {
      return;
    }
    try {
      input.emitEvent({
        ts: Date.now(),
        kind: e.kind,
        level: e.level ?? "info",
        ...(typeof e.message === "string" ? { message: e.message } : {}),
        ...(e.payload !== undefined ? { payload: e.payload } : {}),
      });
    } catch {
      // ignore
    }
  };

  const provider: "openai" | "anthropic" = input.node.config.llm.provider;
  const model: string = input.node.config.llm.model;
  const apiKey =
    input.secrets.llmApiKey && input.secrets.llmApiKey.trim().length > 0
      ? input.secrets.llmApiKey
      : provider === "anthropic"
        ? (process.env.ANTHROPIC_API_KEY ?? null)
        : (process.env.OPENAI_API_KEY ?? null);
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, error: "LLM_AUTH_NOT_CONFIGURED" };
  }

  const toolsetSkills = input.toolset?.id
    ? buildToolsetSkillsContext({
        toolsetId: input.toolset.id,
        toolsetName: input.toolset.name,
        agentSkills: input.toolset.agentSkills,
      })
    : null;
  if (toolsetSkills) {
    emit({ kind: "toolset_skills_applied", payload: { toolsetId: input.toolset!.id, count: toolsetSkills.count } });
  }

  const baseSystem = [
    input.node.config.prompt.system ? input.node.config.prompt.system : null,
    "You are a workflow agent node in Vespid.",
    "You MUST respond with a single JSON object and nothing else.",
    "Valid response envelopes:",
    '1) {"type":"final","output":<any>}',
    '2) {"type":"tool_call","toolId":"<toolId>","input":<object>}',
    `Allowed toolIds: ${JSON.stringify([...allowedTools.values()])}`,
    (() => {
      const allowedSkillInfos = Object.values(skillsById)
        .map((s) => ({ toolId: `skill.${s.id}`, description: s.manifest.description }))
        .filter((s) => allowedTools.has(s.toolId));
      return allowedSkillInfos.length > 0 ? `Allowed local skills on this node: ${JSON.stringify(allowedSkillInfos)}` : null;
    })(),
    toolsetSkills ? toolsetSkills.text : null,
  ]
    .filter(Boolean)
    .join("\n");

  const steps = Array.isArray(input.steps) ? (input.steps as unknown[]) : [];
  const renderedTemplate = input.node.config.prompt.inputTemplate
    ? renderTemplate(input.node.config.prompt.inputTemplate, {
        runInput: input.runInput ?? null,
        steps,
      })
    : null;

  const baseUser = [
    JSON.stringify(
      {
        instructions: input.node.config.prompt.instructions,
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

  const messages: ChatMessage[] = [
    { role: "system", content: baseSystem },
    { role: "user", content: baseUser },
  ];

  let turns = 0;
  let toolCalls = 0;

  const connectorSecretsByConnectorId = input.secrets.connectorSecretsByConnectorId ?? {};

  async function executeTool(toolId: string, toolInput: unknown, callIndex: number): Promise<{ status: "succeeded"; output: unknown } | { status: "failed"; error: string; output?: unknown }> {
    if (toolId === "shell.run") {
      if (!shellRunEnabled) {
        return { status: "failed", error: "TOOL_POLICY_DENIED:shell.run" };
      }
      const parsed = shellRunArgsSchema.safeParse(toolInput);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_TOOL_INPUT" };
      }

      const sandboxConfig = parsed.data.sandbox;
      const execResult = await input.sandbox.executeShellTask({
        requestId: `${input.requestId}:tool:${callIndex}`,
        organizationId: input.organizationId,
        userId: input.userId,
        runId: input.runId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        attemptCount: input.attemptCount,
        script: parsed.data.script,
        shell: parsed.data.shell ?? "sh",
        taskEnv: parsed.data.env ?? {},
        backend: sandboxConfig?.backend ?? null,
        networkMode: sandboxConfig?.network ?? null,
        timeoutMs: sandboxConfig?.timeoutMs ?? null,
        dockerImage: sandboxConfig?.docker?.image ?? null,
        envPassthroughAllowlist: sandboxConfig?.envPassthroughAllowlist ?? [],
      });

      if (execResult.status === "failed") {
        return { status: "failed", error: execResult.error ?? "SHELL_FAILED", output: execResult.output ?? null };
      }
      return { status: "succeeded", output: execResult.output ?? null };
    }

    if (toolId === "connector.action") {
      const parsed = connectorToolArgsSchema.safeParse(toolInput);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_TOOL_INPUT" };
      }
      if (parsed.data.auth?.secretId) {
        return { status: "failed", error: "TOOL_SECRET_ID_NOT_ALLOWED" };
      }

      const action = getCommunityConnectorAction({
        connectorId: parsed.data.connectorId as ConnectorId,
        actionId: parsed.data.actionId,
      });
      if (!action) {
        return { status: "failed", error: `ACTION_NOT_SUPPORTED:${parsed.data.connectorId}:${parsed.data.actionId}` };
      }

      const actionInputParsed = action.inputSchema.safeParse(parsed.data.input);
      if (!actionInputParsed.success) {
        return { status: "failed", error: "INVALID_ACTION_INPUT" };
      }

      const secret = action.requiresSecret ? connectorSecretsByConnectorId[parsed.data.connectorId] ?? null : null;
      if (action.requiresSecret && (!secret || secret.trim().length === 0)) {
        return { status: "failed", error: "SECRET_REQUIRED" };
      }

      return await action.execute({
        organizationId: input.organizationId,
        userId: input.userId,
        connectorId: parsed.data.connectorId as any,
        actionId: parsed.data.actionId,
        input: actionInputParsed.data,
        secret,
        env: { githubApiBaseUrl: input.githubApiBaseUrl },
        fetchImpl: fetch,
      });
    }

    if (toolId === "team.delegate") {
      const parsed = teamDelegateArgsSchema.safeParse(toolInput);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_TOOL_INPUT" };
      }
      const team = input.node.config.team ?? null;
      if (!team) {
        return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
      }
      const teammate = team.teammates.find((t: any) => t.id === parsed.data.teammateId) ?? null;
      if (!teammate) {
        return { status: "failed", error: `TEAMMATE_NOT_FOUND:${parsed.data.teammateId}` };
      }

      const effectiveAllow = intersectAllowlist(policyToolsAllow, teammate.tools.allow ?? []);
      const out = await runVespidLoopV1({
        ...input,
        requestId: `${input.requestId}:team:${teammate.id}:${callIndex}`,
        nodeId: `${input.nodeId}:team:${teammate.id}`,
        node: {
          ...input.node,
          config: {
            ...input.node.config,
            team: null,
            llm: {
              ...input.node.config.llm,
              model: teammate.llm?.model ?? input.node.config.llm.model,
            },
            prompt: {
              ...(teammate.prompt.system ? { system: teammate.prompt.system } : {}),
              instructions: teammate.prompt.instructions,
              ...(teammate.prompt.inputTemplate ? { inputTemplate: teammate.prompt.inputTemplate } : {}),
            },
            tools: {
              ...input.node.config.tools,
              allow: effectiveAllow,
            },
            limits: teammate.limits,
            output: teammate.output,
          },
        },
        policyToolsAllow,
        effectiveToolsAllow: effectiveAllow,
        runInput: {
          parentRunInput: input.runInput ?? null,
          task: parsed.data.task,
          input: parsed.data.input ?? null,
        },
      });
      if (!out.ok) {
        const toolPolicyDenied =
          typeof out.error === "string" && out.error.startsWith("TOOL_NOT_ALLOWED:")
            ? `TEAM_TOOL_POLICY_DENIED:${out.error.slice("TOOL_NOT_ALLOWED:".length)}`
            : out.error;
        return { status: "failed", error: toolPolicyDenied ?? "TEAM_DELEGATE_FAILED" };
      }
      return { status: "succeeded", output: { teammateId: teammate.id, output: out.output ?? null } };
    }

    if (toolId === "team.map") {
      const parsed = teamMapArgsSchema.safeParse(toolInput);
      if (!parsed.success) {
        return { status: "failed", error: "INVALID_TOOL_INPUT" };
      }
      const team = input.node.config.team ?? null;
      if (!team) {
        return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
      }
      const maxParallel = Math.max(1, Math.min(16, parsed.data.maxParallel ?? team.maxParallel ?? 3));

      const outputs = await runWithConcurrency({
        items: parsed.data.tasks as TeamTask[],
        maxParallel,
        run: async (task) => {
          const out = await executeTool("team.delegate", task, callIndex);
          if (out.status === "succeeded") {
            return { status: "succeeded", ...(out.output as any) };
          }
          return { status: "failed", teammateId: task.teammateId, error: out.error };
        },
      });

      return { status: "succeeded", output: outputs };
    }

    if (toolId.startsWith("skill.")) {
      const skillId = toolId.slice("skill.".length);
      const skill = skillsById[skillId] ?? null;
      if (!skill) {
        return { status: "failed", error: `SKILL_NOT_FOUND:${skillId}` };
      }
      return await executeSkill({
        skill,
        args: toolInput,
        sandbox: input.sandbox,
        organizationId: input.organizationId,
        userId: input.userId,
        runId: input.runId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        attemptCount: input.attemptCount,
      });
    }

    return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
  }

  for (;;) {
    if (Date.now() >= deadline) {
      return { ok: false, error: "LLM_TIMEOUT" };
    }
    if (turns >= input.node.config.limits.maxTurns) {
      return { ok: false, error: "AGENT_MAX_TURNS" };
    }
    if (toolCalls > input.node.config.limits.maxToolCalls) {
      return { ok: false, error: "AGENT_MAX_TOOL_CALLS" };
    }

    turns += 1;

    const llm =
      provider === "anthropic"
        ? await anthropicChatCompletion({
            apiKey,
            model,
            messages,
            timeoutMs: Math.max(1000, deadline - Date.now()),
            maxOutputChars: input.node.config.limits.maxOutputChars,
          })
        : await openAiChatCompletion({
            apiKey,
            model,
            messages,
            timeoutMs: Math.max(1000, deadline - Date.now()),
            maxOutputChars: input.node.config.limits.maxOutputChars,
          });

    if (!llm.ok) {
      return { ok: false, error: llm.error };
    }

    const content = safeTruncate(llm.content.trim(), input.node.config.limits.maxOutputChars);
    messages.push({ role: "assistant", content });

    const envelope = parseEnvelope(content);
    if (!envelope.ok) {
      return { ok: false, error: envelope.error };
    }

    if (envelope.value.type === "final") {
      const output = envelope.value.output;
      if (input.node.config.output.mode === "json") {
        try {
          JSON.stringify(output);
        } catch {
          return { ok: false, error: "INVALID_AGENT_JSON_OUTPUT" };
        }
        if (input.node.config.output.jsonSchema !== undefined) {
          const compiled = compileJsonSchema(input.node.config.output.jsonSchema);
          if (!compiled.ok) {
            return { ok: false, error: compiled.error };
          }
          const ok = Boolean(compiled.validate(output));
          if (!ok) {
            return { ok: false, error: "INVALID_AGENT_JSON_OUTPUT" };
          }
        }
      }

      const meta = {
        provider,
        model,
        turns,
        toolCalls,
      };
      const outputWithMeta =
        output && typeof output === "object" && !Array.isArray(output)
          ? { ...(output as any), _meta: meta }
          : { output, _meta: meta };

      return { ok: true, output: outputWithMeta };
    }

    const toolIdRaw = envelope.value.toolId;
    let toolInput = envelope.value.input;
    if (typeof toolIdRaw !== "string" || toolIdRaw.trim().length === 0) {
      return { ok: false, error: "INVALID_AGENT_OUTPUT" };
    }
    if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
      return { ok: false, error: "INVALID_TOOL_INPUT" };
    }

    let toolId = toolIdRaw;
    const connectorAlias = parseConnectorToolId(toolIdRaw);
    if (connectorAlias) {
      toolId = "connector.action";
      toolInput = { ...connectorAlias, ...(toolInput as any) } as any;
    }

    if (!allowedTools.has(toolIdRaw)) {
      return { ok: false, error: `TOOL_NOT_ALLOWED:${toolIdRaw}` };
    }
    if (toolCalls >= input.node.config.limits.maxToolCalls) {
      return { ok: false, error: "AGENT_MAX_TOOL_CALLS" };
    }

    const callIndex = toolCalls + 1;
    toolCalls = callIndex;

    const toolResult = await executeTool(toolId, toolInput, callIndex);
    const outputSummary = summarizeJson(toolResult.output ?? null, 20_000);
    const status = toolResult.status;
    const error = toolResult.status === "failed" ? toolResult.error : null;

    messages.push({
      role: "user",
      content: JSON.stringify({
        type: "tool_result",
        toolId: toolIdRaw,
        callIndex,
        status,
        ...(status === "failed" ? { error } : {}),
        output: outputSummary,
      }),
    });
  }
}
