import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import type { WorkspacePointerV1 } from "@vespid/shared";

type WorkspaceAccess = {
  downloadUrl?: string | null;
  upload: { url: string; objectKey: string; version: number };
};

function resolveRoot(): string {
  const raw = process.env.VESPID_EXECUTOR_WORKSPACE_CACHE_ROOT ?? "~/.vespid/workspaces";
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function workspaceVersionDir(workspaceId: string, version: number): string {
  return path.join(resolveRoot(), workspaceId, String(version));
}

function extractedDir(workspaceId: string, version: number): string {
  return path.join(workspaceVersionDir(workspaceId, version), "extracted");
}

function snapshotPath(workspaceId: string, version: number): string {
  return path.join(workspaceVersionDir(workspaceId, version), `${version}.tar.zst`);
}

function tarPath(workspaceId: string, version: number): string {
  return path.join(workspaceVersionDir(workspaceId, version), `${version}.tar`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd}_FAILED:${code}:${stderr.slice(0, 500)}`));
    });
  });
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WORKSPACE_DOWNLOAD_FAILED:${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function uploadFile(url: string, filePath: string): Promise<string | null> {
  const bytes = await fs.readFile(filePath);
  const response = await fetch(url, {
    method: "PUT",
    body: bytes,
    headers: {
      "content-type": "application/zstd",
    },
  });
  if (!response.ok) {
    throw new Error(`WORKSPACE_UPLOAD_FAILED:${response.status}`);
  }
  const etag = response.headers.get("etag");
  return etag && etag.length > 0 ? etag : null;
}

export function verifyWorkspaceDependencies(): void {
  const tar = spawnSync("tar", ["--version"], { stdio: "ignore" });
  if (tar.status !== 0) {
    throw new Error("MISSING_BINARY:tar");
  }
  const zstd = spawnSync("zstd", ["--version"], { stdio: "ignore" });
  if (zstd.status !== 0) {
    throw new Error("MISSING_BINARY:zstd");
  }
}

export async function ensureWorkspaceExtracted(input: {
  pointer: WorkspacePointerV1;
  access: WorkspaceAccess;
}): Promise<{ workdir: string; cacheHit: boolean }> {
  const dir = extractedDir(input.pointer.workspaceId, input.pointer.version);
  if (await exists(dir)) {
    return { workdir: dir, cacheHit: true };
  }

  await fs.mkdir(dir, { recursive: true });

  // Empty workspace bootstrap.
  if (input.pointer.version === 0 && !input.access.downloadUrl) {
    return { workdir: dir, cacheHit: false };
  }

  if (!input.access.downloadUrl) {
    throw new Error("WORKSPACE_DOWNLOAD_URL_REQUIRED");
  }

  const zst = snapshotPath(input.pointer.workspaceId, input.pointer.version);
  const tar = tarPath(input.pointer.workspaceId, input.pointer.version);
  if (!(await exists(zst))) {
    await downloadToFile(input.access.downloadUrl, zst);
  }
  await runCommand("zstd", ["-d", "-f", zst, "-o", tar]);
  await runCommand("tar", ["-xf", tar, "-C", dir]);
  return { workdir: dir, cacheHit: false };
}

export async function snapshotAndUploadWorkspace(input: {
  pointer: WorkspacePointerV1;
  access: WorkspaceAccess;
  workdir: string;
}): Promise<WorkspacePointerV1> {
  const uploadVersion = input.access.upload.version;
  const workspaceId = input.pointer.workspaceId;
  const outDir = workspaceVersionDir(workspaceId, uploadVersion);
  await fs.mkdir(outDir, { recursive: true });
  const tar = tarPath(workspaceId, uploadVersion);
  const zst = snapshotPath(workspaceId, uploadVersion);

  await runCommand("tar", ["-cf", tar, "-C", input.workdir, "."]);
  await runCommand("zstd", ["-T0", "-f", tar, "-o", zst]);
  const etag = await uploadFile(input.access.upload.url, zst);

  return {
    workspaceId,
    version: uploadVersion,
    objectKey: input.access.upload.objectKey,
    ...(etag ? { etag } : {}),
  };
}

