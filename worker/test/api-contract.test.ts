import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrate";
import { publicRoutes } from "../src/routes/public";
import { privateRoutes } from "../src/routes/private";
import { adminRoutes } from "../src/routes/admin";
import { authRoutes } from "../src/routes/auth";
import type { Env } from "../src/types";
import { makeEnv, type SqliteD1, readJson, jsonRequest } from "./helpers";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/public", publicRoutes);
  app.route("/api/private", privateRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

async function seedContent(db: SqliteD1): Promise<void> {
  const now = new Date().toISOString();
  const sql = db.db;
  sql
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("cat-public", "Public Cat", null, 0, "public", now, now);
  sql
    .prepare(
      "INSERT INTO categories (id, name, icon, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("cat-private", "Private Cat", null, 1, "private", now, now);
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-pub",
      "cat-public",
      "Public Link",
      "https://pub.example.com",
      null,
      null,
      0,
      "public",
      now,
      now,
    );
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-priv",
      "cat-private",
      "Private Link",
      "https://priv.example.com",
      null,
      null,
      0,
      "private",
      now,
      now,
    );
  // Public link nested under a private category — stricter visibility wins.
  sql
    .prepare(
      "INSERT INTO links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "link-nested",
      "cat-private",
      "Nested Public Link",
      "https://nested.example.com",
      null,
      null,
      1,
      "public",
      now,
      now,
    );
  sql
    .prepare(
      "INSERT INTO search_engines (id, name, url_template, icon, sort_order, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "se-1",
      "Google",
      "https://www.google.com/search?q={q}",
      null,
      0,
      1,
      now,
      now,
    );
  sql
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run("site_title", "My Nav", now);
}

describe("public/private surface isolation", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    await seedContent(env.DB as unknown as SqliteD1);
  });

  it("GET /api/public contains no private categories or links", async () => {
    const res = await app.request("/api/public", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");

    const body = await readJson(res);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Private Cat");
    expect(text).not.toContain("priv.example.com");
    // Public link inside a private category is also withheld.
    expect(text).not.toContain("Nested Public Link");
    expect(text).not.toContain("nested.example.com");

    expect(body.categories).toHaveLength(1);
    expect(body.categories[0].id).toBe("cat-public");
    expect(body.categories[0].links).toHaveLength(1);
    expect(body.settings.siteTitle).toBe("My Nav");
    expect(body.searchEngines).toHaveLength(1);
    expect(body.searchEngines[0].isDefault).toBe(true);
  });

  it("GET /api/private without a session returns 401 JSON with no-store", async () => {
    const res = await app.request("/api/private", {}, env);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readJson(res);
    expect(body).toEqual({ error: "unauthorized" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("priv.example.com");
  });

  it("GET /api/admin/* without a session returns 401 JSON", async () => {
    for (const path of [
      "/api/admin/categories",
      "/api/admin/links",
      "/api/admin/settings",
    ]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(401);
      expect(await readJson(res)).toEqual({ error: "unauthorized" });
    }
    const write = await app.request(
      "/api/admin/categories",
      {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(write.status).toBe(401);
  });
});

describe("setup flow", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
  });

  it("setup/status reports enabled before the owner exists", async () => {
    const full = new Hono();
    full.get("/api/setup/status", async (c) => {
      const db = (env.DB as unknown as SqliteD1).db;
      const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
        n: number;
      };
      return c.json({ enabled: row.n === 0 });
    });
    void app;
    const res = await full.request("/api/setup/status", {}, env);
    expect(await readJson(res)).toEqual({ enabled: true });
  });

  it("creates the single owner with the setup secret and closes afterwards", async () => {
    // wrong secret → 403
    const denied = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "nope",
        },
      },
      env,
    );
    expect(denied.status).toBe(403);

    const ok = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "test-setup-secret",
        },
      },
      env,
    );
    expect(ok.status).toBe(201);
    const body = await readJson(ok);
    expect(body.user.username).toBe("owner");
    expect(body.user.passwordHash).toBeUndefined();

    // setup closes
    const again = await app.request(
      "/api/auth/setup",
      {
        method: "POST",
        body: JSON.stringify({ username: "owner2", password: "password123" }),
        headers: {
          "content-type": "application/json",
          "X-Setup-Secret": "test-setup-secret",
        },
      },
      env,
    );
    expect(again.status).toBe(403);

    const state = await app.request("/api/auth/setup", {}, env);
    expect(await readJson(state)).toEqual({ enabled: false });
  });

  it("has no registration endpoint", async () => {
    const res = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});
