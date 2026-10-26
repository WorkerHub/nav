import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  SEED_SEARCH_ENGINES,
  searchEnginesTable,
  seedSearchEngines,
} from "../src/db/seeds";
import { insertSearchEngine } from "../src/db/queries/content";
import { applyMigrations } from "../src/lib/migrate";
import { runSetupMigrations } from "../src/services/setup";
import { setupRoutes } from "../src/routes/setup";
import { authRoutes } from "../src/routes/auth";
import { publicRoutes } from "../src/routes/public";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

/**
 * Frozen seed contract (ONE-446): five engines, `{q}` placeholder, sort_order
 * 1–5, only Google default. Written out independently of the implementation so
 * a drifted constant fails here instead of passing by construction.
 */
const CONTRACT: ReadonlyArray<{
  name: string;
  urlTemplate: string;
  sortOrder: number;
  isDefault: number;
}> = [
  {
    name: "Google",
    urlTemplate: "https://www.google.com/search?q={q}",
    sortOrder: 1,
    isDefault: 1,
  },
  {
    name: "Bing",
    urlTemplate: "https://www.bing.com/search?q={q}",
    sortOrder: 2,
    isDefault: 0,
  },
  {
    name: "DuckDuckGo",
    urlTemplate: "https://duckduckgo.com/?q={q}",
    sortOrder: 3,
    isDefault: 0,
  },
  {
    name: "百度",
    urlTemplate: "https://www.baidu.com/s?wd={q}",
    sortOrder: 4,
    isDefault: 0,
  },
  {
    name: "GitHub",
    urlTemplate: "https://github.com/search?q={q}",
    sortOrder: 5,
    isDefault: 0,
  },
];

const SECRET = "test-setup-secret";

interface EngineRow {
  id: string;
  name: string;
  url_template: string;
  icon: string | null;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function sqliteOf(env: Env): SqliteD1["db"] {
  return (env.DB as unknown as SqliteD1).db;
}

function engines(env: Env, prefix: string): EngineRow[] {
  return sqliteOf(env)
    .prepare(
      `SELECT * FROM ${searchEnginesTable(prefix)} ORDER BY sort_order, created_at`,
    )
    .all() as EngineRow[];
}

function tableNames(env: Env): string[] {
  return sqliteOf(env)
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row: { name: string }) => row.name);
}

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api", setupRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/public", publicRoutes);
  return app;
}

// Every test spends its own IP budget for the setup rate limiter.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function setupUpgrade(app: Hono, env: Env): Promise<Response> {
  return app.request(
    "/api/setup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextIp(),
        "x-setup-secret": SECRET,
      },
    },
    env,
  );
}

function createOwner(app: Hono, env: Env): Promise<Response> {
  return app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        password: "correct horse battery",
      }),
      headers: {
        "content-type": "application/json",
        "x-setup-secret": SECRET,
      },
    },
    env,
  );
}

describe("default search engine seed — fresh initialisation (ONE-446)", () => {
  it("writes exactly the five contract engines after runMigrations + seed", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(env, { seedDefaults: true });

    const rows = engines(env, "nav_");
    expect(rows).toHaveLength(5);
    expect(
      rows.map((row) => ({
        name: row.name,
        urlTemplate: row.url_template,
        sortOrder: row.sort_order,
        isDefault: row.is_default,
      })),
    ).toEqual(CONTRACT);
    // icon is optional in the contract → NULL is allowed and used.
    expect(rows.every((row) => row.icon === null)).toBe(true);
    // Deterministic ids: fixed slugs, no random uuid, stable across runs.
    expect(rows.map((row) => row.id)).toEqual(
      SEED_SEARCH_ENGINES.map((engine) => engine.id),
    );
  });

  it("seeds the unprefixed schema and does not leak a prefixed table", async () => {
    const env = makeEnv({ TABLE_PREFIX: "" });
    await applyMigrations(env, { seedDefaults: true });

    expect(engines(env, "")).toHaveLength(5);
    expect(tableNames(env)).toContain("search_engines");
    expect(tableNames(env)).not.toContain("nav_search_engines");
  });

  it("follows any custom TABLE_PREFIX", async () => {
    const env = makeEnv({ TABLE_PREFIX: "app_" });
    await applyMigrations(env, { seedDefaults: true });

    expect(engines(env, "app_")).toHaveLength(5);
    expect(tableNames(env)).toContain("app_search_engines");
    expect(tableNames(env)).not.toContain("search_engines");
    expect(tableNames(env)).not.toContain("nav_search_engines");
  });

  it("is deterministic: two fresh databases get identical rows", async () => {
    const first = makeEnv({ TABLE_PREFIX: "nav_" });
    const second = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(first, { seedDefaults: true });
    await applyMigrations(second, { seedDefaults: true });

    const ids = (env: Env) => engines(env, "nav_").map((row) => row.id);
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first)).toEqual(SEED_SEARCH_ENGINES.map((engine) => engine.id));
  });
});

