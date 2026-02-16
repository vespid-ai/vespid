import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../packages/db/migrations");
const strictMode =
  process.env.MIGRATION_DOWN_STRICT === "1" || process.env.MIGRATION_DOWN_STRICT === "true";

async function main() {
  const allFiles = await fs.readdir(migrationsDir);
  const upFiles = allFiles
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort((a, b) => a.localeCompare(b));

  if (upFiles.length === 0) {
    throw new Error(`No up migrations found in ${migrationsDir}`);
  }

  const fileSet = new Set(allFiles);
  const missing = [];
  const strictViolations = [];

  for (const upFile of upFiles) {
    const downFile = upFile.replace(/\.sql$/, ".down.sql");
    if (!fileSet.has(downFile)) {
      missing.push({ upFile, downFile });
      continue;
    }

    if (!strictMode) {
      continue;
    }

    const downSql = await fs.readFile(path.join(migrationsDir, downFile), "utf8");
    const hasPlaceholder =
      downSql.includes("Down migration template for") ||
      downSql.includes("Down migration not implemented for");
    if (hasPlaceholder) {
      strictViolations.push(downFile);
    }
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error("Missing rollback migration files:");
    for (const item of missing) {
      // eslint-disable-next-line no-console
      console.error(`- ${item.upFile} -> expected ${item.downFile}`);
    }
    process.exit(1);
  }

  if (strictViolations.length > 0) {
    // eslint-disable-next-line no-console
    console.error("Rollback migration files still use template placeholders:");
    for (const file of strictViolations) {
      // eslint-disable-next-line no-console
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Migration rollback check passed (${upFiles.length} up migration(s), strict=${strictMode ? "on" : "off"}).`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
