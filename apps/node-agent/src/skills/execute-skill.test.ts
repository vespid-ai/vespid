import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LoadedSkill } from "./types.js";
import { executeSkill } from "./execute-skill.js";

async function mkTmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "vespid-skill-exec-"));
}

async function writeSkill(input: {
  skillsRoot: string;
  id: string;
  outputMode: "text" | "json";
}): Promise<LoadedSkill> {
  const dirPath = path.join(input.skillsRoot, input.id);
  await fs.mkdir(path.join(dirPath, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(dirPath, "skill.json"),
    JSON.stringify({
      id: input.id,
      version: "1.0.0",
      description: "Test skill",
      entrypoint: "scripts/run.sh",
      runtime: "shell",
      inputSchema: { type: "object", additionalProperties: true },
      outputMode: input.outputMode,
      sandbox: { backend: "host", network: "enabled", timeoutMs: 10_000 },
    }),
    "utf8"
  );
  await fs.writeFile(path.join(dirPath, "scripts", "run.sh"), "echo ok", "utf8");

  return {
    id: input.id,
    dirPath,
    manifest: {
      id: input.id,
      version: "1.0.0",
      description: "Test skill",
      entrypoint: "scripts/run.sh",
      runtime: "shell",
      inputSchema: { type: "object", additionalProperties: true },
      outputMode: input.outputMode,
      sandbox: { backend: "host", network: "enabled", timeoutMs: 10_000 },
    } as any,
    doc: null,
  };
}

describe("skills executor", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("executes a skill via sandbox and returns json output", async () => {
    const root = await mkTmpDir();
    const workdirRoot = path.join(root, "workdir");
    const skillsRoot = path.join(root, "skills");
    await fs.mkdir(skillsRoot, { recursive: true });
    process.env.VESPID_AGENT_WORKDIR_ROOT = workdirRoot;

    const skill = await writeSkill({ skillsRoot, id: "hello", outputMode: "json" });

    const sandbox = {
      async executeShellTask(ctx: any) {
        expect(ctx.script).toContain(`skills/${skill.id}/`);
        expect(ctx.taskEnv.VESPID_SKILL_ID).toBe("hello");
        expect(ctx.taskEnv.VESPID_ORG_ID).toBe("11111111-1111-4111-8111-111111111111");
        expect(ctx.taskEnv.VESPID_RUN_ID).toBe("33333333-3333-4333-8333-333333333333");
        expect(ctx.backend).toBe("host");
        return { status: "succeeded", output: { stdout: "{\"ok\":true}", stderr: "" } };
      },
    } as any;

    const result = await executeSkill({
      skill,
      args: { x: 1 },
      sandbox,
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      workflowId: "44444444-4444-4444-8444-444444444444",
      nodeId: "n1",
      attemptCount: 1,
    });

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.output).toEqual({ ok: true });
    }
  });

  it("fails when json output cannot be parsed", async () => {
    const root = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(root, "workdir");
    const skillsRoot = path.join(root, "skills");
    await fs.mkdir(skillsRoot, { recursive: true });

    const skill = await writeSkill({ skillsRoot, id: "badjson", outputMode: "json" });

    const sandbox = {
      async executeShellTask() {
        return { status: "succeeded", output: { stdout: "not json", stderr: "" } };
      },
    } as any;

    const result = await executeSkill({
      skill,
      args: {},
      sandbox,
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      workflowId: "44444444-4444-4444-8444-444444444444",
      nodeId: "n1",
      attemptCount: 1,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("SKILL_OUTPUT_INVALID_JSON");
    }
  });

  it("rejects symlinks during staging", async () => {
    const root = await mkTmpDir();
    process.env.VESPID_AGENT_WORKDIR_ROOT = path.join(root, "workdir");
    const skillsRoot = path.join(root, "skills");
    await fs.mkdir(skillsRoot, { recursive: true });

    const skill = await writeSkill({ skillsRoot, id: "symlink", outputMode: "text" });

    // Add a symlink inside the skill directory.
    const linkPath = path.join(skill.dirPath, "scripts", "link");
    await fs.symlink("../skill.json", linkPath);

    const sandbox = {
      async executeShellTask() {
        throw new Error("sandbox should not run");
      },
    } as any;

    const result = await executeSkill({
      skill,
      args: {},
      sandbox,
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      workflowId: "44444444-4444-4444-8444-444444444444",
      nodeId: "n1",
      attemptCount: 1,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe("SKILL_SYMLINK_NOT_ALLOWED");
    }
  });
});

