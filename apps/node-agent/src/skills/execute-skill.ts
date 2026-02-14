import fs from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import type { LoadedSkill } from "./types.js";
import type { SandboxBackend } from "../sandbox/index.js";
import { assertSubpath, ensureDir } from "../sandbox/util.js";
import { resolveRunWorkdirHostPath } from "../sandbox/workdir.js";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
    // Ignore sockets/devices/etc.
  }
}

function extractStdout(execOutput: unknown): string {
  const obj = asObject(execOutput);
  const stdout = obj && typeof obj.stdout === "string" ? obj.stdout : "";
  return stdout;
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

export async function executeSkill(input: {
  skill: LoadedSkill;
  args: unknown;
  sandbox: SandboxBackend;
  organizationId: string;
  userId: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  attemptCount: number;
}): Promise<
  | { status: "succeeded"; output: unknown }
  | { status: "failed"; error: string; output?: unknown }
> {
  const compiled = compileSchema(input.skill.manifest.inputSchema);
  if (!compiled.ok) {
    return { status: "failed", error: compiled.error };
  }
  const ok = Boolean(compiled.validate(input.args));
  if (!ok) {
    return { status: "failed", error: "INVALID_SKILL_INPUT" };
  }

  const workdir = await resolveRunWorkdirHostPath({
    organizationId: input.organizationId,
    runId: input.runId,
    nodeId: input.nodeId,
    attemptCount: input.attemptCount,
  });

  const skillsRoot = path.join(workdir, "skills");
  const skillDstDir = path.join(skillsRoot, input.skill.id);
  const resolvedWorkdir = path.resolve(workdir);
  const resolvedDst = path.resolve(skillDstDir);
  assertSubpath(resolvedWorkdir, resolvedDst);

  // Stage files (best-effort overwrite).
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

  const cmd =
    input.skill.manifest.runtime === "node"
      ? `node "${entrypointPath}"`
      : `sh "${entrypointPath}"`;

  const script = `cat "${inputPath}" | ${cmd}`;

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
