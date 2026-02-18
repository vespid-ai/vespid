import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const REQUIRED_ROOT_FILES = ["LICENSE", "NOTICE", "COPYRIGHT"];
const ROOT = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expectedLicense(path) {
  return "Apache-2.0";
}

function main() {
  for (const file of REQUIRED_ROOT_FILES) {
    if (!existsSync(join(ROOT, file))) {
      throw new Error(`Missing required root license artifact: ${file}`);
    }
  }

  const packageFiles = [
    ...new Set(
      execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith("/package.json") || line === "package.json")
    ),
  ];

  const failures = [];

  for (const pkgFile of packageFiles) {
    const pkg = readJson(pkgFile);
    const expected = expectedLicense(pkgFile);

    if (!pkg.license) {
      failures.push(`${pkgFile}: missing license field (expected ${expected})`);
      continue;
    }

    if (pkg.license !== expected) {
      failures.push(`${pkgFile}: license=${pkg.license} (expected ${expected})`);
    }

    if (pkgFile.startsWith("packages/sdk-") && !existsSync(join(ROOT, pkgFile.replace("package.json", "LICENSE")))) {
      failures.push(`${pkgFile}: SDK package must include package-local LICENSE file`);
    }
  }

  if (failures.length > 0) {
    console.error("License SPDX check failed:");
    for (const line of failures) {
      console.error(`- ${line}`);
    }
    process.exit(1);
  }

  console.log(`License SPDX check passed for ${packageFiles.length} package manifests.`);
}

main();
