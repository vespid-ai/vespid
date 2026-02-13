import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const outputPath = process.argv[2] ?? "artifacts/sbom/community-sbom.json";

const packageFiles = [
  ...new Set(
    execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith("/package.json") || line === "package.json")
  ),
];

const components = packageFiles.map((file) => {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  return {
    path: file,
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? null,
    private: Boolean(pkg.private),
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      bomFormat: "vespid-sbom",
      specVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceCommit: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
      components,
    },
    null,
    2
  ) + "\n"
);

console.log(`SBOM written to ${outputPath}`);
