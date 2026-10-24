import { getTablePrefix, type Env } from "../types";
import { countUsers } from "../db/queries/users";

// Per-isolate flag: after the first successful run in this Worker isolate the
// schema is guaranteed to exist for the isolate's lifetime, so read paths skip
// the DDL replay entirely (D1 tables persist across requests).
let schemaReady = false;
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
  schemaReady = true;
  return { applied: true };
}

/**
 * Read-surface guard: ensures the schema exists at most once per isolate.
 * Runs the idempotent DDL on first request, then only a cheap COUNT probe.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await runMigrations(env);
  await countUsers(env.DB, getTablePrefix(env));
}
