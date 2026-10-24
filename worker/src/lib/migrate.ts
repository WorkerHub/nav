import { getTablePrefix, type Env } from "../types";
import { countUsers } from "../db/queries/users";
import { runScript } from "../db/sql";
// Schema source of truth: src/db/schema.sql. It is loaded through a generated
// module so both the Worker build and the test runner can import it plainly.
import { SCHEMA_SQL } from "../db/schema.generated";

/**
 * Applies the D1 schema. Idempotent by construction: every statement in
 * schema.sql uses IF NOT EXISTS / OR IGNORE, so re-running on an empty or an
 * already-initialized database succeeds (acceptance: "空库迁移可重复执行成功").
 */
export async function runMigrations(env: Env): Promise<{ applied: boolean }> {
  const prefix = getTablePrefix(env);
  const resolved = SCHEMA_SQL.replace(/\{prefix\}/g, prefix);
  await runScript(env.DB, resolved);
  return { applied: true };
}

/**
 * Idempotent auto-migration for the read surfaces: runs before queries that
 * assume the schema exists, and is a no-op in cost terms once tables are there
 * (all statements are IF NOT EXISTS / OR IGNORE).
 */
export async function ensureSchema(env: Env): Promise<void> {
  await runMigrations(env);
  await countUsers(env.DB, getTablePrefix(env)); // cheap readiness probe
}
