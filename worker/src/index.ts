import { Hono } from "hono";
import type { Env, HonoEnv } from "./types";
import { getTablePrefix } from "./types";
import { authRoutes } from "./routes/auth";
import { webauthnRoutes } from "./routes/passkey";
import { publicRoutes } from "./routes/public";
import { privateRoutes } from "./routes/private";
import { adminRoutes } from "./routes/admin";
import { getSetting } from "./db/queries/settings";
import { countUsers, deleteExpiredSessions } from "./db/queries/users";

const app = new Hono<HonoEnv>();

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  if (err instanceof SyntaxError) {
    return c.json({ error: "invalid request body" }, 400);
  }
  return c.json({ error: "internal server error" }, 500);
});

// Config guard: the session secret must be a real secret before any authed API.
app.use("/api/*", async (c, next) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret || secret.length < 16 || secret.endsWith("_PLACEHOLDER")) {
    console.error(
      "SESSION_SECRET is missing, too short, or still a placeholder",
    );
    return c.json({ error: "server misconfigured" }, 500);
  }
  await next();
});

app.use("*", async (c, next) => {
  // Resolve the table prefix once so a malformed custom prefix fails fast
  // with a clear error (SPEC v1.4: lowercase letters / digits / underscore).
  try {
    getTablePrefix(c.env);
  } catch {
    return c.json({ error: "invalid TABLE_PREFIX configuration" }, 500);
  }
  await next();
});

app.route("/api/auth", authRoutes);
app.route("/api/auth/passkey", webauthnRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/private", privateRoutes);
app.route("/api/admin", adminRoutes);

app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

/**
 * GET /api/setup/status — the one endpoint the SPA calls before rendering.
 * 200 { enabled: true } while the owner account does not exist yet.
 */
app.get("/api/setup/status", async (c) => {
  const prefix = getTablePrefix(c.env);
  try {
    const users = await countUsers(c.env.DB, prefix);
    return c.json({ enabled: users === 0 });
  } catch {
    // Uninitialized DB: setup is open (migration runs on first setup call).
    return c.json({ enabled: true });
  }
});

app.get("/api/system/info", async (c) => {
  const prefix = getTablePrefix(c.env);
  try {
    const settings = await getSetting(c.env.DB, prefix, "site_title");
    return c.json({
      app_name: settings ?? "nav",
      version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "0.0.0",
      tablePrefix: prefix,
    });
  } catch {
    return c.json({
      app_name: "nav",
      version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "0.0.0",
      tablePrefix: prefix,
    });
  }
});

// Static assets (Workers Static Assets binding), SPA fallback to index.html.
app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Opportunistic cleanup of expired sessions (no cron config required).
    const prefix = getTablePrefix(env);
    ctx.waitUntil(deleteExpiredSessions(env.DB, prefix));
  },
};
