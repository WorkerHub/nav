import { describe, expect, it } from "vitest";
import { migrationsTable } from "../src/lib/migrations";
import {
  applyMigrationList,
  runMigrations,
  TablePrefixConflictError,
} from "../src/lib/migrations-runner";
import { makeEnv, type SqliteD1 } from "./helpers";

type Db = ReturnType<typeof makeEnv>["DB"];

function sqliteOf(db: Db): SqliteD1["db"] {
  return (db as unknown as SqliteD1).db;
}

function tableNames(db: Db): string[] {
  return sqliteOf(db)
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row: { name: string }) => row.name);
}

function ledgerRows(db: Db, prefix: string) {
  return sqliteOf(db)
    .prepare(
      `SELECT name, applied_at FROM ${migrationsTable(prefix)} ORDER BY name`,
    )
    .all() as Array<{ name: string; applied_at: number }>;
}

describe("migrationsTable() naming (three states + case preserved)", () => {
  it("derives the ledger table from the effective prefix", () => {
    expect(migrationsTable("nav_")).toBe("_nav_schema_migrations");
    expect(migrationsTable("app_")).toBe("_app_schema_migrations");
    expect(migrationsTable("")).toBe("_schema_migrations");
    expect(migrationsTable("abc123")).toBe("_abc123_schema_migrations");
  });

  it("preserves the prefix's original case and strips only the trailing underscore", () => {
    expect(migrationsTable("ZETA_")).toBe("_ZETA_schema_migrations");
    expect(migrationsTable("NAV_")).toBe("_NAV_schema_migrations");
    expect(migrationsTable("nav__")).toBe("_nav_schema_migrations");
  });
});

