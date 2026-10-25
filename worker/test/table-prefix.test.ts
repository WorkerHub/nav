import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_PREFIX,
  getTablePrefix,
  isValidTablePrefix,
} from "../src/types";
import { runMigrations } from "../src/lib/migrations-runner";
import { makeEnv, type SqliteD1 } from "./helpers";

describe("table prefix three-state (SPEC v1.4)", () => {
  it("uses the project default nav_ as the only hard-coded prefix", () => {
    expect(DEFAULT_TABLE_PREFIX).toBe("nav_");
  });

  it("defaults to nav_ when TABLE_PREFIX is unconfigured", () => {
    expect(getTablePrefix(makeEnv({ TABLE_PREFIX: undefined }))).toBe("nav_");
  });

  it("treats an explicit empty string as no-prefix", () => {
    expect(getTablePrefix(makeEnv({ TABLE_PREFIX: "" }))).toBe("");
  });

  it("returns a valid custom prefix as-is (no auto underscore)", () => {
    expect(getTablePrefix(makeEnv({ TABLE_PREFIX: "app_" }))).toBe("app_");
    expect(getTablePrefix(makeEnv({ TABLE_PREFIX: "nav_" }))).toBe("nav_");
    expect(getTablePrefix(makeEnv({ TABLE_PREFIX: "abc123" }))).toBe("abc123");
  });

  it("rejects a malformed custom prefix", () => {
    for (const bad of ["BadPrefix", "foo-bar", "foo bar", "foo.", "foo\\bar"]) {
      expect(() => getTablePrefix(makeEnv({ TABLE_PREFIX: bad }))).toThrow();
    }
  });

  it("isValidTablePrefix matches lowercase letters / digits / underscore", () => {
    expect(isValidTablePrefix("nav_")).toBe(true);
    expect(isValidTablePrefix("abc123_")).toBe(true);
    expect(isValidTablePrefix("")).toBe(true);
    expect(isValidTablePrefix("BadPrefix")).toBe(false);
    expect(isValidTablePrefix("foo-bar")).toBe(false);
  });

  it("migrates to nav_* tables when TABLE_PREFIX is unconfigured", async () => {
    const env = makeEnv({ TABLE_PREFIX: undefined });
    await runMigrations(env);

    const db = (env.DB as unknown as SqliteD1).db;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(tables).toContain("nav_users");
    expect(tables).toContain("nav_links");
    expect(tables).not.toContain("users");
  });
});
