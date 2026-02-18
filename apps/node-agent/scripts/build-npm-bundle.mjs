#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(scriptDir, "..");
  const rootDir = path.resolve(projectDir, "../..");
  const distDir = path.join(projectDir, "dist", "npm");
  const bundlePath = path.join(distDir, "cli.cjs");
  const srcEntry = path.join(projectDir, "src", "cli.ts");
  const packageJsonPath = path.join(projectDir, "package.json");
  const outPackageJsonPath = path.join(distDir, "package.json");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await runCommand(
    pnpm,
    [
      "exec",
      "esbuild",
      srcEntry,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node18",
      "--banner:js=#!/usr/bin/env node",
      `--outfile=${bundlePath}`,
    ],
    projectDir
  );

  await chmod(bundlePath, 0o755);

  const pkgRaw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const publishPackage = {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    description: "Vespid BYON worker-node agent CLI.",
    bin: {
      "vespid-agent": "cli.cjs",
    },
    type: "commonjs",
    engines: {
      node: ">=18",
    },
    repository: {
      type: "git",
      url: "https://github.com/vespid-ai/vespid.git",
      directory: "apps/node-agent",
    },
  };

  await writeFile(outPackageJsonPath, JSON.stringify(publishPackage, null, 2), "utf8");

  for (const fileName of ["LICENSE", "NOTICE"]) {
    const filePath = path.join(rootDir, fileName);
    try {
      const raw = await readFile(filePath, "utf8");
      await writeFile(path.join(distDir, fileName), raw, "utf8");
    } catch {
      // Optional for local dev.
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Built npm bundle: ${bundlePath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
