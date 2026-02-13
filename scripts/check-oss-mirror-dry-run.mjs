import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function readAllowlist() {
  return readFileSync(".oss-allowlist", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function isAllowed(path, allowlist) {
  return allowlist.some((prefix) => path === prefix || path.startsWith(prefix));
}

function isEnterprisePath(path) {
  return /(^|\/)enterprise(\/|$)|^packages\/enterprise-|^apps\/api-enterprise/.test(path);
}

function main() {
  const allowlist = readAllowlist();
  const trackedFiles = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mirroredFiles = trackedFiles.filter((file) => isAllowed(file, allowlist));
  for (const file of mirroredFiles) {
    if (!existsSync(file)) {
      console.warn(`Mirror dry-run warning: missing file on disk (dirty worktree?): ${file}`);
    }
  }
  const leaked = mirroredFiles.filter((file) => isEnterprisePath(file));

  if (mirroredFiles.length === 0) {
    console.error("Mirror dry-run failed: no files matched .oss-allowlist");
    process.exit(1);
  }

  if (leaked.length > 0) {
    console.error("Mirror dry-run failed: enterprise paths matched allowlist");
    for (const file of leaked) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  const requiredPublicFiles = ["LICENSE", "NOTICE", "README.md"];
  const missingRequired = requiredPublicFiles.filter((file) => !mirroredFiles.includes(file));
  if (missingRequired.length > 0) {
    console.error("Mirror dry-run failed: missing required public files");
    for (const file of missingRequired) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  console.log(`Mirror dry-run passed. ${mirroredFiles.length} files would be mirrored.`);
}

main();
