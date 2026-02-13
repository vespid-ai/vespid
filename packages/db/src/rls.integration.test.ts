import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateUp } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const runIntegration = Boolean(databaseUrl);

const describeIf = runIntegration ? describe : describe.skip;

describeIf("RLS integration", () => {
  let pool: Pool;
  let appPool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }
    pool = new Pool({ connectionString: databaseUrl });
    await migrateUp(databaseUrl);

    // In CI we connect as `postgres` (superuser with BYPASSRLS). RLS is not
    // meaningful under superuser sessions, so create a restricted app role and
    // run the RLS assertions through that role.
    await pool.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'vespid_app') then
          create role vespid_app login password 'vespid_app' nosuperuser nocreatedb nocreaterole inherit noreplication;
        end if;
      end
      $$;
    `);
    await pool.query(`grant usage on schema public to vespid_app;`);
    await pool.query(`grant select, insert, update, delete on all tables in schema public to vespid_app;`);
    await pool.query(`grant usage, select on all sequences in schema public to vespid_app;`);

    const appUrl = new URL(databaseUrl);
    appUrl.username = "vespid_app";
    appUrl.password = "vespid_app";
    appPool = new Pool({ connectionString: appUrl.toString() });
  });

  afterAll(async () => {
    if (appPool) {
      await appPool.end();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("enforces strict tenant isolation with and without org context", async () => {
    if (!databaseUrl) {
      return;
    }

    const admin = await appPool.query<{ id: string }>(
      "insert into users(email, password_hash) values ($1, 'x') returning id",
      [`rls-admin-${Date.now()}@example.com`]
    );
    const other = await appPool.query<{ id: string }>(
      "insert into users(email, password_hash) values ($1, 'x') returning id",
      [`rls-other-${Date.now()}@example.com`]
    );

    const adminId = admin.rows.at(0)?.id;
    const otherId = other.rows.at(0)?.id;
    if (!adminId || !otherId) {
      throw new Error("Failed to setup users");
    }

    const orgAId = crypto.randomUUID();
    const orgBId = crypto.randomUUID();
    const workflowAId = crypto.randomUUID();
    const workflowBId = crypto.randomUUID();
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    const setup = await appPool.connect();
    try {
      await setup.query("begin");
      await setup.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true)",
        [adminId, orgAId]
      );
      await setup.query("insert into organizations(id, name, slug) values ($1, 'Org A', $2)", [
        orgAId,
        `org-a-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ]);
      await setup.query("insert into memberships(organization_id, user_id, role_key) values ($1, $2, 'owner')", [
        orgAId,
        adminId,
      ]);
      await setup.query(
        "insert into workflows(id, organization_id, name, status, version, dsl, created_by_user_id) values ($1, $2, 'Org A Workflow', 'published', 1, $3::jsonb, $4)",
        [
          workflowAId,
          orgAId,
          JSON.stringify({
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes: [{ id: "n1", type: "agent.execute" }],
          }),
          adminId,
        ]
      );
      await setup.query(
        "insert into workflow_runs(id, organization_id, workflow_id, trigger_type, status, requested_by_user_id, input) values ($1, $2, $3, 'manual', 'queued', $4, $5::jsonb)",
        [runAId, orgAId, workflowAId, adminId, JSON.stringify({ hello: "org-a" })]
      );
      await setup.query(
        "insert into workflow_run_events(organization_id, workflow_id, run_id, attempt_count, event_type, level, message) values ($1, $2, $3, 1, 'run_started', 'info', 'org-a-start')",
        [orgAId, workflowAId, runAId]
      );

      await setup.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true)",
        [otherId, orgBId]
      );
      await setup.query("insert into organizations(id, name, slug) values ($1, 'Org B', $2)", [
        orgBId,
        `org-b-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ]);
      await setup.query("insert into memberships(organization_id, user_id, role_key) values ($1, $2, 'owner')", [
        orgBId,
        otherId,
      ]);
      await setup.query(
        "insert into workflows(id, organization_id, name, status, version, dsl, created_by_user_id) values ($1, $2, 'Org B Workflow', 'published', 1, $3::jsonb, $4)",
        [
          workflowBId,
          orgBId,
          JSON.stringify({
            version: "v2",
            trigger: { type: "trigger.manual" },
            nodes: [{ id: "n1", type: "agent.execute" }],
          }),
          otherId,
        ]
      );
      await setup.query(
        "insert into workflow_runs(id, organization_id, workflow_id, trigger_type, status, requested_by_user_id, input) values ($1, $2, $3, 'manual', 'queued', $4, $5::jsonb)",
        [runBId, orgBId, workflowBId, otherId, JSON.stringify({ hello: "org-b" })]
      );
      await setup.query(
        "insert into workflow_run_events(organization_id, workflow_id, run_id, attempt_count, event_type, level, message) values ($1, $2, $3, 1, 'run_started', 'info', 'org-b-start')",
        [orgBId, workflowBId, runBId]
      );

      await setup.query("commit");
    } catch (error) {
      await setup.query("rollback");
      throw error;
    } finally {
      setup.release();
    }

    const client = await appPool.connect();
    try {
      await client.query("begin");

      const noContext = await client.query("select id from organizations where id = $1", [orgAId]);
      expect(noContext.rowCount).toBe(0);

      await client.query("select set_config('app.current_org_id', $1, true)", [orgBId]);
      const wrongContext = await client.query("select id from organizations where id = $1", [orgAId]);
      expect(wrongContext.rowCount).toBe(0);
      const wrongWorkflowContext = await client.query("select id from workflows where organization_id = $1", [orgAId]);
      expect(wrongWorkflowContext.rowCount).toBe(0);
      const wrongEventContext = await client.query(
        "select id from workflow_run_events where organization_id = $1 and run_id = $2",
        [orgAId, runAId]
      );
      expect(wrongEventContext.rowCount).toBe(0);

      await client.query("select set_config('app.current_org_id', $1, true)", [orgAId]);
      const rightContext = await client.query("select id from organizations where id = $1", [orgAId]);
      expect(rightContext.rowCount).toBe(1);
      const rightWorkflowContext = await client.query("select id from workflows where organization_id = $1", [orgAId]);
      expect(rightWorkflowContext.rowCount).toBe(1);
      const rightEventContext = await client.query(
        "select id from workflow_run_events where organization_id = $1 and run_id = $2",
        [orgAId, runAId]
      );
      expect(rightEventContext.rowCount).toBe(1);

      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