describe("ledgered migration runner", () => {
  it("applies everything on an empty database and records exactly schema_v1", async () => {
    const env = makeEnv({ TABLE_PREFIX: undefined }); // → nav_
    const result = await runMigrations(env);

    expect(result.prefix).toBe("nav_");
    expect(result.migrations.map((m) => [m.name, m.status])).toEqual([
      ["schema_v1", "applied"],
    ]);

    const ledger = ledgerRows(env.DB, "nav_");
    expect(ledger.map((row) => row.name)).toEqual(["schema_v1"]);
    expect(ledger[0]?.applied_at).toBeGreaterThan(0);

    const tables = tableNames(env.DB);
    expect(tables).toContain("_nav_schema_migrations");
    for (const table of [
      "users",
      "passkey_credentials",
      "sessions",
      "login_attempts",
      "challenges",
      "categories",
      "links",
      "search_engines",
      "settings",
    ]) {
      expect(tables).toContain(`nav_${table}`);
    }
  });

  it("skips everything on a second run and leaves the schema untouched", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await runMigrations(env);

    const schemaBefore = tableNames(env.DB);
    const indexesBefore = sqliteOf(env.DB)
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
      )
      .all();
    const ledgerBefore = ledgerRows(env.DB, "nav_");

    const second = await runMigrations(env);
    expect(second.migrations).toEqual([
      { name: "schema_v1", status: "skipped" },
    ]);

    expect(tableNames(env.DB)).toEqual(schemaBefore);
    expect(
      sqliteOf(env.DB)
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
        )
        .all(),
    ).toEqual(indexesBefore);
    expect(ledgerRows(env.DB, "nav_")).toEqual(ledgerBefore);
  });

  it("records the ledger under the no-prefix name for an explicit empty prefix", async () => {
    const env = makeEnv({ TABLE_PREFIX: "" });
    const result = await runMigrations(env);

    expect(result.prefix).toBe("");
    expect(tableNames(env.DB)).toContain("_schema_migrations");
    expect(ledgerRows(env.DB, "").map((row) => row.name)).toEqual([
      "schema_v1",
    ]);
  });

  it("adopts an existing nav_* schema that predates the ledger", async () => {
    // Simulates a nav v1 database: all business tables present, no ledger yet.
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await runMigrations(env);
    sqliteOf(env.DB).exec("DROP TABLE _nav_schema_migrations;");

    const result = await runMigrations(env);
    expect(result.prefix).toBe("nav_");
    expect(result.migrations).toEqual([
      { name: "schema_v1", status: "applied" },
    ]);
    expect(ledgerRows(env.DB, "nav_").map((row) => row.name)).toEqual([
      "schema_v1",
    ]);
    expect(tableNames(env.DB)).toContain("_nav_schema_migrations");
  });

  it("aborts instead of quietly switching to a different prefix", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await runMigrations(env);

    // nav_ → no prefix
    await expect(runMigrations(makeEnvFor(env, ""))).rejects.toBeInstanceOf(
      TablePrefixConflictError,
    );
    // nav_ → app_
    await expect(runMigrations(makeEnvFor(env, "app_"))).rejects.toBeInstanceOf(
      TablePrefixConflictError,
    );
    // still one schema, no second set of tables
    const tables = tableNames(env.DB);
    expect(tables).toContain("nav_users");
    expect(tables).not.toContain("users");
    expect(tables).not.toContain("app_users");
    expect(tables).not.toContain("_app_schema_migrations");
  });

  it("aborts when the database already holds an unprefixed schema", async () => {
    const env = makeEnv({ TABLE_PREFIX: "" });
    await runMigrations(env);

    await expect(runMigrations(makeEnvFor(env, "nav_"))).rejects.toBeInstanceOf(
      TablePrefixConflictError,
    );
    expect(tableNames(env.DB)).not.toContain("nav_users");
  });

  it("does not mistake other projects' tables or ledgers for a nav schema", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    const db = sqliteOf(env.DB);
    // Shared-D1 neighbours (eNotify / shortlink / Zeta) plus their ledgers.
    db.exec(
      "CREATE TABLE eNotify_settings (key TEXT, value TEXT);" +
        "CREATE TABLE SL_links (id TEXT, slug TEXT);" +
        "CREATE TABLE ZETA_users (id TEXT);" +
        "CREATE TABLE _sl_schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()));",
    );

    const result = await runMigrations(env);
    expect(result.prefix).toBe("nav_");
    expect(result.migrations).toEqual([
      { name: "schema_v1", status: "applied" },
    ]);
  });

  it("stops at the first failing migration, without recording it or running later ones", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    const migrations = [
      { name: "schema_v1", sql: "CREATE TABLE t_one (id TEXT PRIMARY KEY);" },
      {
        name: "schema_v2",
        sql:
          "CREATE TABLE t_two (id TEXT PRIMARY KEY);" +
          "CREATE TABLE t_two (id TEXT PRIMARY KEY);",
      },
      { name: "schema_v3", sql: "CREATE TABLE t_three (id TEXT PRIMARY KEY);" },
    ];

    const first = await applyMigrationList(env.DB, "nav_", migrations);
    expect(first.map((m) => [m.name, m.status])).toEqual([
      ["schema_v1", "applied"],
      ["schema_v2", "error"],
    ]);
    expect(first[1]?.error).toContain("t_two");

    // Failed migration not recorded, later migration never attempted.
    expect(ledgerRows(env.DB, "nav_").map((row) => row.name)).toEqual([
      "schema_v1",
    ]);
    expect(tableNames(env.DB)).not.toContain("t_three");

    // Re-running retries the failed migration rather than skipping it.
    const retry = await applyMigrationList(env.DB, "nav_", migrations);
    expect(retry.map((m) => [m.name, m.status])).toEqual([
      ["schema_v1", "skipped"],
      ["schema_v2", "error"],
    ]);
  });
});

/** Same database, different TABLE_PREFIX — simulates a config change. */
function makeEnvFor(env: ReturnType<typeof makeEnv>, prefix: string) {
  return { ...env, TABLE_PREFIX: prefix };
}