describe("default search engine seed — idempotency", () => {
  it("reports and skips on every run after the first", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(env); // schema only

    const first = await seedSearchEngines(env.DB, "nav_");
    expect(first).toEqual({ seeded: true, inserted: 5 });

    const before = engines(env, "nav_");
    const second = await seedSearchEngines(env.DB, "nav_");
    expect(second).toEqual({ seeded: false, inserted: 0 });
    // Byte-identical: ids, timestamps and order untouched by the second pass.
    expect(engines(env, "nav_")).toEqual(before);
  });

  it("does not re-seed when repeated setup / upgrade runs happen", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });

    const firstRun = await runSetupMigrations(env);
    expect(firstRun.ok).toBe(true);
    const before = engines(env, "nav_");
    expect(before).toHaveLength(5);

    const secondRun = await runSetupMigrations(env);
    expect(secondRun.ok).toBe(true);
    expect(engines(env, "nav_")).toEqual(before);
    expect(engines(env, "nav_")).toHaveLength(5);
  });

  it("leaves a non-empty table completely alone", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(env); // schema only, no seed
    await insertSearchEngine(env.DB, "nav_", {
      id: "owner-pick",
      name: "Kagi",
      url_template: "https://kagi.com/search?q={q}",
      icon: null,
      sort_order: 1,
      is_default: 1,
    });

    const outcome = await runSetupMigrations(env);
    expect(outcome.ok).toBe(true);

    const rows = engines(env, "nav_");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("owner-pick");
    expect(rows[0]?.name).toBe("Kagi");
  });

  it("does not wipe or reorder any engine the owner already has", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(env, { seedDefaults: true });
    // Owner edits one seed row, then deletes another.
    sqliteOf(env)
      .prepare(
        `UPDATE nav_search_engines SET name = 'Google (edited)', sort_order = 99 WHERE id = 'seed-google'`,
      )
      .run();
    sqliteOf(env)
      .prepare(`DELETE FROM nav_search_engines WHERE id = 'seed-bing'`)
      .run();

    await runSetupMigrations(env);

    const rows = engines(env, "nav_");
    expect(rows).toHaveLength(4);
    expect(rows.some((row) => row.name === "Google (edited)")).toBe(true);
    expect(rows.some((row) => row.id === "seed-bing")).toBe(false);
  });
});

describe("default search engine seed — path coverage", () => {
  it("does not seed on the read-path guard (ensureSchema / applyMigrations without the option)", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    await applyMigrations(env, { seedDefaults: true });
    sqliteOf(env).prepare("DELETE FROM nav_search_engines").run();

    // A page load must not resurrect engines the owner removed on purpose.
    await applyMigrations(env);
    expect(engines(env, "nav_")).toHaveLength(0);
  });

  it("seeds through POST /api/auth/setup (initialisation) and surfaces in /api/public", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    const app = makeApp();

    const created = await createOwner(app, env);
    expect(created.status).toBe(201);
    expect(engines(env, "nav_")).toHaveLength(5);

    const res = await app.request("/api/public", {}, env);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(
      body.searchEngines.map((engine: { name: string; isDefault: boolean }) => [
        engine.name,
        engine.isDefault,
      ]),
    ).toEqual([
      ["Google", true],
      ["Bing", false],
      ["DuckDuckGo", false],
      ["百度", false],
      ["GitHub", false],
    ]);
  });

  it("seeds through POST /api/setup (secret-gated upgrade) and stays at five on repeat", async () => {
    const env = makeEnv({ TABLE_PREFIX: "nav_" });
    const app = makeApp();

    const first = await setupUpgrade(app, env);
    expect(first.status).toBe(200);
    expect(engines(env, "nav_")).toHaveLength(5);

    const before = engines(env, "nav_");
    const second = await setupUpgrade(app, env);
    expect(second.status).toBe(200);
    expect(engines(env, "nav_")).toEqual(before);
  });
});
