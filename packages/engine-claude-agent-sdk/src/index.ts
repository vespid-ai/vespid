import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { z } from "zod";
import { getCommunityConnectorAction, type ConnectorId } from "@vespid/connectors";

type SandboxBackendLike = {
  executeShellTask: (ctx: any) => Promise<{ status: "succeeded"; output?: any } | { status: "failed"; error: string; output?: any }>;
};

type LoadedSkill = {
  id: string;
  dirPath: string;
  manifest: {
    id: string;
    version: string;
    description: string;
    entrypoint: string;
    runtime: "shell" | "node";
    inputSchema: unknown;
    outputMode: "text" | "json";
    sandbox: {
      backend?: "docker" | "host" | "provider" | undefined;
      network?: "none" | "enabled" | undefined;
      timeoutMs?: number | undefined;
      docker?: { image?: string | undefined } | undefined;
      envPassthroughAllowlist?: string[] | undefined;
    };
  };
  doc?: string | null;
};

const skillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/);
const skillManifestSchema = z.object({
  id: skillIdSchema,
  version: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  entrypoint: z.string().min(1).max(200),
  runtime: z.enum(["shell", "node"]),
  inputSchema: z.unknown(),
  outputMode: z.enum(["text", "json"]),
  sandbox: z
    .object({
      backend: z.enum(["docker", "host", "provider"]).optional(),
      network: z.enum(["none", "enabled"]).optional(),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
      docker: z.object({ image: z.string().min(1).max(200).optional() }).optional(),
      envPassthroughAllowlist: z.array(z.string().min(1).max(120)).max(50).optional(),
    })
    .default({}),
});

function resolveHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

const execFileAsync = promisify(execFile);

async function resolveClaudeCodeExecutablePath(): Promise<string | null> {
  const explicit = process.env.VESPID_CLAUDE_CODE_PATH;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  // Prefer a user-installed `claude` in PATH.
  try {
    const out = await execFileAsync("sh", ["-lc", "command -v claude"], { timeout: 2000, windowsHide: true });
    const p = String(out.stdout ?? "").trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

function assertSubpath(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (!rel || rel === "." || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return;
  }
  throw new Error("PATH_TRAVERSAL");
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

function defaultSkillsDir(): string {
  const raw = process.env.VESPID_AGENT_SKILLS_DIR ?? "~/.vespid/skills";
  return path.resolve(resolveHome(raw));
}

async function loadSkillsRegistry(): Promise<Record<string, LoadedSkill>> {
  const skillsDir = defaultSkillsDir();
  const skills: Record<string, LoadedSkill> = {};

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  const resolvedRoot = path.resolve(skillsDir);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!skillIdSchema.safeParse(entry.name).success) {
      continue;
    }
    const dirPath = path.join(skillsDir, entry.name);
    const resolvedDir = path.resolve(dirPath);
    try {
      assertSubpath(resolvedRoot, resolvedDir);
    } catch {
      continue;
    }

    const manifestPath = path.join(dirPath, "skill.json");
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf8");
    } catch {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      continue;
    }
    const parsed = skillManifestSchema.safeParse(json);
    if (!parsed.success) {
      continue;
    }
    if (parsed.data.id !== entry.name) {
      continue;
    }

    const entryResolved = path.resolve(dirPath, parsed.data.entrypoint);
    try {
      assertSubpath(resolvedDir, entryResolved);
    } catch {
      continue;
    }

    skills[parsed.data.id] = { id: parsed.data.id, dirPath, manifest: parsed.data, doc: null };
  }

  return skills;
}

function resolveWorkdirRoot(): string {
  const raw = process.env.VESPID_AGENT_WORKDIR_ROOT ?? "~/.vespid/workdir";
  return path.resolve(resolveHome(raw));
}

async function resolveRunWorkdirHostPath(input: {
  organizationId: string;
  runId: string | null;
  nodeId: string;
  attemptCount: number | null;
}): Promise<string> {
  const workdirRoot = resolveWorkdirRoot();
  const attempt = input.attemptCount ?? 1;
  const runId = input.runId ?? "run";
  const workdir = path.join(workdirRoot, input.organizationId, runId, input.nodeId, String(attempt));
  assertSubpath(path.resolve(workdirRoot), path.resolve(workdir));
  await ensureDir(workdir);
  return workdir;
}

