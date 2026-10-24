import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrate";
import { authRoutes } from "../src/routes/auth";
import { privateRoutes } from "../src/routes/private";
import { adminRoutes } from "../src/routes/admin";
import type { Env } from "../src/types";
import { makeEnv, readJson, type SqliteD1 } from "./helpers";
import { generateTOTPSecret, generateTOTPCode } from "../src/core/totp";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/private", privateRoutes);
  app.route("/api/admin", adminRoutes);
  return app;
}

function setupRequest(app: Hono, env: Env): Promise<Response> {
  return app.request(
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
}

function loginRequest(
  app: Hono,
  env: Env,
  username: string,
  password: string,
): Promise<Response> {
  return app.request(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: { "content-type": "application/json" },
    },
    env,
  );
}

function cookieFrom(res: Response): string {
  return res.headers.get("set-cookie") ?? "";
}

describe("password login + lockout", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    await setupRequest(app, env);
  });

  it("logs in with the correct password and issues an HttpOnly session cookie", async () => {
    const res = await loginRequest(app, env, "owner", "password123");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.success).toBe(true);

    const cookie = cookieFrom(res);
    expect(cookie).toContain("nav_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects a wrong password with 401 and reveals no data", async () => {
    const res = await loginRequest(app, env, "owner", "wrong-password");
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error).toBe("invalid credentials");
    expect(body.remainingAttempts).toBeLessThan(5);
  });

  it("locks the account after 5 consecutive failures", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await loginRequest(app, env, "owner", "wrong-password");
      expect([401, 429]).toContain(res.status);
    }
    const locked = await loginRequest(app, env, "owner", "password123");
    expect(locked.status).toBe(429);
    const body = await readJson(locked);
    expect(body.error).toContain("too many failed attempts");
  });
});

describe("password + TOTP second factor", () => {
  let env: Env;
  let app: Hono;

  beforeEach(async () => {
    env = makeEnv();
    app = makeApp();
    await runMigrations(env);
    const setupRes = await setupRequest(app, env);
    const cookie = cookieFrom(setupRes);

    // Enable TOTP via the authenticated management endpoints.
    const { secret, uri } = generateTOTPSecret();
    expect(uri).toContain("otpauth://totp/nav");

    const db = (env.DB as unknown as SqliteD1).db;
    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    ).run("totp_secret", secret, now);
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    ).run("totp_enabled", "1", now);
    void cookie;
  });

  it("requires the TOTP code and accepts a valid one", async () => {
    const step1 = await loginRequest(app, env, "owner", "password123");
    expect(step1.status).toBe(200);
    const body1 = await readJson(step1);
    expect(body1.requires2fa).toBe(true);
    expect(typeof body1.tempToken).toBe("string");

    const secret = (
      (env.DB as unknown as SqliteD1).db
        .prepare("SELECT value FROM settings WHERE key = 'totp_secret'")
        .get() as { value: string }
    ).value;
    const code = await generateTOTPCode(
      secret,
      Math.floor(Date.now() / 1000 / 30),
    );

    const step2 = await app.request(
      "/api/auth/2fa/verify",
      {
        method: "POST",
        body: JSON.stringify({ tempToken: body1.tempToken, code }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(step2.status).toBe(200);
    expect((await readJson(step2)).success).toBe(true);
    expect(cookieFrom(step2)).toContain("nav_session=");
  });

  it("rejects a wrong TOTP code with 401", async () => {
    const step1 = await loginRequest(app, env, "owner", "password123");
    const body1 = await readJson(step1);

    const step2 = await app.request(
      "/api/auth/2fa/verify",
      {
        method: "POST",
        body: JSON.stringify({ tempToken: body1.tempToken, code: "000000" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(step2.status).toBe(401);
  });
});

describe("authenticated access after login", () => {
  it("GET /api/private with a valid session returns full data with no-store", async () => {
    const env = makeEnv();
    const app = makeApp();
    await runMigrations(env);
    const setupRes = await setupRequest(app, env);
    const cookie = cookieFrom(setupRes);

    const res = await app.request("/api/private", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readJson(res);
    expect(body).toHaveProperty("categories");
    expect(body).toHaveProperty("searchEngines");
    expect(body).toHaveProperty("settings");
  });

  it("logout revokes the session", async () => {
    const env = makeEnv();
    const app = makeApp();
    await runMigrations(env);
    const setupRes = await setupRequest(app, env);
    const cookie = cookieFrom(setupRes);

    const logout = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { cookie } },
      env,
    );
    expect(logout.status).toBe(200);

    const after = await app.request(
      "/api/private",
      { headers: { cookie } },
      env,
    );
    expect(after.status).toBe(401);
  });
});
