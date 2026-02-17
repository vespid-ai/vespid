#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function currentPlatformInfo() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      platformId: "darwin-arm64",
      pkgTarget: "node18-macos-arm64",
      executableName: "vespid-agent",
      archiveName: "vespid-agent-darwin-arm64.tar.gz",
    };
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      platformId: "linux-x64",
      pkgTarget: "node18-linux-x64",
      executableName: "vespid-agent",
      archiveName: "vespid-agent-linux-x64.tar.gz",
    };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      platformId: "windows-x64",
      pkgTarget: "node18-win-x64",
      executableName: "vespid-agent.exe",
      archiveName: "vespid-agent-windows-x64.zip",
    };
  }
  throw new Error(`Unsupported platform for standalone binary: ${process.platform}-${process.arch}`);
}

async function runCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? -1}`));
    });
  });
}

async function main() {
  const info = currentPlatformInfo();
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(scriptDir, "..");
  const distDir = path.join(projectDir, "dist", "standalone");
  const artifactsDir = path.join(projectDir, "artifacts");
  const entryPath = path.join(projectDir, "src", "cli.ts");
  const bundlePath = path.join(distDir, "cli.cjs");
  const binaryPath = path.join(distDir, info.executableName);
  const archivePath = path.join(artifactsDir, info.archiveName);
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await rm(archivePath, { force: true });

  await runCommand(
    pnpm,
    [
      "exec",
      "esbuild",
      entryPath,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node18",
      `--outfile=${bundlePath}`,
    ],
    projectDir
  );

  await runCommand(
    pnpm,
    ["exec", "pkg", bundlePath, "--targets", info.pkgTarget, "--output", binaryPath],
    projectDir
  );

  if (process.platform === "win32") {
    await runCommand(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${binaryPath}' -DestinationPath '${archivePath}' -Force`,
      ],
      projectDir
    );
  } else {
    await runCommand("tar", ["-czf", archivePath, "-C", distDir, info.executableName], projectDir);
  }

  // eslint-disable-next-line no-console
  console.log(`Built standalone node-agent artifact: ${archivePath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
