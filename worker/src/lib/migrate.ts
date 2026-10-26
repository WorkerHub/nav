import { getTablePrefix, type Env } from "../types";
import { countUsers } from "../db/queries/users";
import { seedSearchEngines } from "../db/seeds";
import { runMigrations, type RunMigrationsResult } from "./migrations-runner";

// Per-isolate flag: after the first successful run in this Worker isolate the
// schema is guaranteed to exist for the isolate's lifetime, so read paths skip
// the ledger replay entirely (D1 tables persist across requests).
let schemaReady = false;

export interface ApplyMigrationsOptions {
  /**
   * Top up `{prefix}search_engines` with the default engines when that table is
   * empty (ONE-446). Setup and upgrade paths pass `true`; the read-path guard
   * (`ensureSchema`) does not, so a table the owner emptied on purpose is never
   * re-populated by an ordinary page load.
   */
  seedDefaults?: boolean;
}

/**
 * Applies pending migrations and marks the isolate schema-ready. Returns the
 * per-migration ledger outcome so setup can report what was applied/skipped.
 * Idempotent: recorded migrations are skipped, so re-running is cheap.
 *
 * With `seedDefaults` the default search engines are ensured right after the
 * schema exists — that seed is itself a no-op unless the table is empty.
 */
export async function applyMigrations(
  env: Env,
  options: ApplyMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const result = await runMigrations(env);
  if (options.seedDefaults === true) {
    // Uses the prefix the runner resolved (not a second getTablePrefix call) so
    // the seed always lands in the schema that was just migrated.
    await seedSearchEngines(env.DB, result.prefix);
  }
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
