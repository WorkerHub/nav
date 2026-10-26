import {
  getTablePrefix,
  type Env,
  type SetupMigrationDto,
  type SetupResultDto,
  type SetupStateDto,
} from "../types";
import { countUsers } from "../db/queries/users";
import { getSetting, setSetting } from "../db/queries/settings";
import { applyMigrations } from "../lib/migrate";
import {
  TablePrefixConflictError,
  type MigrationResult,
} from "../lib/migrations-runner";

/**
 * Setup-page switch storage (SETUP-PAGE-SPEC §3.4): a single `{prefix}settings`
 * key, `'1'` = page open, `'0'` = page closed. No table, no migration.
 *
 * This key must never reach the site-settings whitelist / SiteSettingsDto /
 * `/api/public`; the only read/write surfaces are the two `/api/admin/system*`
 * endpoints and the state endpoint below.
 */
export const SETUP_PAGE_ENABLED_KEY = "setup_page_enabled";
export const SETUP_PAGE_ENABLED_ON = "1";
/** nav is a single-user site: once the owner exists the page defaults to CLOSED. */
export const SETUP_PAGE_ENABLED_OFF = "0";

/**
 * `{prefix}users` row count, treating an unreadable/absent table as "no owner
 * yet" (§3.1) instead of surfacing a database error on a public endpoint.
 */
async function safeCountUsers(env: Env, prefix: string): Promise<number> {
  try {
    return await countUsers(env.DB, prefix);
  } catch {
    return 0;
  }
}

/**
 * Whether the setup page may be rendered (§3.1):
 * - uninitialised (`ownerExists === false`) → always `true`, so an empty
 *   database can never lock itself out;
 * - initialised → only an explicit `'1'` opens the page; a missing key means
 *   the default, which for nav is OFF (§3.4).
 */
export async function getSetupPageEnabled(
  env: Env,
  prefix: string = getTablePrefix(env),
): Promise<boolean> {
  try {
    return (
      (await getSetting(env.DB, prefix, SETUP_PAGE_ENABLED_KEY)) ===
      SETUP_PAGE_ENABLED_ON
    );
  } catch {
    // No settings table yet (uninitialised database) → default OFF.
    return false;
  }
}

export async function setSetupPageEnabled(
  env: Env,
  enabled: boolean,
  prefix: string = getTablePrefix(env),
): Promise<void> {
  await setSetting(
    env.DB,
    prefix,
    SETUP_PAGE_ENABLED_KEY,
    enabled ? SETUP_PAGE_ENABLED_ON : SETUP_PAGE_ENABLED_OFF,
  );
}

/** Payload of `GET /api/setup/state` (and its `status` alias) — no secrets, no hashes. */
export async function resolveSetupState(env: Env): Promise<SetupStateDto> {
  const tablePrefix = getTablePrefix(env);
  const ownerExists = (await safeCountUsers(env, tablePrefix)) > 0;

  if (!ownerExists) return { enabled: true, ownerExists, tablePrefix };

  return {
    enabled: await getSetupPageEnabled(env, tablePrefix),
    ownerExists,
    tablePrefix,
  };
}

export type SetupMigrationOutcome =
  | { ok: true; body: SetupResultDto }
  | {
      ok: false;
      status: 409;
      body: { error: "table prefix conflict"; detail: string };
    };

/**
 * Runs ONLY the ledgered migrations (forward-only, idempotent): no user is
 * created, no password changed, no table dropped. Both setup endpoints share
 * this so their payloads and their 409 conflict shape stay identical.
 *
 * This is also the «检查并升级数据库» path, so it tops up the default search
 * engines when that table is empty (ONE-446) — a no-op on any install that
 * already has an engine.
 */
export async function runSetupMigrations(
  env: Env,
): Promise<SetupMigrationOutcome> {
  const tablePrefix = getTablePrefix(env);
  let migrations: MigrationResult[];

  try {
    migrations = (await applyMigrations(env, { seedDefaults: true }))
      .migrations;
  } catch (err) {
    if (err instanceof TablePrefixConflictError) {
      return {
        ok: false,
        status: 409,
        body: { error: "table prefix conflict", detail: err.message },
      };
    }
    throw err;
  }

  return {
    ok: true,
    body: {
      success: true,
      tablePrefix,
      migrations: migrations.map(
        (migration): SetupMigrationDto => ({
          name: migration.name,
          status: migration.status,
        }),
      ),
      ownerExists: (await safeCountUsers(env, tablePrefix)) > 0,
    },
  };
}
