import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/lib/migrations-runner";
import { makeEnv, type SqliteD1 } from "./helpers";

describe("D1 migration", () => {
  it("applies cleanly on an empty database", async () => {
    const env = makeEnv();
    const result = await runMigrations(env);
    expect(result.migrations).toEqual([
      { name: "schema_v1", status: "applied" },
    ]);

    const db = (env.DB as unknown as SqliteD1).db;
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row: any) => row.name);

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
      expect(tables).toContain(table);
    }
  });

  it("is idempotent — can be re-run on an initialized database", async () => {
    const env = makeEnv();
    await runMigrations(env);
    await expect(runMigrations(env)).resolves.toEqual({
      prefix: "",
      migrations: [{ name: "schema_v1", status: "skipped" }],
    });
    await expect(runMigrations(env)).resolves.toEqual({
      prefix: "",
      migrations: [{ name: "schema_v1", status: "skipped" }],
    });
  });

  it("respects the table prefix", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await runMigrations(env);

    const db = (env.DB as unknown as SqliteD1).db;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row: any) => row.name);
    expect(tables).toContain("nav_users");
    expect(tables).toContain("nav_links");
    expect(tables).toContain("_nav_schema_migrations");
    expect(tables).not.toContain("users");
  });

  it("seeds setup_completed = 0", async () => {
    const env = makeEnv();
    await runMigrations(env);

    const db = (env.DB as unknown as SqliteD1).db;
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'setup_completed'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("0");
  });
});
