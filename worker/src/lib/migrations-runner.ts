// Ledgered schema migration runner (ONE-346 / ONE-357), modelled on shortlink's
// lib/migrations-runner.ts. Every schema change goes through this one runner:
// migrations listed in lib/migrations.ts are applied in order, recorded in the
// ledger table `_<prefix>_schema_migrations`, skipped when already recorded, and
// execution stops at the first failure (the failed migration is not recorded).

import { getTablePrefix, type Env } from "../types";
import {
  createMigrationsTableSql,
  getMigrations,
  migrationsTable,
  type Migration,
} from "./migrations";

export interface MigrationResult {
  name: string;
  status: "applied" | "skipped" | "error";
  error?: string;
}

export interface RunMigrationsResult {
  /** Effective table prefix resolved for this run ("" = no prefix). */
  prefix: string;
  migrations: MigrationResult[];
}

// Thrown when the database already holds a nav schema under a different prefix
// than the one resolved from the environment: migrating would silently build a
// second, empty set of tables instead of using the existing one.
export class TablePrefixConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TablePrefixConflictError";
  }
}

// Business tables that only nav has in the shared D1 database (eNotify_*,
// SL_*, ZETA_*, post_* … have none of them), so their co-occurrence under one
// prefix marks a nav schema. Never a single-table match.
const NAV_UNIQUE_SUFFIXES: readonly string[] = [
  "passkey_credentials",
  "search_engines",
  "login_attempts",
];

/**
 * Prefixes (lowercased, `""` for unprefixed) under which nav's business-table
 * family appears: `nav_passkey_credentials` + `nav_search_engines` +
 * `nav_login_attempts` → `nav`.
 */
function detectNavSchemaPrefixes(names: string[]): string[] {
  const byPrefix = new Map<string, Set<string>>();

  for (const name of names) {
    const lower = name.toLowerCase();
    for (const suffix of NAV_UNIQUE_SUFFIXES) {
      let prefix: string | null = null;
      if (lower === suffix) prefix = "";
      else if (lower.endsWith(`_${suffix}`)) {
        prefix = lower.slice(0, lower.length - suffix.length - 1);
      }
      if (prefix === null) continue;

      let suffixes = byPrefix.get(prefix);
      if (suffixes === undefined) {
        suffixes = new Set();
        byPrefix.set(prefix, suffixes);
      }
      suffixes.add(suffix);
    }
  }

  const detected: string[] = [];
  for (const [prefix, suffixes] of byPrefix) {
    if (NAV_UNIQUE_SUFFIXES.every((suffix) => suffixes.has(suffix))) {
      detected.push(prefix);
    }
  }
  return detected;
}

/**
 * Prefixes under which any migration ledger (`_<prefix>_schema_migrations`)
 * exists. A ledger name alone cannot be attributed to nav — other projects
 * sharing the database keep their own ledger — so this signal is only used when
 * TABLE_PREFIX resolves to no prefix at all, where building an unprefixed nav
 * schema next to any ledger would be unsafe.
 */
function detectLedgerPrefixes(names: string[]): string[] {
  const prefixes: string[] = [];
  for (const name of names) {
    const match = /^_(.+)_schema_migrations$/i.exec(name);
    if (match !== null && match[1] !== undefined && match[1] !== "") {
      prefixes.push(match[1]);
    }
  }
  return prefixes;
}

/**
 * Describes the conflicting already-initialised nav schema, or returns null when
 * it is safe to migrate under `prefix`. Read-only: never writes.
 */