async function copyDirNoSymlinks(src: string, dst: string): Promise<void> {
  const st = await fs.lstat(src);
  if (st.isSymbolicLink()) {
    throw new Error("SKILL_SYMLINK_NOT_ALLOWED");
  }
  if (!st.isDirectory()) {
    throw new Error("SKILL_DIR_INVALID");
  }

  await ensureDir(dst);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);

    const childSt = await fs.lstat(from);
    if (childSt.isSymbolicLink()) {
      throw new Error("SKILL_SYMLINK_NOT_ALLOWED");
    }
    if (entry.isDirectory()) {
      await copyDirNoSymlinks(from, to);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(from, to);
      continue;
    }
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractStdout(execOutput: unknown): string {
  const obj = asObject(execOutput);
  return obj && typeof obj.stdout === "string" ? obj.stdout : "";
}

const ajv = new (Ajv as any)({ allErrors: true, strict: false }) as { compile: (schema: any) => ValidateFunction };
const validateCache = new Map<string, ValidateFunction>();

function compileSchema(schema: unknown): { ok: true; validate: ValidateFunction } | { ok: false; error: string } {
  let key: string | null = null;
  try {
    key = JSON.stringify(schema);
  } catch {
    key = null;
  }
  if (!key) {
    return { ok: false, error: "INVALID_JSON_SCHEMA" };
  }
  const cached = validateCache.get(key);
  if (cached) {
    return { ok: true, validate: cached };
  }
  try {
    const validate = ajv.compile(schema as any);
    validateCache.set(key, validate);
    return { ok: true, validate };
  } catch {
    return { ok: false, error: "INVALID_JSON_SCHEMA" };
  }
}

async function executeSkill(input: {
  skill: LoadedSkill;
  args: unknown;
  sandbox: SandboxBackendLike;
  organizationId: string;
  userId: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  attemptCount: number;
}): Promise<{ status: "succeeded"; output: unknown } | { status: "failed"; error: string; output?: unknown }> {
  const compiled = compileSchema(input.skill.manifest.inputSchema);
  if (!compiled.ok) {
    return { status: "failed", error: compiled.error };
  }
  if (!compiled.validate(input.args)) {
    return { status: "failed", error: "INVALID_SKILL_INPUT" };
  }

  const workdir = await resolveRunWorkdirHostPath({
    organizationId: input.organizationId,
    runId: input.runId,
    nodeId: input.nodeId,
    attemptCount: input.attemptCount,
  });

  const skillDstDir = path.join(workdir, "skills", input.skill.id);
  try {
    await fs.rm(skillDstDir, { recursive: true, force: true });
    await copyDirNoSymlinks(input.skill.dirPath, skillDstDir);
  } catch (err) {
    const error = err instanceof Error && err.message ? err.message : "SKILL_STAGING_FAILED";
    return { status: "failed", error };
  }

  const inputPath = path.join(skillDstDir, "input.json");
  await fs.writeFile(inputPath, JSON.stringify(input.args ?? null), "utf8");

  let entrypointPath: string;
  try {
    entrypointPath = path.resolve(skillDstDir, input.skill.manifest.entrypoint);
    assertSubpath(path.resolve(skillDstDir), entrypointPath);
  } catch {
    return { status: "failed", error: "SKILL_ENTRYPOINT_INVALID" };
  }

  const cmd = input.skill.manifest.runtime === "node" ? `node \"${entrypointPath}\"` : `sh \"${entrypointPath}\"`;
  const script = `cat \"${inputPath}\" | ${cmd}`;

  const execResult = await input.sandbox.executeShellTask({
    requestId: `${input.runId}:${input.nodeId}:skill:${input.skill.id}`,
    organizationId: input.organizationId,
    userId: input.userId,
    runId: input.runId,
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    attemptCount: input.attemptCount,
    script,
    shell: "sh",
    taskEnv: {
      VESPID_SKILL_ID: input.skill.id,
      VESPID_ORG_ID: input.organizationId,
      VESPID_USER_ID: input.userId,
      VESPID_RUN_ID: input.runId,
      VESPID_WORKFLOW_ID: input.workflowId,
      VESPID_NODE_ID: input.nodeId,
      VESPID_SKILL_INPUT_PATH: inputPath,
    },
    backend: input.skill.manifest.sandbox.backend ?? null,
    networkMode: input.skill.manifest.sandbox.network ?? null,
    timeoutMs: input.skill.manifest.sandbox.timeoutMs ?? null,
    dockerImage: input.skill.manifest.sandbox.docker?.image ?? null,
    envPassthroughAllowlist: input.skill.manifest.sandbox.envPassthroughAllowlist ?? [],
  });

  if (execResult.status === "failed") {
    return { status: "failed", error: execResult.error, output: execResult.output ?? null };
  }

  if (input.skill.manifest.outputMode === "json") {
    const stdout = extractStdout(execResult.output);
    try {
      const parsed = JSON.parse(stdout) as unknown;
      return { status: "succeeded", output: parsed };
    } catch {
      return { status: "failed", error: "SKILL_OUTPUT_INVALID_JSON", output: execResult.output ?? null };
    }
  }

  return { status: "succeeded", output: execResult.output ?? null };
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

function extractClaudeAssistantDeltaFromStreamEvent(msg: any): string | null {
  const ev = msg?.event;
  if (!ev || typeof ev !== "object") {
    return null;
  }
  const type = typeof ev.type === "string" ? ev.type : "";

  // Anthropic streaming events commonly include:
  // { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
  if (type === "content_block_delta") {
    const delta = ev.delta;
    if (delta && typeof delta === "object" && delta.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  if (/delta/i.test(type)) {
    if (typeof ev.delta === "string") {
      return ev.delta;
    }
    if (ev.delta && typeof ev.delta === "object" && typeof ev.delta.text === "string") {
      return ev.delta.text;
    }
  }

  return null;
}

function extractAssistantText(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  let out = "";
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      out += item.text;
    }
  }
  return out;
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

function parseFinalEnvelope(raw: string): { ok: true; output: unknown } | { ok: false; error: string } {
  const direct = raw.trim();
  const candidates = [direct, extractJsonObjectCandidate(direct)].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as any;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.type === "final") {
        return { ok: true, output: parsed.output };
      }
    } catch {
      // continue
    }
  }
  return { ok: false, error: "INVALID_AGENT_OUTPUT" };
}

