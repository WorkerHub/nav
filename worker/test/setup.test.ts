import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import worker from "../src/index";
import { setupRoutes } from "../src/routes/setup";
import { authRoutes } from "../src/routes/auth";
import { publicRoutes } from "../src/routes/public";
import { adminRoutes } from "../src/routes/admin";
import { runMigrations } from "../src/lib/migrations-runner";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

const OWNER = { username: "owner", password: "correct horse battery" };
/** helpers.makeEnv() default SETUP_SECRET. */
const SECRET = "test-setup-secret";

const SETUP_PAGE_KEY = "setup_page_enabled";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api", setupRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/public", publicRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

// Every test spends its own IP budget (the limiter is per source IP).
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function sqliteOf(env: Env): SqliteD1["db"] {
  return (env.DB as unknown as SqliteD1).db;
}

function tableNames(env: Env): string[] {
  return sqliteOf(env)
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row: { name: string }) => row.name);
}

function settingValue(env: Env, prefix: string, key: string): unknown {
  return (
    sqliteOf(env)
      .prepare(`SELECT value FROM ${prefix}settings WHERE key = ?`)
      .get(key) as { value: string } | undefined
  )?.value;
}

function countOwners(env: Env, prefix = ""): number {
  const row = sqliteOf(env)
    .prepare(`SELECT COUNT(*) AS n FROM ${prefix}users`)
    .get() as { n: number };
  return row.n;
}

function jsonHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "content-type": "application/json", ...extra };
}

/** POST /api/setup — the secret-gated, migration-only upgrade endpoint. */
function upgrade(
  app: Hono,
  env: Env,
  opts: { secret?: string | null; ip?: string } = {},
): Promise<Response> {
  const headers = jsonHeaders({ "x-forwarded-for": opts.ip ?? nextIp() });
  if (opts.secret !== undefined && opts.secret !== null) {
    headers["X-Setup-Secret"] = opts.secret;
  }
  return app.request("/api/setup", { method: "POST", headers }, env);
}

/** POST /api/auth/setup — creates the single owner (existing contract). */
function createOwner(app: Hono, env: Env): Promise<Response> {
  return app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify(OWNER),
      headers: jsonHeaders({ "X-Setup-Secret": SECRET }),
    },
    env,
  );
}

function cookieFrom(res: Response): string {
  return res.headers.get("set-cookie") ?? "";
}

async function ownerSession(prefix = ""): Promise<{
  env: Env;
  app: Hono;
  cookie: string;
}> {
  const env = makeEnv({ TABLE_PREFIX: prefix });
  const app = makeApp();
  // Creates the owner and runs the ledgered migrations.
  const res = await createOwner(app, env);
  expect(res.status).toBe(201);
  return { env, app, cookie: cookieFrom(res) };
}