async function detectTablePrefixConflict(
  db: D1Database,
  prefix: string,
): Promise<string | null> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>();
  const names = results.map((row) => row.name);
  // SQLite identifiers are case-insensitive, so table-name existence checks are
  // too (while every name we generate keeps the configured prefix's case).
  const has = (table: string) =>
    names.some((name) => name.toLowerCase() === table.toLowerCase());

  // Already initialised under this exact prefix → incremental migration.
  if (has(migrationsTable(prefix))) return null;

  const navPrefixes = detectNavSchemaPrefixes(names);
  const unprefixedNav = navPrefixes.includes("");
  const prefixedNav = navPrefixes.filter((detected) => detected !== "");

  if (prefix === "") {
    // No ledger yet: an unprefixed nav table family is our own schema from
    // before the ledger existed (schema_v1 uses IF NOT EXISTS, so it adopts it),
    // but a prefixed nav schema or an existing ledger would get duplicated.
    if (unprefixedNav) return null;

    const ledgers = detectLedgerPrefixes(names);
    if (ledgers.length > 0) {
      return (
        `the database already contains a schema ledger ` +
        `(${ledgers.map((p) => `_${p}_schema_migrations`).join(", ")}), but ` +
        `TABLE_PREFIX resolves to an empty string. Refusing to initialise an ` +
        `unprefixed nav schema. Configure TABLE_PREFIX to the prefix of the ` +
        `existing schema (e.g. TABLE_PREFIX=${ledgers[0]}_).`
      );
    }
    if (prefixedNav.length > 0) {
      return (
        `the database already contains a nav schema under the prefix ` +
        `(${prefixedNav.map((p) => `${p}_*`).join(", ")}), but TABLE_PREFIX ` +
        `resolves to an empty string. Refusing to initialise an unprefixed nav ` +
        `schema. Configure TABLE_PREFIX to its current value ` +
        `(e.g. TABLE_PREFIX=${prefixedNav[0]}_).`
      );
    }
    return null;
  }

  // Prefixed target: an unprefixed nav schema (or the ledger `_schema_migrations`
  // next to it) or another prefix's nav schema would be a silent switch.
  if (unprefixedNav) {
    return (
      `the database already contains an unprefixed nav schema, but ` +
      `TABLE_PREFIX resolves to '${prefix}'. Refusing to initialise a new ` +
      `'${prefix}'-prefixed schema. To keep the existing unprefixed schema, ` +
      `explicitly configure TABLE_PREFIX='' (or TABLE_PREFIX=none in CI).`
    );
  }
  const others = prefixedNav.filter(
    (detected) => detected !== prefix.toLowerCase(),
  );
  if (others.length > 0) {
    return (
      `the database already contains a nav schema under the prefix ` +
      `(${others.map((p) => `${p}_*`).join(", ")}), but TABLE_PREFIX resolves ` +
      `to '${prefix}'. Refusing to initialise a second '${prefix}'-prefixed ` +
      `schema. Configure TABLE_PREFIX to its current value ` +
      `(e.g. TABLE_PREFIX=${others[0]}_).`
    );
  }
  return null;
}

// D1's exec() only processes the first line of a multi-line string, so strip
// SQL line comments and collapse every migration onto a single line.
function toSingleLine(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const comment = line.indexOf("--");
      return comment >= 0 ? line.slice(0, comment) : line;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Applies `migrations` in order under `prefix`, recording each success in the
 * ledger table. Skips recorded migrations, stops at the first error (reported
 * inline instead of thrown) and never records the failed migration.
 */
export async function applyMigrationList(
  db: D1Database,
  prefix: string,
  migrations: Migration[],
): Promise<MigrationResult[]> {
  const ledger = migrationsTable(prefix);
  await db.prepare(createMigrationsTableSql(prefix)).run();

  const existing = await db
    .prepare(`SELECT name FROM ${ledger}`)
    .all<{ name: string }>();
  const recorded = new Set(existing.results.map((row) => row.name));

  const results: MigrationResult[] = [];

  for (const migration of migrations) {
    if (recorded.has(migration.name)) {
      results.push({ name: migration.name, status: "skipped" });
      continue;
    }
    try {
      await db.exec(toSingleLine(migration.sql));
      await db
        .prepare(`INSERT INTO ${ledger} (name) VALUES (?)`)
        .bind(migration.name)
        .run();
      results.push({ name: migration.name, status: "applied" });
    } catch (err) {
      results.push({
        name: migration.name,
        status: "error",
        error: String(err),
      });
      break;
    }
  }

  return results;
}

/**
 * Resolves the effective prefix, guards against a silent prefix switch, then
 * applies every migration not yet recorded in the ledger. Throws
 * TablePrefixConflictError when the database already holds a nav schema under a
 * different prefix.
 */
export async function runMigrations(env: Env): Promise<RunMigrationsResult> {
  const prefix = getTablePrefix(env);

  const conflict = await detectTablePrefixConflict(env.DB, prefix);
  if (conflict !== null) throw new TablePrefixConflictError(conflict);

  const migrations = await applyMigrationList(
    env.DB,
    prefix,
    getMigrations(prefix),
  );
  return { prefix, migrations };
}
