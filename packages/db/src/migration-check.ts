import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, "../migrations");
  const files = (await fs.readdir(migrationsDir)).filter(
    (file) => file.endsWith(".sql") && !file.endsWith(".down.sql")
  );

  if (files.length === 0) {
    throw new Error("No migration files found in packages/db/migrations");
  }

  const first = files.sort((a, b) => a.localeCompare(b))[0];
  if (!first) {
    throw new Error("Migration ordering failed");
  }

  const firstSql = await fs.readFile(path.join(migrationsDir, first), "utf8");
  const mustContain = [
    "create table if not exists organizations",
    "create table if not exists users",
    "create table if not exists memberships",
    "enable row level security",
  ];

  for (const token of mustContain) {
    if (!firstSql.toLowerCase().includes(token)) {
      throw new Error(`Migration ${first} is missing required token: ${token}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Migration check passed (${files.length} file(s)).`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
