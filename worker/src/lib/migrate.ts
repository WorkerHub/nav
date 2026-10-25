import { getTablePrefix, type Env } from "../types";
import { countUsers } from "../db/queries/users";
import { runMigrations, type RunMigrationsResult } from "./migrations-runner";

// Per-isolate flag: after the first successful run in this Worker isolate the
// schema is guaranteed to exist for the isolate's lifetime, so read paths skip
// the ledger replay entirely (D1 tables persist across requests).
let schemaReady = false;

/**
 * Applies pending migrations and marks the isolate schema-ready. Returns the
 * per-migration ledger outcome so setup can report what was applied/skipped.
 * Idempotent: recorded migrations are skipped, so re-running is cheap.
 */
export async function applyMigrations(env: Env): Promise<RunMigrationsResult> {
  const result = await runMigrations(env);
  schemaReady = true;
  return result;
}

/**
 * Read-surface guard: ensures the schema exists at most once per isolate.
 * Runs the ledgered migrations on first request, then only a cheap COUNT probe.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await applyMigrations(env);
  await countUsers(env.DB, getTablePrefix(env));
}