describe("GET /api/setup/state", () => {
  it("treats an uninitialised database as open and leaks nothing", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await app.request("/api/setup/state", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await readJson(res);
    expect(body).toEqual({
      enabled: true,
      ownerExists: false,
      tablePrefix: "",
    });
    // Frozen shape: no secret/hash fields may ever appear here.
    expect(Object.keys(body).sort()).toEqual([
      "enabled",
      "ownerExists",
      "tablePrefix",
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/secret|password|hash/i);
  });

  it("stays open on an empty but migrated database", async () => {
    const env = makeEnv();
    const app = makeApp();
    await runMigrations(env);

    expect(
      await readJson(await app.request("/api/setup/state", {}, env)),
    ).toEqual({ enabled: true, ownerExists: false, tablePrefix: "" });
  });

  it("is closed by default once the owner exists (§3.4 default OFF)", async () => {
    const { env, app } = await ownerSession();

    expect(
      await readJson(await app.request("/api/setup/state", {}, env)),
    ).toEqual({ enabled: false, ownerExists: true, tablePrefix: "" });
    expect(settingValue(env, "", SETUP_PAGE_KEY)).toBe("0");

    // Explicitly opened → enabled flips.
    sqliteOf(env)
      .prepare("UPDATE settings SET value = '1' WHERE key = ?")
      .run(SETUP_PAGE_KEY);
    expect(
      (await readJson(await app.request("/api/setup/state", {}, env))).enabled,
    ).toBe(true);

    // Unknown/missing value under an initialised DB stays closed (default OFF).
    sqliteOf(env)
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(SETUP_PAGE_KEY);
    expect(
      (await readJson(await app.request("/api/setup/state", {}, env))).enabled,
    ).toBe(false);
  });

  it("keeps GET /api/setup/status as an identical alias", async () => {
    const { env, app } = await ownerSession();

    const state = await readJson(
      await app.request("/api/setup/state", {}, env),
    );
    const res = await app.request("/api/setup/status", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(res)).toEqual(state);
  });
});

describe("POST /api/setup (secret-gated upgrade)", () => {
  it("answers 500 when the server setup secret is missing or a placeholder", async () => {
    for (const SETUP_SECRET of ["", "SETUP_SECRET_PLACEHOLDER"]) {
      const env = makeEnv({ SETUP_SECRET });
      const app = makeApp();
      const res = await upgrade(app, env, { secret: "whatever" });
      expect(res.status).toBe(500);
      expect(await readJson(res)).toEqual({ error: "server misconfigured" });
    }
  });

  it("rejects a wrong or missing secret with 403 and never migrates", async () => {
    const env = makeEnv();
    const app = makeApp();

    const wrong = await upgrade(app, env, { secret: "nope" });
    expect(wrong.status).toBe(403);
    expect(await readJson(wrong)).toEqual({ error: "invalid setup secret" });

    const missing = await upgrade(app, env, { secret: null });
    expect(missing.status).toBe(403);
    expect(tableNames(env)).toEqual([]);
  });

  it("applies migrations on an empty database without creating an owner", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await upgrade(app, env, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      success: true,
      tablePrefix: "",
      migrations: [{ name: "schema_v1", status: "applied" }],
      ownerExists: false,
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(countOwners(env)).toBe(0);
  });

  it("only skips on an initialised database, even while the page switch is off", async () => {
    const { env, app, cookie } = await ownerSession();
    expect(cookie).not.toBe("");
    // Default OFF — the switch gates the page, never this endpoint.
    expect(
      (await readJson(await app.request("/api/setup/state", {}, env))).enabled,
    ).toBe(false);

    const res = await upgrade(app, env, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      success: true,
      tablePrefix: "",
      migrations: [{ name: "schema_v1", status: "skipped" }],
      ownerExists: true,
    });
    // No account created/changed, no session handed to an anonymous caller.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(countOwners(env)).toBe(1);
  });

  it("throttles one IP to 3 attempts per 10 minutes (4th → 429)", async () => {
    const env = makeEnv();
    const app = makeApp();
    const ip = nextIp();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await upgrade(app, env, { secret: "wrong", ip });
      expect(res.status).toBe(403);
    }

    // Even the correct secret is refused while the IP is throttled.
    const limited = await upgrade(app, env, { secret: SECRET, ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
    const body = await readJson(limited);
    expect(body.error).toContain("too many setup attempts");
    expect(body.retryAfterSeconds).toBe(600);

    // A different source IP keeps its own budget.
    const other = await upgrade(app, env, { secret: SECRET, ip: nextIp() });
    expect(other.status).toBe(200);
  });
});

describe("admin system endpoints", () => {
  it("requires a session on all three endpoints", async () => {
    const env = makeEnv();
    const app = makeApp();
    await runMigrations(env);

    const calls: Array<[string, RequestInit]> = [
      ["/api/admin/setup", { method: "POST" }],
      ["/api/admin/system", {}],
      [
        "/api/admin/system/setup-page",
        { method: "PUT", body: JSON.stringify({ enabled: true }) },
      ],
    ];
    for (const [path, init] of calls) {
      const res = await app.request(path, init, env);
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({ error: "unauthorized" });
    }
  });

  it("GET /api/admin/system reports prefix, switch and ledger", async () => {
    const { env, app, cookie } = await ownerSession();

    const res = await app.request(
      "/api/admin/system",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      tablePrefix: "",
      setupPageEnabled: false,
      ledger: ["schema_v1"],
    });
  });

  it("POST /api/admin/setup needs no secret and matches the secret endpoint", async () => {
    const { env, app, cookie } = await ownerSession();

    const adminRes = await app.request(
      "/api/admin/setup",
      { method: "POST", headers: { cookie } },
      env,
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await readJson(adminRes);
    expect(adminBody).toEqual({
      success: true,
      tablePrefix: "",
      migrations: [{ name: "schema_v1", status: "skipped" }],
      ownerExists: true,
    });

    const secretBody = await readJson(
      await upgrade(app, env, { secret: SECRET }),
    );
    expect(secretBody).toEqual(adminBody);
    expect(countOwners(env)).toBe(1);
  });

  it("PUT /api/admin/system/setup-page toggles and persists the switch", async () => {
    const { env, app, cookie } = await ownerSession();
    const put = (body: unknown) =>
      app.request(
        "/api/admin/system/setup-page",
        {
          method: "PUT",
          body: JSON.stringify(body),
          headers: jsonHeaders({ cookie }),
        },
        env,
      );

    const on = await put({ enabled: true });
    expect(on.status).toBe(200);
    expect(await readJson(on)).toEqual({ setupPageEnabled: true });
    expect(settingValue(env, "", SETUP_PAGE_KEY)).toBe("1");
    expect(
      (await readJson(await app.request("/api/setup/state", {}, env))).enabled,
    ).toBe(true);

    // Persisted: a fresh read (what a page reload uses) still sees it.
    expect(
      (
        await readJson(
          await app.request("/api/admin/system", { headers: { cookie } }, env),
        )
      ).setupPageEnabled,
    ).toBe(true);

    const off = await put({ enabled: false });
    expect(await readJson(off)).toEqual({ setupPageEnabled: false });
    expect(settingValue(env, "", SETUP_PAGE_KEY)).toBe("0");
    expect(
      (await readJson(await app.request("/api/setup/state", {}, env))).enabled,
    ).toBe(false);
  });

  it("validates `enabled` strictly as a boolean", async () => {
    const { env, app, cookie } = await ownerSession();

    for (const body of [
      {},
      { enabled: "true" },
      { enabled: 1 },
      { enabled: null },
    ]) {
      const res = await app.request(
        "/api/admin/system/setup-page",
        {
          method: "PUT",
          body: JSON.stringify(body),
          headers: jsonHeaders({ cookie }),
        },
        env,
      );
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "enabled must be a boolean",
      });
    }
    // Untouched by the rejected writes.
    expect(settingValue(env, "", SETUP_PAGE_KEY)).toBe("0");
  });

  it("keeps setup_page_enabled out of the site-settings DTO and /api/public", async () => {
    const { env, app, cookie } = await ownerSession();
    await app.request(
      "/api/admin/system/setup-page",
      {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
        headers: jsonHeaders({ cookie }),
      },
      env,
    );

    const publicBody = await readJson(
      await app.request("/api/public", {}, env),
    );
    expect(Object.keys(publicBody.settings).sort()).toEqual([
      "backgroundUrl",
      "columns",
      "siteTitle",
      "theme",
    ]);
    expect(JSON.stringify(publicBody)).not.toContain(SETUP_PAGE_KEY);

    const settingsRes = await app.request(
      "/api/admin/settings",
      { headers: { cookie } },
      env,
    );
    expect(JSON.stringify(await readJson(settingsRes))).not.toContain(
      SETUP_PAGE_KEY,
    );

    // The generic settings write is a whitelist: it cannot touch the switch.
    const write = await app.request(
      "/api/admin/settings",
      {
        method: "PUT",
        body: JSON.stringify({ siteTitle: "nav", setupPageEnabled: false }),
        headers: jsonHeaders({ cookie }),
      },
      env,
    );
    expect(JSON.stringify(await readJson(write))).not.toContain(SETUP_PAGE_KEY);
    expect(settingValue(env, "", SETUP_PAGE_KEY)).toBe("1");
  });
});

