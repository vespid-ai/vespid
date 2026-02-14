import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import type { ExecuteShellTaskContext, SandboxBackend, SandboxExecuteResult, SandboxNetworkMode } from "./types.js";
import { sha256Hex, truncateString } from "./util.js";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";
import { resolveRunWorkdirHostPath } from "./workdir.js";

type DockerLimits = {
  timeoutMs: number;
  memoryMb: number;
  cpus: number;
  pids: number;
  outputMaxChars: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function defaultLimits(): DockerLimits {
  return {
    timeoutMs: Math.max(1000, envNumber("VESPID_AGENT_DOCKER_TIMEOUT_MS", 30_000)),
    memoryMb: Math.max(64, envNumber("VESPID_AGENT_DOCKER_MEMORY_MB", 256)),
    cpus: Math.max(0.1, envNumber("VESPID_AGENT_DOCKER_CPUS", 1)),
    pids: Math.max(64, envNumber("VESPID_AGENT_DOCKER_PIDS", 256)),
    outputMaxChars: Math.max(1024, envNumber("VESPID_AGENT_DOCKER_OUTPUT_MAX_CHARS", 65_536)),
  };
}

function defaultNetwork(): SandboxNetworkMode {
  const raw = process.env.VESPID_AGENT_DOCKER_NETWORK_DEFAULT ?? "none";
  return raw === "enabled" ? "enabled" : "none";
}

function defaultImage(): string {
  return process.env.VESPID_AGENT_DOCKER_IMAGE ?? "node:24-alpine";
}

function buildContainerName(requestId: string): string {
  // Docker name max length is 128; keep it short.
  return `vespid-${sha256Hex(requestId).slice(0, 24)}`;
}

export function buildDockerRunArgs(input: {
  containerName: string;
  image: string;
  workdirHostPath: string;
  script: string;
  shell: "sh" | "bash";
  env: Record<string, string>;
  networkMode: SandboxNetworkMode;
  limits: DockerLimits;
}): string[] {
  const args: string[] = [
    "run",
    "--rm",
    "--init",
    "--name",
    input.containerName,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    `${input.limits.memoryMb}m`,
    "--cpus",
    String(input.limits.cpus),
    "--pids-limit",
    String(input.limits.pids),
    "-v",
    `${input.workdirHostPath}:/work:rw`,
    "-w",
    "/work",
  ];

  if (input.networkMode === "none") {
    args.push("--network", "none");
  }

  // Best-effort non-root user. Prefer host uid/gid when available.
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  if (typeof uid === "number" && typeof gid === "number") {
    args.push("--user", `${uid}:${gid}`);
  } else {
    args.push("--user", "1000:1000");
  }

  for (const [key, value] of Object.entries(input.env)) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(input.image);

  const shellCmd = input.shell === "bash" ? "bash" : "sh";
  args.push(shellCmd, "-lc", input.script);
  return args;
}

async function runDocker(
  args: string[],
  input: { timeoutMs: number; containerName: string; outputMaxChars: number }
): Promise<{ exitCode: number | null; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean; timedOut: boolean }> {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdoutTruncated) {
        return;
      }
      stdout += chunk;
      if (stdout.length > input.outputMaxChars) {
        stdout = stdout.slice(0, input.outputMaxChars);
        stdoutTruncated = true;
      }
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderrTruncated) {
        return;
      }
      stderr += chunk;
      if (stderr.length > input.outputMaxChars) {
        stderr = stderr.slice(0, input.outputMaxChars);
        stderrTruncated = true;
      }
    });
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    // Best-effort: kill the container by name, then remove it.
    try {
      spawn("docker", ["kill", input.containerName], { stdio: "ignore" });
      spawn("docker", ["rm", "-f", input.containerName], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }, input.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(typeof code === "number" ? code : null));
    child.on("error", () => resolve(null));
  });

  clearTimeout(timeout);
  return { exitCode, stdout, stderr, stdoutTruncated, stderrTruncated, timedOut };
}

export function createDockerBackend(): SandboxBackend {
  const limits = defaultLimits();
  async function resolveWorkdirHostPath(ctx: ExecuteShellTaskContext): Promise<string> {
    const resolvedWorkdir = await resolveRunWorkdirHostPath({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      attemptCount: ctx.attemptCount,
    });
    // Ensure the container user can write even when uid/gid doesn't match.
    try {
      await fs.chmod(resolvedWorkdir, 0o777);
    } catch {
      // ignore
    }
    return resolvedWorkdir;
  }

  function buildEnv(ctx: ExecuteShellTaskContext): Record<string, string> {
    const env: Record<string, string> = { ...ctx.taskEnv };
    for (const key of ctx.envPassthroughAllowlist ?? []) {
      if (typeof key !== "string" || key.length === 0) {
        continue;
      }
      const value = process.env[key];
      if (typeof value === "string" && value.length > 0) {
        env[key] = value;
      }
    }
    return env;
  }

  return {
    async executeShellTask(ctx: ExecuteShellTaskContext): Promise<SandboxExecuteResult> {
      const containerName = buildContainerName(ctx.requestId);
      const workdirHostPath = await resolveWorkdirHostPath(ctx);
      const image = ctx.dockerImage ?? defaultImage();
      const timeoutMs = ctx.timeoutMs ?? limits.timeoutMs;
      const networkMode = ctx.networkMode ?? defaultNetwork();
      const env = buildEnv(ctx);

      const args = buildDockerRunArgs({
        containerName,
        image,
        workdirHostPath,
        script: ctx.script,
        shell: ctx.shell,
        env,
        networkMode,
        limits,
      });

      const result = await runDocker(args, {
        timeoutMs,
        containerName,
        outputMaxChars: limits.outputMaxChars,
      });

      const stdout = truncateString(result.stdout, limits.outputMaxChars);
      const stderr = truncateString(result.stderr, limits.outputMaxChars);

      const output = {
        backend: "docker",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: stdout.value,
        stderr: stderr.value,
        stdoutTruncated: stdout.truncated || result.stdoutTruncated,
        stderrTruncated: stderr.truncated || result.stderrTruncated,
      };

      if (result.timedOut) {
        return { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout, output };
      }

      if (result.exitCode === 0) {
        return { status: "succeeded", output };
      }

      if (typeof result.exitCode === "number") {
        return { status: "failed", error: `DOCKER_EXIT_CODE:${result.exitCode}`, output };
      }

      return { status: "failed", error: REMOTE_EXEC_ERROR.DockerFailed, output };
    },
    async close() {
      return;
    },
  };
}
