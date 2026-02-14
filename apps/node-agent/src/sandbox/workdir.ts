import path from "node:path";
import { assertSubpath, ensureDir, resolveHome } from "./util.js";

function resolveWorkdirRoot(): string {
  const raw = process.env.VESPID_AGENT_WORKDIR_ROOT ?? "~/.vespid/workdir";
  return resolveHome(raw);
}

export async function resolveRunWorkdirHostPath(input: {
  organizationId: string;
  runId: string | null;
  nodeId: string;
  attemptCount: number | null;
}): Promise<string> {
  const workdirRoot = resolveWorkdirRoot();
  const attempt = input.attemptCount ?? 1;
  const runId = input.runId ?? "run";
  const workdir = path.join(workdirRoot, input.organizationId, runId, input.nodeId, String(attempt));

  const resolvedRoot = path.resolve(workdirRoot);
  const resolvedWorkdir = path.resolve(workdir);
  assertSubpath(resolvedRoot, resolvedWorkdir);
  await ensureDir(resolvedWorkdir);
  return resolvedWorkdir;
}

