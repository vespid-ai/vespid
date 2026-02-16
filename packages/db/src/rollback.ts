import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./client.js";

type RollbackOptions = {
  databaseUrl?: string;
  steps?: number;
};

function parseStepsArg(args: string[]): number {
  const withEquals = args.find((arg) => arg.startsWith("--steps="));
  if (withEquals) {
    const parsed = Number.parseInt(withEquals.split("=")[1] ?? "", 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Invalid --steps value. Use a positive integer.");
    }
    return parsed;
  }

  const index = args.findIndex((arg) => arg === "--steps");
  if (index >= 0) {
    const parsed = Number.parseInt(args[index + 1] ?? "", 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Invalid --steps value. Use a positive integer.");
    }
    return parsed;
  }

  return 1;
}

function resolveDownMigrationFile(fileName: string): string {
  if (!fileName.endsWith(".sql")) {
    throw new Error(`Migration file must end with .sql: ${fileName}`);
  }
  return fileName.replace(/\.sql$/, ".down.sql");
}

async function ensureFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function rollbackMigrations({
  databaseUrl = process.env.DATABASE_URL,
  steps = 1,
}: RollbackOptions = {}): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_MIGRATION_ROLLBACK !== "true") {
    throw new Error(
      "Rollback is blocked in production by default. Set ALLOW_PROD_MIGRATION_ROLLBACK=true to override."
    );
  }

  if (!Number.isInteger(steps) || steps <= 0) {
    throw new Error("steps must be a positive integer.");
  }

  const pool = createPool(databaseUrl);
  const client = await pool.connect();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, "../migrations");

  try {
    await client.query("BEGIN");
    await client.query(`
      create table if not exists _vespid_migrations (
        file_name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = await client.query<{ file_name: string }>(
      `
        select file_name
        from _vespid_migrations
        order by applied_at desc, file_name desc
        limit $1
      `,
      [steps]
    );

    for (const { file_name: fileName } of applied.rows) {
      const downFile = resolveDownMigrationFile(fileName);
      const downPath = path.join(migrationsDir, downFile);
      const exists = await ensureFileExists(downPath);

      if (!exists) {
        throw new Error(`Missing down migration for ${fileName}. Expected ${downFile}.`);
      }

      const sql = await fs.readFile(downPath, "utf8");
      await client.query(sql);
      await client.query("delete from _vespid_migrations where file_name = $1", [fileName]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const steps = parseStepsArg(process.argv.slice(2));

  rollbackMigrations({ steps }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