describe("table prefix conflict", () => {
  it("returns the same 409 detail from both endpoints and builds no second schema", async () => {
    const { env, app, cookie } = await ownerSession("app_");
    // Simulate a database already carrying nav's schema under another prefix:
    // the configured prefix has no ledger of its own (its tables and this admin
    // session stay, since sessions live in {prefix}sessions) while a nav_* table
    // family appears. Migrating would silently build a second, empty schema.
    sqliteOf(env).exec(
      "DROP TABLE _app_schema_migrations;" +
        "CREATE TABLE nav_passkey_credentials (id TEXT);" +
        "CREATE TABLE nav_search_engines (id TEXT);" +
        "CREATE TABLE nav_login_attempts (id TEXT);",
    );
    const before = tableNames(env);

    const secretRes = await upgrade(app, env, { secret: SECRET });
    expect(secretRes.status).toBe(409);
    const secretBody = await readJson(secretRes);
    expect(secretBody.error).toBe("table prefix conflict");
    expect(typeof secretBody.detail).toBe("string");
    expect(secretBody.detail).toContain("nav_");

    const adminRes = await app.request(
      "/api/admin/setup",
      { method: "POST", headers: { cookie } },
      env,
    );
    expect(adminRes.status).toBe(409);
    expect(await readJson(adminRes)).toEqual(secretBody);

    // No second set of tables (and no ledger) appeared.
    expect(tableNames(env)).toEqual(before);
  });
});

describe("worker wiring", () => {
  it("serves /api/setup/state and /api/setup/status from the real app", async () => {
    const env = makeEnv();
    for (const path of ["/api/setup/state", "/api/setup/status"]) {
      const res = await worker.fetch(
        new Request(`http://localhost${path}`),
        env,
      );
      expect(res.status).toBe(200);
      expect(await readJson(res)).toEqual({
        enabled: true,
        ownerExists: false,
        tablePrefix: "",
      });
    }
  });

  it("serves index.html for a direct /setup request (SPA fallback)", async () => {
    const requested: string[] = [];
    const env = makeEnv({
      ASSETS: {
        fetch: async (req: Request) => {
          const path = new URL(req.url).pathname;
          requested.push(path);
          if (path === "/") {
            return new Response("<!doctype html><html>nav</html>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          return new Response("not found", { status: 404 });
        },
      } as unknown as Fetcher,
    });

    const res = await worker.fetch(
      new Request("http://localhost/setup"),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<!doctype html>");
    // /setup misses in static assets, then falls back to the SPA entry point.
    expect(requested).toEqual(["/setup", "/"]);
  });
});
