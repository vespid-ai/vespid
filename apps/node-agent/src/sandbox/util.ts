import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

export function resolveHome(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function assertSubpath(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolvedCandidate.startsWith(prefix)) {
    throw new Error("WORKDIR_PATH_ESCAPE");
  }
}

export function truncateString(input: string, maxChars: number): { value: string; truncated: boolean } {
  if (input.length <= maxChars) {
    return { value: input, truncated: false };
  }
  return { value: input.slice(0, maxChars), truncated: true };
}

