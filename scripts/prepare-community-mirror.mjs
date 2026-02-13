import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

function parseArgs() {
  const outIndex = process.argv.indexOf("--out");
  return {
    outDir: outIndex >= 0 ? process.argv[outIndex + 1] : ".community-mirror",
  };
}

function readAllowlist() {
  return readFileSync(".oss-allowlist", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function isAllowed(path, allowlist) {
  return allowlist.some((prefix) => path === prefix || path.startsWith(prefix));
}

function main() {
  const { outDir } = parseArgs();
  const allowlist = readAllowlist();
  const trackedFiles = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mirroredCandidates = trackedFiles.filter((file) => isAllowed(file, allowlist));
  const mirroredFiles = [];
  for (const file of mirroredCandidates) {
    if (!existsSync(file)) {
      console.warn(`Skipping missing file (dirty worktree?): ${file}`);
      continue;
    }
    mirroredFiles.push(file);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const file of mirroredFiles) {
    const target = join(outDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }

  writeFileSync(
    join(outDir, ".mirror-manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceCommit: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
        fileCount: mirroredFiles.length,
        files: mirroredFiles,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`Prepared community mirror at ${outDir} with ${mirroredFiles.length} files.`);
}

main();
