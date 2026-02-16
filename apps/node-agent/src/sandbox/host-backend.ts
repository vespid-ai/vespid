import { spawn } from "node:child_process";
import type { ExecuteShellTaskContext, SandboxBackend, SandboxExecuteResult } from "./types.js";
import { truncateString } from "./util.js";
import { resolveRunWorkdirHostPath } from "./workdir.js";
import { REMOTE_EXEC_ERROR } from "@vespid/shared";

type HostLimits = {
  outputMaxChars: number;
  killGraceMs: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function defaultLimits(): HostLimits {
  return {
    outputMaxChars: Math.max(1024, envNumber("VESPID_AGENT_HOST_OUTPUT_MAX_CHARS", 65_536)),
    killGraceMs: Math.max(0, envNumber("VESPID_AGENT_HOST_KILL_GRACE_MS", 500)),
  };
}

function buildMinimalHostEnv(): Record<string, string> {
  const allow = new Set(["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL"]);
  const out: Record<string, string> = {};
  for (const key of allow) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

function buildEnv(ctx: ExecuteShellTaskContext): Record<string, string> {
  // Do not pass through the entire parent process env. Only pass minimal
  // execution env + allowlisted keys + taskEnv overrides.
  const env: Record<string, string> = { ...buildMinimalHostEnv(), ...ctx.taskEnv };
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

async function runHost(input: {
  cwd: string;
  env: Record<string, string>;
  shell: "sh" | "bash";
  script: string;
  timeoutMs: number;
  limits: HostLimits;
}): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}> {
  const shellCmd = input.shell === "bash" ? "bash" : "sh";
  const child = spawn(shellCmd, ["-lc", input.script], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

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
      if (stdout.length > input.limits.outputMaxChars) {
        stdout = stdout.slice(0, input.limits.outputMaxChars);
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
      if (stderr.length > input.limits.outputMaxChars) {
        stderr = stderr.slice(0, input.limits.outputMaxChars);
        stderrTruncated = true;
      }
    });
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    if (input.limits.killGraceMs > 0) {
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, input.limits.killGraceMs);
    }
  }, input.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(typeof code === "number" ? code : null));
    child.on("error", () => resolve(null));
  });

  clearTimeout(timeout);

  const stdoutFinal = truncateString(stdout, input.limits.outputMaxChars);
  const stderrFinal = truncateString(stderr, input.limits.outputMaxChars);
  return {
    exitCode,
    stdout: stdoutFinal.value,
    stderr: stderrFinal.value,
    stdoutTruncated: stdoutFinal.truncated || stdoutTruncated,
    stderrTruncated: stderrFinal.truncated || stderrTruncated,
    timedOut,
  };
}

export function createHostBackend(): SandboxBackend {
  const limits = defaultLimits();

  return {
    async executeShellTask(ctx: ExecuteShellTaskContext): Promise<SandboxExecuteResult> {
      if (ctx.networkMode === "none") {
        return { status: "failed", error: "HOST_NETWORK_MODE_UNSUPPORTED" };
      }

      const cwd = await resolveRunWorkdirHostPath({
        organizationId: ctx.organizationId,
        runId: ctx.runId,
        nodeId: ctx.nodeId,
        attemptCount: ctx.attemptCount,
      });
      const resolvedCwd = ctx.workdirHostPath && ctx.workdirHostPath.trim().length > 0 ? ctx.workdirHostPath : cwd;

      const timeoutMs = ctx.timeoutMs ?? 30_000;
      const env = buildEnv(ctx);

      const result = await runHost({
        cwd: resolvedCwd,
        env,
        shell: ctx.shell,
        script: ctx.script,
        timeoutMs,
        limits,
      });

      const output = {
        backend: "host",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      };

      if (result.timedOut) {
        return { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout, output };
      }
      if (result.exitCode === 0) {
        return { status: "succeeded", output };
      }
      if (typeof result.exitCode === "number") {
        return { status: "failed", error: `HOST_EXIT_CODE:${result.exitCode}`, output };
      }
      return { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionFailed, output };
    },
    async close() {
      return;
    },
  };
}
