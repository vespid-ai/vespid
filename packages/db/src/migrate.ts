import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./client.js";

export async function migrateUp(databaseUrl = process.env.DATABASE_URL): Promise<void> {
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

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const exists = await client.query<{ file_name: string }>(
        "select file_name from _vespid_migrations where file_name = $1",
        [file]
      );
      if (exists.rowCount && exists.rowCount > 0) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
      await client.query("insert into _vespid_migrations (file_name) values ($1)", [file]);
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
  migrateUp().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