function sanitizeMcpToolName(toolId: string): string {
  const base = toolId.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
  return base.length > 64 ? base.slice(0, 64) : base;
}

const ENV_PLACEHOLDER_RE = /^\$\{ENV:([A-Z0-9_]{1,128})\}$/;
const TOOLSET_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function parseEnvPlaceholder(value: string): string | null {
  const m = ENV_PLACEHOLDER_RE.exec(value);
  return m ? (m[1] ?? null) : null;
}

function assertSafeRelativePath(p: string): void {
  if (!p || typeof p !== "string") {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
  if (p.includes("\0")) {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
  if (p.startsWith("/") || p.startsWith("\\")) {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
  if (/^[a-zA-Z]:[\\/]/.test(p)) {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
  if (p.includes("\\")) {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("INVALID_SKILL_FILE_PATH");
  }
}

function resolvePlaceholderRecordOrThrow(record: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    const raw = typeof v === "string" ? v : "";
    const envName = parseEnvPlaceholder(raw);
    if (!envName) {
      throw new Error(`INVALID_MCP_PLACEHOLDER:${k}`);
    }
    const resolved = process.env[envName];
    if (!resolved || resolved.trim().length === 0) {
      throw new Error(`MCP_ENV_NOT_SET:${envName}`);
    }
    out[k] = resolved;
  }
  return out;
}

async function stageAgentSkillBundles(input: {
  cwd: string;
  toolsetId: string;
  bundles: any[];
}): Promise<{ skillsEnabled: boolean }> {
  const bundles = Array.isArray(input.bundles) ? input.bundles : [];
  const enabled = bundles.filter((b) => b && typeof b === "object" && (b.enabled ?? true) !== false);
  if (enabled.length === 0) {
    return { skillsEnabled: false };
  }

  const base = path.join(input.cwd, ".claude", "skills");
  await ensureDir(base);
  const resolvedBase = path.resolve(base);

  let totalBytes = 0;
  const maxTotalBytes = 2_000_000;
  const maxUtf8Chars = 200_000;
  const maxDecodedBytes = 500_000;

  for (const bundle of enabled) {
    if (bundle.format !== "agentskills-v1") {
      throw new Error("INVALID_SKILL_BUNDLE");
    }
    const id = typeof bundle.id === "string" ? bundle.id : "";
    if (!TOOLSET_ID_RE.test(id)) {
      throw new Error("INVALID_SKILL_BUNDLE");
    }
    const files = Array.isArray(bundle.files) ? bundle.files : [];
    const hasSkillMd = files.some((f: any) => f && typeof f === "object" && f.path === "SKILL.md");
    if (!hasSkillMd) {
      throw new Error("INVALID_SKILL_BUNDLE");
    }

    const skillDir = path.join(base, id);
    await ensureDir(skillDir);
    const resolvedSkillDir = path.resolve(skillDir);
    assertSubpath(resolvedBase, resolvedSkillDir);

    for (const file of files) {
      const p = file && typeof file === "object" ? String(file.path ?? "") : "";
      assertSafeRelativePath(p);

      const resolvedFilePath = path.resolve(skillDir, p);
      assertSubpath(resolvedSkillDir, resolvedFilePath);

      const content = file && typeof file === "object" ? String(file.content ?? "") : "";
      const encoding = file && typeof file === "object" && typeof file.encoding === "string" ? file.encoding : "utf8";

      let bytes: Buffer;
      if (encoding === "base64") {
        bytes = Buffer.from(content, "base64");
        if (bytes.length > maxDecodedBytes) {
          throw new Error("SKILL_FILE_TOO_LARGE");
        }
      } else {
        if (content.length > maxUtf8Chars) {
          throw new Error("SKILL_FILE_TOO_LARGE");
        }
        bytes = Buffer.from(content, "utf8");
      }

      totalBytes += bytes.length;
      if (totalBytes > maxTotalBytes) {
        throw new Error("SKILL_BUNDLE_TOO_LARGE");
      }

      await ensureDir(path.dirname(resolvedFilePath));
      await fs.writeFile(resolvedFilePath, bytes);
    }
  }

  return { skillsEnabled: true };
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

function intersectAllowlist(parent: string[], teammate: string[]): string[] {
  const parentSet = new Set(parent);
  const forbidden = new Set(["team.delegate", "team.map"]);
  return teammate.filter((t) => parentSet.has(t) && !forbidden.has(t));
}

type TeamTask = { teammateId: string; task: string; input?: unknown };

export function createEngineRunner() {
  return {
    id: "claude.agent-sdk.v1" as const,
    async run(inputRaw: any) {
      const input = inputRaw as any;
      const node = input?.node as any;
      if (!node || node.type !== "agent.run" || !node.config) {
        return { ok: false as const, error: "INVALID_AGENT_RUN_NODE" };
      }
      if (node.config.llm?.provider !== "anthropic") {
        return { ok: false as const, error: "ENGINE_PROVIDER_MISMATCH" };
      }
      const sandbox = input?.sandbox as SandboxBackendLike;
      if (!sandbox || typeof sandbox.executeShellTask !== "function") {
        return { ok: false as const, error: "SANDBOX_NOT_AVAILABLE" };
      }

      const deadline = Date.now() + Math.max(1000, node.config.limits?.timeoutMs ?? 60_000);
      const shellRunEnabled = parseShellRunEnabled(input.organizationSettings);
      const allowedToolsRaw: string[] = (input.effectiveToolsAllow ?? node.config.tools?.allow ?? []) as string[];
      const allowedToolsSet = new Set<string>(allowedToolsRaw);
      const policyToolsAllow: string[] = (input.policyToolsAllow ?? node.config.tools?.allow ?? []) as string[];
      const skills = await loadSkillsRegistry();

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

      const apiKey =
        input?.secrets?.llmApiKey && String(input.secrets.llmApiKey).trim().length > 0
          ? String(input.secrets.llmApiKey)
          : (process.env.ANTHROPIC_API_KEY ?? "");
      if (!apiKey || apiKey.trim().length === 0) {
        return { ok: false as const, error: "LLM_AUTH_NOT_CONFIGURED" };
      }

      const claudePath = await resolveClaudeCodeExecutablePath();
      if (!claudePath) {
        return { ok: false as const, error: "CLAUDE_CODE_NOT_INSTALLED" };
      }

      emit({ kind: "agent.start", payload: { engineId: "claude.agent-sdk.v1", model: node.config.llm.model } });

      // Tool call budget is enforced in the MCP tool handlers.
      let toolCalls = 0;
      const maxToolCalls = Math.max(0, node.config.limits?.maxToolCalls ?? 0);
      const streamEnabled = typeof input.emitEvent === "function";
      let deltaIndex = 0;
      const deltaEmitter = streamEnabled
        ? createCoalescedDeltaEmitter({
            flushChars: Math.max(32, Math.min(2048, envNumber("VESPID_AGENT_STREAM_FLUSH_CHARS", 128))),
            flushMs: Math.max(10, Math.min(1000, envNumber("VESPID_AGENT_STREAM_FLUSH_MS", 80))),
            maxEvents: Math.max(10, Math.min(10_000, envNumber("VESPID_AGENT_STREAM_MAX_EVENTS", 800))),
            maxChars: Math.max(256, Math.min(2_000_000, envNumber("VESPID_AGENT_STREAM_MAX_CHARS", 200_000))),
            onFlush: (chunk) => {
              deltaIndex += 1;
              emit({
                kind: "agent.assistant_delta",
                payload: { deltaIndex, delta: safeTruncate(chunk, 4000) },
              });
            },
          })
        : null;

      const connectorSecretsByConnectorId: Record<string, string> = input?.secrets?.connectorSecretsByConnectorId ?? {};
      const githubApiBaseUrl: string = input?.githubApiBaseUrl ?? "https://api.github.com";

      function assertDeadline() {
        if (Date.now() >= deadline) {
          throw new Error("LLM_TIMEOUT");
        }
      }

      function countToolCallOrThrow() {
        if (toolCalls >= maxToolCalls) {
          throw new Error("AGENT_MAX_TOOL_CALLS");
        }
        toolCalls += 1;
      }

      async function executeTool(
        toolIdRaw: string,
        toolInput: unknown,
        opts?: { skipAllowlist?: boolean }
      ): Promise<{ status: "succeeded"; output: unknown } | { status: "failed"; error: string; output?: unknown }> {
        assertDeadline();
        if (!opts?.skipAllowlist) {
          if (!allowedToolsSet.has(toolIdRaw)) {
            return { status: "failed", error: `TOOL_NOT_ALLOWED:${toolIdRaw}` };
          }
        }

        // connector.* alias -> connector.action
        let toolId = toolIdRaw;
        let normalizedInput = toolInput;
        const connectorAlias = parseConnectorToolId(toolIdRaw);
        if (connectorAlias) {
          toolId = "connector.action";
          normalizedInput = { ...connectorAlias, input: toolInput } as any;
        }

        if (toolId === "shell.run") {
          if (!shellRunEnabled) {
            return { status: "failed", error: "TOOL_POLICY_DENIED:shell.run" };
          }
          const parsed = z
            .object({
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
            })
            .safeParse(normalizedInput);
          if (!parsed.success) {
            return { status: "failed", error: "INVALID_TOOL_INPUT" };
          }

          const sandboxConfig = parsed.data.sandbox;
          const exec = await sandbox.executeShellTask({
            requestId: `${input.requestId}:tool:shell.run:${toolCalls}`,
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
          if (exec.status === "failed") {
            return { status: "failed", error: exec.error ?? "SHELL_FAILED", output: exec.output ?? null };
          }
          return { status: "succeeded", output: exec.output ?? null };
        }

        if (toolId === "connector.action") {
          const parsed = z
            .object({
              connectorId: z.string().min(1),
              actionId: z.string().min(1),
              input: z.unknown().optional(),
            })
            .safeParse(normalizedInput);
          if (!parsed.success) {
            return { status: "failed", error: "INVALID_TOOL_INPUT" };
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
            env: { githubApiBaseUrl },
            fetchImpl: fetch,
          });
        }

        if (toolId.startsWith("skill.")) {
          const skillId = toolId.slice("skill.".length);
          const skill = skills[skillId] ?? null;
          if (!skill) {
            return { status: "failed", error: `SKILL_NOT_FOUND:${skillId}` };
          }
          return await executeSkill({
            skill,
            args: normalizedInput,
            sandbox,
            organizationId: input.organizationId,
            userId: input.userId,
            runId: input.runId,
            workflowId: input.workflowId,
            nodeId: input.nodeId,
            attemptCount: input.attemptCount,
          });
        }

        if (toolId === "team.delegate") {
          const parsed = z
            .object({
              teammateId: z.string().min(1).max(64),
              task: z.string().min(1).max(200_000),
              input: z.unknown().optional(),
            })
            .safeParse(normalizedInput);
          if (!parsed.success) {
            return { status: "failed", error: "INVALID_TOOL_INPUT" };
          }
          const team = node.config.team ?? null;
          if (!team) {
            return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
          }
          const teammate = (team.teammates ?? []).find((t: any) => t.id === parsed.data.teammateId) ?? null;
          if (!teammate) {
            return { status: "failed", error: `TEAMMATE_NOT_FOUND:${parsed.data.teammateId}` };
          }

          const effectiveAllow = intersectAllowlist(policyToolsAllow, teammate.tools?.allow ?? []);
          const teammateNode = {
            ...node,
            config: {
              ...node.config,
              team: null,
              llm: {
                ...node.config.llm,
                model: teammate.llm?.model ?? node.config.llm.model,
              },
              prompt: {
                ...(teammate.prompt?.system ? { system: teammate.prompt.system } : {}),
                instructions: teammate.prompt.instructions,
                ...(teammate.prompt.inputTemplate ? { inputTemplate: teammate.prompt.inputTemplate } : {}),
              },
              tools: {
                ...node.config.tools,
                allow: effectiveAllow,
              },
              limits: teammate.limits,
              output: teammate.output,
            },
          };

          const nested = await runnerRun({
            ...input,
            requestId: `${input.requestId}:team:${teammate.id}`,
            nodeId: `${input.nodeId}:team:${teammate.id}`,
            node: teammateNode,
            policyToolsAllow,
            effectiveToolsAllow: effectiveAllow,
            runInput: { parentRunInput: input.runInput ?? null, task: parsed.data.task, input: parsed.data.input ?? null },
          });

          if (!nested.ok) {
            const toolPolicyDenied =
              typeof nested.error === "string" && nested.error.startsWith("TOOL_NOT_ALLOWED:")
                ? `TEAM_TOOL_POLICY_DENIED:${nested.error.slice("TOOL_NOT_ALLOWED:".length)}`
                : nested.error;
            return { status: "failed", error: toolPolicyDenied ?? "TEAM_DELEGATE_FAILED" };
          }
          return { status: "succeeded", output: { teammateId: teammate.id, output: nested.output ?? null } };
        }

        if (toolId === "team.map") {
          const parsed = z
            .object({
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
            })
            .safeParse(normalizedInput);
          if (!parsed.success) {
            return { status: "failed", error: "INVALID_TOOL_INPUT" };
          }

          const team = node.config.team ?? null;
          if (!team) {
            return { status: "failed", error: "TEAM_NOT_CONFIGURED" };
          }
          const maxParallel = Math.max(1, Math.min(16, parsed.data.maxParallel ?? team.maxParallel ?? 3));

          const tasks = parsed.data.tasks as TeamTask[];
          const results: any[] = new Array(tasks.length);
          let next = 0;

          async function runDelegate(task: TeamTask) {
            const out = await executeTool("team.delegate", task, { skipAllowlist: true });
            if (out.status === "succeeded") {
              return { status: "succeeded", ...(out.output as any) };
            }
            return { status: "failed", teammateId: task.teammateId, error: out.error };
          }

          async function worker() {
            for (;;) {
              const idx = next;
              next += 1;
              if (idx >= tasks.length) {
                return;
              }
              results[idx] = await runDelegate(tasks[idx]!);
            }
          }
          await Promise.all(new Array(Math.min(maxParallel, tasks.length)).fill(null).map(() => worker()));
          return { status: "succeeded", output: results };
        }

        return { status: "failed", error: `TOOL_NOT_SUPPORTED:${toolId}` };
      }

      // Runner function used for nested team calls.
      async function runnerRun(nestedInput: any): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
        return await createEngineRunner().run(nestedInput);
      }

      const allowedToolIds = allowedToolsRaw.filter((t) => typeof t === "string" && t.length > 0);

      const { tool, createSdkMcpServer, query } = await import("@anthropic-ai/claude-agent-sdk");

      const mcpToolNameByToolId = new Map<string, string>();
      const mcpTools = allowedToolIds.map((toolId) => {
        const mcpName = sanitizeMcpToolName(toolId);
        mcpToolNameByToolId.set(toolId, mcpName);

        const description =
          toolId.startsWith("skill.") && skills[toolId.slice("skill.".length)]
            ? `Local skill tool. ${skills[toolId.slice("skill.".length)]!.manifest.description}`
            : `Vespid tool: ${toolId}`;

        // NOTE: To keep schemas stable, we accept a generic JSON object payload for most tools.
        // Validation still happens in executeTool().
        const schema = { input: z.unknown().optional() };

        return tool(
          mcpName,
          description,
          schema,
          async (args: any) => {
            countToolCallOrThrow();
            const toolInput = args && typeof args === "object" && "input" in args ? (args as any).input : args;
            emit({
              kind: "agent.tool_call",
              payload: { callIndex: toolCalls, toolId, input: summarizeJson(toolInput, 20_000) },
            });
            const out = await executeTool(toolId, toolInput);
            const summarized = summarizeJson(out.output ?? null, 20_000);
            emit({
              kind: "agent.tool_result",
              level: out.status === "failed" ? "warn" : "info",
              payload: {
                callIndex: toolCalls,
                toolId,
                status: out.status,
                ...(out.status === "failed" ? { error: out.error } : {}),
                output: summarized,
              },
            });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    type: "tool_result",
                    toolId,
                    status: out.status,
                    ...(out.status === "failed" ? { error: out.error } : {}),
                    output: summarized,
                  }),
                },
              ],
            };
          }
        );
      });

      const mcpServer = createSdkMcpServer({ name: "vespid-tools", tools: mcpTools });
      const allowedMcpToolNames = allowedToolIds
        .map((toolId) => mcpToolNameByToolId.get(toolId))
        .filter((v): v is string => Boolean(v))
        .map((name) => `mcp__vespid-tools__${name}`);

      const steps = Array.isArray(input.steps) ? (input.steps as unknown[]) : [];
      const renderedTemplate = node.config.prompt.inputTemplate
        ? renderTemplate(node.config.prompt.inputTemplate, {
            runInput: input.runInput ?? null,
            steps,
          })
        : null;

      const baseUser = [
        JSON.stringify(
          {
            instructions: node.config.prompt.instructions,
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

      const systemPrompt = [
        node.config.prompt.system ? node.config.prompt.system : null,
        "You are a workflow agent node in Vespid.",
        "You MUST finish by outputting a single JSON object and nothing else.",
        "Final response envelope must be:",
        '{"type":"final","output":<any>}',
        `Allowed toolIds: ${JSON.stringify(allowedToolIds)}`,
      ]
        .filter(Boolean)
        .join("\n");

      const env = { ...process.env, ANTHROPIC_API_KEY: apiKey };
      const cwd = await resolveRunWorkdirHostPath({
        organizationId: input.organizationId,
        runId: input.runId,
        nodeId: input.nodeId,
        attemptCount: input.attemptCount,
      });

      const toolset = input && typeof input === "object" ? ((input as any).toolset ?? null) : null;
      const toolsetId = toolset && typeof toolset === "object" && typeof (toolset as any).id === "string" ? String((toolset as any).id) : "toolset";
      const mcpServersRaw = toolset && typeof toolset === "object" ? (toolset as any).mcpServers : null;
      const agentSkillsRaw = toolset && typeof toolset === "object" ? (toolset as any).agentSkills : null;

      let skillsEnabled = false;
      try {
        const staged = await stageAgentSkillBundles({
          cwd,
          toolsetId,
          bundles: Array.isArray(agentSkillsRaw) ? agentSkillsRaw : [],
        });
        skillsEnabled = staged.skillsEnabled;
      } catch (err) {
        const error = err instanceof Error && err.message ? err.message : "SKILL_STAGING_FAILED";
        return { ok: false as const, error };
      }

      const externalMcpServers: Record<string, any> = {};
      const externalAllowedTools: string[] = [];
      if (Array.isArray(mcpServersRaw)) {
        for (const server of mcpServersRaw) {
          if (!server || typeof server !== "object") {
            continue;
          }
          if ((server as any).enabled === false) {
            continue;
          }

          const name = typeof (server as any).name === "string" ? String((server as any).name) : "";
          if (!name || name.trim().length === 0) {
            continue;
          }
          if (name === "vespid-tools") {
            return { ok: false as const, error: "MCP_SERVER_NAME_RESERVED" };
          }
          if (externalMcpServers[name]) {
            return { ok: false as const, error: "MCP_SERVER_NAME_CONFLICT" };
          }

          const transport = typeof (server as any).transport === "string" ? String((server as any).transport) : "";
          if (transport === "stdio") {
            const command = typeof (server as any).command === "string" ? String((server as any).command) : "";
            if (!command || command.trim().length === 0) {
              return { ok: false as const, error: `MCP_SERVER_INVALID:${name}` };
            }
            const args = Array.isArray((server as any).args) ? (server as any).args.map((a: any) => String(a)) : [];
            const envResolved = resolvePlaceholderRecordOrThrow((server as any).env ?? null);
            externalMcpServers[name] = {
              type: "stdio",
              command,
              args,
              env: envResolved,
            };
          } else if (transport === "http") {
            const url = typeof (server as any).url === "string" ? String((server as any).url) : "";
            if (!url || url.trim().length === 0) {
              return { ok: false as const, error: `MCP_SERVER_INVALID:${name}` };
            }
            const headersResolved = resolvePlaceholderRecordOrThrow((server as any).headers ?? null);
            externalMcpServers[name] = {
              type: "http",
              url,
              headers: headersResolved,
            };
          } else {
            return { ok: false as const, error: `MCP_SERVER_INVALID:${name}` };
          }

          externalAllowedTools.push(`mcp__${name}__*`);
        }
      }

      const mcpServers = { "vespid-tools": mcpServer, ...externalMcpServers };
      const allowedTools = [...allowedMcpToolNames, ...externalAllowedTools, ...(skillsEnabled ? ["Skill"] : [])];

      const queryIterator = query({
        prompt: (async function* () {
          // Use streaming input mode (required for MCP servers).
          // The SDK's input message type may include extra fields; treat them as SDK-internal.
          yield { type: "user", message: { role: "user", content: baseUser } } as any;
        })() as any,
        options: {
          cwd,
          env,
          model: node.config.llm.model,
          maxTurns: node.config.limits.maxTurns,
          systemPrompt,
          tools: [],
          pathToClaudeCodeExecutable: claudePath,
          ...(skillsEnabled ? { settingSources: ["project"] } : {}),
          mcpServers,
          allowedTools,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        } as any,
      });

      let finalText: string | null = null;
      const consume = async () => {
        for await (const msg of queryIterator as any) {
          if (msg && msg.type === "stream_event") {
            const delta = deltaEmitter ? extractClaudeAssistantDeltaFromStreamEvent(msg) : null;
            if (deltaEmitter && delta) {
              deltaEmitter.write(delta);
            }
          }
          if (msg && msg.type === "assistant") {
            const text = extractAssistantText(msg.message);
            if (text && text.trim().length > 0) {
              emit({ kind: "agent.assistant_message", payload: { content: safeTruncate(text, 50_000) } });
            }
          }
          if (msg && msg.type === "result" && msg.subtype === "success" && typeof msg.result === "string") {
            finalText = msg.result;
            break;
          }
          if (msg && msg.type === "result" && msg.subtype === "error") {
            throw new Error(typeof msg.error === "string" ? msg.error : "ENGINE_FAILED");
          }
        }
      };

      const remainingMs = Math.max(1, deadline - Date.now());
      try {
        await Promise.race([
          consume(),
          new Promise<void>((_resolve, reject) => {
            const t = setTimeout(() => {
              clearTimeout(t);
              reject(new Error("LLM_TIMEOUT"));
            }, remainingMs);
          }),
        ]);
      } catch (err) {
        if (deltaEmitter) {
          deltaEmitter.finish();
        }
        const error = err instanceof Error && err.message ? err.message : "ENGINE_FAILED";
        return { ok: false as const, error };
      }

      if (deltaEmitter) {
        deltaEmitter.finish();
      }

      if (!finalText) {
        return { ok: false as const, error: "ENGINE_FAILED" };
      }

      const envelope = parseFinalEnvelope(safeTruncate(finalText, node.config.limits.maxOutputChars));
      if (!envelope.ok) {
        return { ok: false as const, error: envelope.error };
      }

      // Output validation matches the vespid loop behavior.
      const output = envelope.output;
      if (node.config.output.mode === "json") {
        try {
          JSON.stringify(output);
        } catch {
          return { ok: false as const, error: "INVALID_AGENT_JSON_OUTPUT" };
        }
        if (node.config.output.jsonSchema !== undefined) {
          const compiled = compileSchema(node.config.output.jsonSchema);
          if (!compiled.ok) {
            return { ok: false as const, error: compiled.error };
          }
          if (!compiled.validate(output)) {
            return { ok: false as const, error: "INVALID_AGENT_JSON_OUTPUT" };
          }
        }
      }

      const meta = {
        provider: "anthropic",
        model: node.config.llm.model,
        toolCalls,
      };
      const outputWithMeta =
        output && typeof output === "object" && !Array.isArray(output)
          ? { ...(output as any), _meta: meta }
          : { output, _meta: meta };

      emit({ kind: "agent.final", payload: { toolCalls, output: summarizeJson(output, 20_000) } });

      return { ok: true as const, output: outputWithMeta };
    },
  };
}
