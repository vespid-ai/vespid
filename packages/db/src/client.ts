import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new Pool({ connectionString: databaseUrl });
}

export function createDb(pool: Pool | PoolClient): Db {
  return drizzle(pool, { schema });
}

export async function withTenantContext<T>(
  pool: Pool,
  input: { userId?: string; organizationId?: string },
  fn: (db: Db, client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `select
         set_config('app.current_user_id', $1, true),
         set_config('app.current_org_id', $2, true)`,
      [input.userId ?? "", input.organizationId ?? ""]
    );
    const db = createDb(client);
    const result = await fn(db, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
