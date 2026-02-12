import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateUp } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const runIntegration = Boolean(databaseUrl);

const describeIf = runIntegration ? describe : describe.skip;

describeIf("RLS integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }
    pool = new Pool({ connectionString: databaseUrl });
    await migrateUp(databaseUrl);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("returns no rows when tenant context points to another org", async () => {
    if (!databaseUrl) {
      return;
    }

    const admin = await pool.query<{ id: string }>(
      "insert into users(email, password_hash) values ('rls-admin@example.com', 'x') returning id"
    );
    const other = await pool.query<{ id: string }>(
      "insert into users(email, password_hash) values ('rls-other@example.com', 'x') returning id"
    );

    const orgA = await pool.query<{ id: string }>(
      "insert into organizations(name, slug) values ('Org A', concat('org-a-', floor(random()*1000000)::int)) returning id"
    );
    const orgB = await pool.query<{ id: string }>(
      "insert into organizations(name, slug) values ('Org B', concat('org-b-', floor(random()*1000000)::int)) returning id"
    );

    const adminId = admin.rows.at(0)?.id;
    const otherId = other.rows.at(0)?.id;
    const orgAId = orgA.rows.at(0)?.id;
    const orgBId = orgB.rows.at(0)?.id;
    if (!adminId || !otherId || !orgAId || !orgBId) {
      throw new Error("Failed to setup test fixture rows");
    }

    await pool.query("insert into memberships(organization_id, user_id, role_key) values ($1, $2, 'owner')", [
      orgAId,
      adminId,
    ]);
    await pool.query("insert into memberships(organization_id, user_id, role_key) values ($1, $2, 'owner')", [
      orgBId,
      otherId,
    ]);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.current_org_id', $1, true)",
        [orgBId]
      );

      const hidden = await client.query("select id from organizations where id = $1", [orgAId]);
      expect(hidden.rowCount).toBe(0);

      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
