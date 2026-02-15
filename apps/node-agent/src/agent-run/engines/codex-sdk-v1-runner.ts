import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import readline from "node:readline";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";
import type { AgentRunEngineRunner } from "./types.js";
import type { SandboxBackend } from "../../sandbox/index.js";
import { resolveRunWorkdirHostPath } from "../../sandbox/workdir.js";
import { loadSkillsRegistry } from "../../skills/loader.js";
import { executeSkill } from "../../skills/execute-skill.js";
import { buildToolsetSkillsContext } from "../toolset-skills.js";
import type { ChatMessage } from "../llm/openai.js";

const execFileAsync = promisify(execFile);

type AgentEnvelope =
  | { type: "final"; output: unknown }
  | { type: "tool_call"; toolId: string; input: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function safeTruncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function extractJsonObjectCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/i);
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
      const parsed = JSON.parse(candidate) as any;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      if (parsed.type === "final") {
        return { ok: true, value: { type: "final", output: parsed.output } };
      }
      if (parsed.type === "tool_call") {
        return { ok: true, value: { type: "tool_call", toolId: parsed.toolId, input: parsed.input } };
      }
    } catch {
      // continue
    }
  }

  return { ok: false, error: "INVALID_AGENT_OUTPUT" };
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

function parseShellRunEnabled(settings: unknown): boolean {
  const root = asObject(settings);
  const tools = root ? asObject(root.tools) : null;
  return Boolean(tools && typeof tools.shellRunEnabled === "boolean" ? tools.shellRunEnabled : false);
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

async function resolveCodexExecutablePath(): Promise<string | null> {
  const explicit = process.env.VESPID_CODEX_PATH;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }
  try {
    const out = await execFileAsync("sh", ["-lc", "command -v codex"], { timeout: 2000, windowsHide: true });
    const p = String(out.stdout ?? "").trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

function codexOutputSchema(): unknown {
  return {
    oneOf: [
      {
        type: "object",
        properties: { type: { const: "final" }, output: {} },
        required: ["type", "output"],
        additionalProperties: true,
      },
      {
        type: "object",
        properties: { type: { const: "tool_call" }, toolId: { type: "string" }, input: { type: "object" } },
        required: ["type", "toolId", "input"],
        additionalProperties: true,
      },
    ],
  };
}

function isCodexToolUseEvent(json: any): boolean {
  const type = typeof json?.type === "string" ? json.type : "";
  const itemType = typeof json?.item?.type === "string" ? json.item.type : "";
  const combined = `${type} ${itemType}`;
  // Defensive: schema and naming have changed before; treat any detected tool execution as forbidden.
  return /(commandExecution|fileChange|mcpToolCall|webSearch|browser|apply_patch)/i.test(combined);
}

function extractCodexAssistantDelta(json: any): string | null {
  const type = typeof json?.type === "string" ? json.type : "";
  const itemType = typeof json?.item?.type === "string" ? json.item.type : "";
  const combined = `${type} ${itemType}`;

  // Common Codex/OpenAI streaming shapes include e.g.:
  // - { type: "response.output_text.delta", delta: "..." }
  // - { type: "output_text.delta", delta: "..." }
  const delta = typeof json?.delta === "string" ? json.delta : null;
  if (delta && /delta/i.test(combined) && /(output_text|text|assistant)/i.test(combined)) {
    return delta;
  }

  // Some variants may use `text` for the chunk.
  const text = typeof json?.text === "string" ? json.text : null;
  if (text && /delta/i.test(combined) && /(output_text|text|assistant)/i.test(combined)) {
    return text;
  }

  return null;
}

function createCoalescedDeltaEmitter(input: {
  flushChars: number;
  flushMs: number;
  maxEvents: number;
  maxChars: number;
  onFlush: (deltaChunk: string) => void;
}) {
  let buffer = "";
  let scheduled: NodeJS.Timeout | null = null;
  let emittedEvents = 0;
  let emittedChars = 0;

  const flush = () => {
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    if (!buffer) {
      return;
    }
    if (emittedEvents >= input.maxEvents || emittedChars >= input.maxChars) {
      buffer = "";
      return;
    }
    const remainingChars = Math.max(0, input.maxChars - emittedChars);
    const chunk = buffer.length <= remainingChars ? buffer : buffer.slice(0, remainingChars);
    buffer = buffer.length <= remainingChars ? "" : buffer.slice(remainingChars);

    if (chunk) {
      emittedEvents += 1;
      emittedChars += chunk.length;
      input.onFlush(chunk);
    }
  };

  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = setTimeout(flush, input.flushMs);
  };

  return {
    write(delta: string) {
      if (!delta) {
        return;
      }
      if (emittedChars >= input.maxChars || emittedEvents >= input.maxEvents) {
        return;
      }
      buffer += delta;
      if (buffer.length >= input.flushChars) {
        flush();
      } else {
        schedule();
      }
    },
    finish() {
      flush();
    },
  };
}

async function codexChatCompletion(input: {
  codexPath: string;
  apiKey: string;
  model: string;
  workdir: string;
  prompt: string;
  timeoutMs: number;
  maxOutputChars: number;
  onAssistantDelta?: (deltaChunk: string) => void;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const homeDir = path.join(input.workdir, "codex-home");
  await fs.mkdir(homeDir, { recursive: true });

  const outputSchemaPath = path.join(input.workdir, "codex-output-schema.json");
  await fs.writeFile(outputSchemaPath, JSON.stringify(codexOutputSchema()), "utf8");

  const lastMessagePath = path.join(input.workdir, `codex-last-message-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

  const args = [
    "exec",
    "--cd",
    input.workdir,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    input.model,
    "--json",
    "--output-schema",
    outputSchemaPath,
    "--output-last-message",
    lastMessagePath,
    "-",
  ];

  const env: Record<string, string> = {
    HOME: homeDir,
    CODEX_API_KEY: input.apiKey,
    OPENAI_API_KEY: input.apiKey,
    PATH: process.env.PATH ?? "",
  };

  const child = spawn(input.codexPath, args, { cwd: input.workdir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 500);
  }, input.timeoutMs);

  let toolUseDetected = false;
  const deltaEmitter = input.onAssistantDelta
    ? createCoalescedDeltaEmitter({
        flushChars: Math.max(32, Math.min(2048, envNumber("VESPID_AGENT_STREAM_FLUSH_CHARS", 128))),
        flushMs: Math.max(10, Math.min(1000, envNumber("VESPID_AGENT_STREAM_FLUSH_MS", 80))),
        maxEvents: Math.max(10, Math.min(10_000, envNumber("VESPID_AGENT_STREAM_MAX_EVENTS", 800))),
        maxChars: Math.max(256, Math.min(2_000_000, envNumber("VESPID_AGENT_STREAM_MAX_CHARS", 200_000))),
        onFlush: input.onAssistantDelta,
      })
    : null;

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    if (toolUseDetected) {
      return;
    }
    try {
      const json = JSON.parse(line) as any;
      if (isCodexToolUseEvent(json)) {
        toolUseDetected = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        return;
      }

      const delta = deltaEmitter ? extractCodexAssistantDelta(json) : null;
      if (deltaEmitter && delta) {
        deltaEmitter.write(delta);
      }
    } catch {
      // ignore non-json lines
    }
  });

  child.stdin?.write(input.prompt);
  child.stdin?.end();

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(typeof code === "number" ? code : null));
    child.on("error", () => resolve(null));
  });

  clearTimeout(timeout);
  rl.close();
  if (deltaEmitter) {
    deltaEmitter.finish();
  }

  if (timedOut) {
    return { ok: false, error: "LLM_TIMEOUT" };
  }
  if (toolUseDetected) {
    return { ok: false, error: "CODEX_TOOL_USE_NOT_ALLOWED" };
  }
  if (exitCode !== 0) {
    return { ok: false, error: `CODEX_EXEC_FAILED:${exitCode === null ? "unknown" : String(exitCode)}` };
  }

  let raw: string;
  try {
    raw = await fs.readFile(lastMessagePath, "utf8");
  } catch {
    return { ok: false, error: "CODEX_NO_LAST_MESSAGE" };
  }

  return { ok: true, content: safeTruncate(String(raw).trim(), input.maxOutputChars) };
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}/g, (_m, key) => {
    const value = vars[key];
    try {
      return value === undefined ? "" : JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

export const codexSdkV1Runner: AgentRunEngineRunner = {
  id: "codex.sdk.v1",
  async run(input) {
    if (input.node?.config?.llm?.provider !== "openai") {
      return { ok: false as const, error: "ENGINE_PROVIDER_MISMATCH" };
    }

    const codexPath = await resolveCodexExecutablePath();
    if (!codexPath) {
      return { ok: false as const, error: "CODEX_CLI_NOT_INSTALLED" };
    }

    const apiKey =
      input.secrets.llmApiKey && input.secrets.llmApiKey.trim().length > 0
        ? input.secrets.llmApiKey
        : (process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY ?? null);
    if (!apiKey || apiKey.trim().length === 0) {
      return { ok: false as const, error: "LLM_AUTH_NOT_CONFIGURED" };
    }

    const deadline = Date.now() + Math.max(1000, input.node.config.limits.timeoutMs);
    const allowedTools = new Set<string>(input.effectiveToolsAllow ?? input.node.config.tools.allow ?? []);
    const policyToolsAllow = input.policyToolsAllow ?? (input.node.config.tools.allow ?? []);
    const shellRunEnabled = parseShellRunEnabled(input.organizationSettings);

    const skillsRegistry = await loadSkillsRegistry();
    const skillsById = skillsRegistry.skills;

    const toolsetSkills = input.toolset?.id
      ? buildToolsetSkillsContext({
          toolsetId: input.toolset.id,
          toolsetName: input.toolset.name,
          agentSkills: input.toolset.agentSkills,
        })
      : null;

    const steps = Array.isArray(input.steps) ? (input.steps as unknown[]) : [];
    const renderedTemplate = input.node.config.prompt.inputTemplate
      ? renderTemplate(input.node.config.prompt.inputTemplate, {
          runInput: input.runInput ?? null,
          steps,
        })
      : null;

    const baseSystem = [
      input.node.config.prompt.system ? input.node.config.prompt.system : null,
      "You are a workflow agent node in Vespid.",
      "You MUST respond with a single JSON object and nothing else.",
      "Valid response envelopes:",
      '1) {\"type\":\"final\",\"output\":<any>}',
      '2) {\"type\":\"tool_call\",\"toolId\":\"<toolId>\",\"input\":<object>}',
      `Allowed toolIds: ${JSON.stringify([...allowedTools.values()])}`,
      toolsetSkills ? toolsetSkills.text : null,
    ]
      .filter(Boolean)
      .join("\n");

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

    const workdir = await resolveRunWorkdirHostPath({
      organizationId: input.organizationId,
      runId: input.runId,
      nodeId: input.nodeId,
      attemptCount: input.attemptCount,
    });

    async function executeTool(
      toolId: string,
      toolInput: unknown,
      callIndex: number
    ): Promise<{ status: "succeeded"; output: unknown } | { status: "failed"; error: string; output?: unknown }> {
      if (toolId === "shell.run") {
        if (!shellRunEnabled) {
          return { status: "failed", error: "TOOL_POLICY_DENIED:shell.run" };
        }
        const parsed = shellRunArgsSchema.safeParse(toolInput);
        if (!parsed.success) {
          return { status: "failed", error: "INVALID_TOOL_INPUT" };
        }

        const sandboxConfig = parsed.data.sandbox;
        const execResult = await (input.sandbox as SandboxBackend).executeShellTask({
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
        } as any);

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

      if (toolId.startsWith("skill.")) {
        const skillId = toolId.slice("skill.".length);
        const skill = skillsById[skillId] ?? null;
        if (!skill) {
          return { status: "failed", error: `SKILL_NOT_FOUND:${skillId}` };
        }
        return await executeSkill({
          skill,
          args: toolInput,
          sandbox: input.sandbox as any,
          organizationId: input.organizationId,
          userId: input.userId,
          runId: input.runId,
          workflowId: input.workflowId,
          nodeId: input.nodeId,
          attemptCount: input.attemptCount,
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
        const out = await codexSdkV1Runner.run({
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

      return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
    }

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

    if (toolsetSkills) {
      emit({ kind: "toolset_skills_applied", payload: { toolsetId: input.toolset!.id, count: toolsetSkills.count } });
    }

    emit({
      kind: "agent.start",
      payload: {
        engineId: "codex.sdk.v1",
        model: input.node.config.llm.model,
        allowedToolIds: [...allowedTools.values()],
      },
    });

    for (;;) {
      if (Date.now() >= deadline) {
        return { ok: false as const, error: "LLM_TIMEOUT" };
      }
      if (turns >= input.node.config.limits.maxTurns) {
        return { ok: false as const, error: "AGENT_MAX_TURNS" };
      }
      if (toolCalls > input.node.config.limits.maxToolCalls) {
        return { ok: false as const, error: "AGENT_MAX_TOOL_CALLS" };
      }

      turns += 1;

      const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
      emit({ kind: "agent.turn_started", payload: { turn: turns } });
      let deltaIndex = 0;
      const streamEnabled = typeof input.emitEvent === "function";
      const llm = await codexChatCompletion({
        codexPath,
        apiKey,
        model: input.node.config.llm.model,
        workdir,
        prompt,
        timeoutMs: Math.max(1000, deadline - Date.now()),
        maxOutputChars: input.node.config.limits.maxOutputChars,
        ...(streamEnabled
          ? {
              onAssistantDelta: (deltaChunk: string) => {
                deltaIndex += 1;
                emit({
                  kind: "agent.assistant_delta",
                  payload: {
                    turn: turns,
                    deltaIndex,
                    delta: safeTruncate(deltaChunk, 4000),
                  },
                });
              },
            }
          : {}),
      });

      if (!llm.ok) {
        return { ok: false as const, error: llm.error };
      }

      const content = safeTruncate(llm.content.trim(), input.node.config.limits.maxOutputChars);
      messages.push({ role: "assistant", content });
      emit({
        kind: "agent.assistant_message",
        payload: { turn: turns, content: safeTruncate(content, 50_000) },
      });

      const envelope = parseEnvelope(content);
      if (!envelope.ok) {
        return { ok: false as const, error: envelope.error };
      }

      if (envelope.value.type === "final") {
        const output = envelope.value.output;
        if (input.node.config.output.mode === "json") {
          try {
            JSON.stringify(output);
          } catch {
            return { ok: false as const, error: "INVALID_AGENT_JSON_OUTPUT" };
          }
          if (input.node.config.output.jsonSchema !== undefined) {
            const compiled = compileJsonSchema(input.node.config.output.jsonSchema);
            if (!compiled.ok) {
              return { ok: false as const, error: compiled.error };
            }
            if (!compiled.validate(output)) {
              return { ok: false as const, error: "INVALID_AGENT_JSON_OUTPUT" };
            }
          }
        }

        const meta = { provider: "codex.cli", model: input.node.config.llm.model, turns, toolCalls };
        const outputWithMeta =
          output && typeof output === "object" && !Array.isArray(output)
            ? { ...(output as any), _meta: meta }
            : { output, _meta: meta };

        emit({
          kind: "agent.final",
          payload: { turn: turns, toolCalls, output: summarizeJson(output, 20_000) },
        });

        return { ok: true as const, output: outputWithMeta };
      }

      const toolIdRaw = envelope.value.toolId;
      let toolInput = envelope.value.input;
      if (typeof toolIdRaw !== "string" || toolIdRaw.trim().length === 0) {
        return { ok: false as const, error: "INVALID_AGENT_OUTPUT" };
      }
      if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
        return { ok: false as const, error: "INVALID_TOOL_INPUT" };
      }

      let toolId = toolIdRaw;
      const connectorAlias = parseConnectorToolId(toolIdRaw);
      if (connectorAlias) {
        toolId = "connector.action";
        toolInput = { ...connectorAlias, ...(toolInput as any) } as any;
      }

      if (!allowedTools.has(toolIdRaw)) {
        return { ok: false as const, error: `TOOL_NOT_ALLOWED:${toolIdRaw}` };
      }
      if (toolCalls >= input.node.config.limits.maxToolCalls) {
        return { ok: false as const, error: "AGENT_MAX_TOOL_CALLS" };
      }

      const callIndex = toolCalls + 1;
      toolCalls = callIndex;

      emit({
        kind: "agent.tool_call",
        payload: {
          turn: turns,
          callIndex,
          toolId: toolIdRaw,
          input: summarizeJson(toolInput, 20_000),
        },
      });

      const toolResult = await executeTool(toolId, toolInput, callIndex);
      const outputSummary = summarizeJson(toolResult.output ?? null, 20_000);
      const status = toolResult.status;
      const error = toolResult.status === "failed" ? toolResult.error : null;

      emit({
        kind: "agent.tool_result",
        level: status === "failed" ? "warn" : "info",
        payload: {
          turn: turns,
          callIndex,
          toolId: toolIdRaw,
          status,
          ...(status === "failed" ? { error } : {}),
          output: outputSummary,
        },
      });

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
  },
};
