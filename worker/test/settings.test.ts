import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrations-runner";
import { authRoutes } from "../src/routes/auth";
import { adminRoutes } from "../src/routes/admin";
import { publicRoutes } from "../src/routes/public";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";

/**
 * `PUT /api/admin/settings` columns validation (contract: 0–12).
 *
 * `0` means "unconfigured": `GET /api/admin/settings` reports it on a fresh
 * database, so it has to be writable verbatim — otherwise reading a fresh
 * setting and saving it back fails with a 400.
 */

const OWNER_PASSWORD = "correct horse battery";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/public", publicRoutes);
  return app;
}

async function signIn(app: Hono, env: Env): Promise<string> {
  const res = await app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({ username: "owner", password: OWNER_PASSWORD }),
      headers: {
        "content-type": "application/json",
        "x-setup-secret": "test-setup-secret",
      },
    },
    env,
  );
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie") ?? "";
}

function getSettings(app: Hono, env: Env, cookie: string): Promise<Response> {
  return app.request("/api/admin/settings", { headers: { cookie } }, env);
}

function putSettings(
  app: Hono,
  env: Env,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return app.request(
    "/api/admin/settings",
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
    },
    env,
  );
}

/** Raw stored value of the `columns` setting row, or `null` when absent. */
function storedColumns(env: Env): string | null {
  return storedSetting(env, "columns");
}

/** Raw stored value of an arbitrary settings row, or `null` when absent. */
function storedSetting(env: Env, key: string): string | null {
  const row = (env.DB as unknown as SqliteD1).db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

describe("PUT /api/admin/settings columns", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("round-trips columns=0 on a fresh database (GET 0 → PUT 0 → GET 0)", async () => {
    // Fresh D1: no columns row yet, so the contract-visible value is 0.
    const before = await readJson(await getSettings(app, env, cookie));
    expect(before.columns).toBe(0);

    const res = await putSettings(app, env, cookie, {
      columns: before.columns,
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).columns).toBe(0);

    // Stored verbatim — not coerced to a default column count.
    expect(storedColumns(env)).toBe("0");

    const after = await readJson(await getSettings(app, env, cookie));
    expect(after.columns).toBe(0);
  });

  it("keeps 0 when it is written together with other settings", async () => {
    const res = await putSettings(app, env, cookie, {
      siteTitle: "nav",
      backgroundUrl: "",
      logoUrl: "",
      theme: "dark",
      columns: 0,
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toMatchObject({ siteTitle: "nav", theme: "dark", columns: 0 });
    expect(storedColumns(env)).toBe("0");
  });

  it("accepts every value in 1–12 (existing range unchanged)", async () => {
    for (let columns = 1; columns <= 12; columns++) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(200);
      expect((await readJson(res)).columns).toBe(columns);
      expect(storedColumns(env)).toBe(String(columns));
    }
  });

  it("still rejects values outside 0–12", async () => {
    await putSettings(app, env, cookie, { columns: 5 });

    for (const columns of [-1, 13, 100]) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "columns must be between 0 and 12",
      });
    }
    // A rejected write must not touch the stored value.
    expect(storedColumns(env)).toBe("5");
  });

  it("rejects non-numeric columns with the same 400", async () => {
    for (const columns of ["abc", "", null, true]) {
      const res = await putSettings(app, env, cookie, { columns });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "columns must be between 0 and 12",
      });
    }
  });
});

/**
 * `searchNewTab`（搜索在新标签页打开）：KV 键 `search_new_tab`，值 `"1"`/`"0"`。
 * 存量库无此键时 DTO 按 `true`（默认开）返回；公开端点同样带出该字段给前端。
 */
describe("settings searchNewTab (search_new_tab)", () => {
  let env: Env;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("defaults to true when the key is absent (admin + public DTO)", async () => {
    expect(storedSetting(env, "search_new_tab")).toBeNull();

    const admin = await readJson(await getSettings(app, env, cookie));
    expect(admin.searchNewTab).toBe(true);

    const pub = await readJson(await app.request("/api/public", {}, env));
    expect(pub.settings.searchNewTab).toBe(true);
  });

  it('round-trips false/true as "0"/"1" and mirrors into /api/public', async () => {
    let res = await putSettings(app, env, cookie, { searchNewTab: false });
    expect(res.status).toBe(200);
    expect((await readJson(res)).searchNewTab).toBe(false);
    expect(storedSetting(env, "search_new_tab")).toBe("0");
    expect(
      (await readJson(await app.request("/api/public", {}, env))).settings
        .searchNewTab,
    ).toBe(false);

    res = await putSettings(app, env, cookie, { searchNewTab: true });
    expect((await readJson(res)).searchNewTab).toBe(true);
    expect(storedSetting(env, "search_new_tab")).toBe("1");
  });

  it("keeps the stored value when other settings are written", async () => {
    await putSettings(app, env, cookie, { searchNewTab: false });
    const res = await putSettings(app, env, cookie, { siteTitle: "nav2" });
    const body = await readJson(res);
    expect(body.siteTitle).toBe("nav2");
    expect(body.searchNewTab).toBe(false);
  });

  it("rejects non-boolean values with 400 and keeps the stored value", async () => {
    await putSettings(app, env, cookie, { searchNewTab: true });
    for (const searchNewTab of ["0", 1, 0, null, "true"]) {
      const res = await putSettings(app, env, cookie, { searchNewTab });
      expect(res.status).toBe(400);
      expect(await readJson(res)).toEqual({
        error: "searchNewTab must be a boolean",
      });
    }
    expect(storedSetting(env, "search_new_tab")).toBe("1");
  });

  it("lists search_new_tab in the settings whitelist", async () => {
    const res = await app.request(
      "/api/admin/settings/keys",
      { headers: { cookie } },
      env,
    );
    expect((await readJson(res)).keys).toContain("search_new_tab");
  });
});
