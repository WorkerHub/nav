import { Hono, type Context } from "hono";
import { getTablePrefix, type HonoEnv } from "../types";
import { safeEqual } from "../core/auth";
import {
  isSetupRateLimited,
  recordSetupAttempt,
  SETUP_RATE_LIMIT_WINDOW_SECONDS,
} from "../core/setup-rate-limit";
import { clientIp } from "../services/session";
import { resolveSetupState, runSetupMigrations } from "../services/setup";

/**
 * Setup surface (SETUP-PAGE-SPEC §3.1–§3.2). Mounted at `/api`, so:
 * - `GET  /api/setup/state`  — canonical state endpoint (no auth, no-store)
 * - `GET  /api/setup/status` — legacy alias, identical payload/logic
 * - `POST /api/setup`        — secret-gated, migration-only upgrade endpoint
 *
 * The switch in §3.4 gates the PAGE only; it never gates these secret-gated
 * endpoints (the secret is the latch), so a closed page can never deadlock
 * recovery.
 */
export const setupRoutes = new Hono<HonoEnv>();

async function setupState(c: Context<HonoEnv>): Promise<Response> {
  const state = await resolveSetupState(c.env);
  c.header("Cache-Control", "no-store");
  return c.json(state);
}

setupRoutes.get("/setup/state", setupState);

// Deprecated alias kept for SPA compatibility; same logic, same payload.
setupRoutes.get("/setup/status", setupState);

setupRoutes.post("/setup", async (c) => {
  // The secret is a request header only — never URL/query (no GET variant).
  const expected = c.env.SETUP_SECRET;
  if (!expected || expected.endsWith("_PLACEHOLDER")) {
    return c.json({ error: "server misconfigured" }, 500);
  }

  const prefix = getTablePrefix(c.env);
  const ip = clientIp(c);

  if (await isSetupRateLimited(c.env.DB, prefix, ip)) {
    return c.json(
      {
        error: "too many setup attempts, try again later",
        retryAfterSeconds: SETUP_RATE_LIMIT_WINDOW_SECONDS,
      },
      429,
      { "Retry-After": String(SETUP_RATE_LIMIT_WINDOW_SECONDS) },
    );
  }
  // Every attempt spends budget, including wrong secrets.
  await recordSetupAttempt(c.env.DB, prefix, ip);

  const secret = c.req.header("X-Setup-Secret");
  if (!secret || !(await safeEqual(secret, expected))) {
    return c.json({ error: "invalid setup secret" }, 403);
  }

  // Forward-only, ledgered migrations only: no user created, no password
  // changed, no table dropped.
  const outcome = await runSetupMigrations(c.env);
  if (!outcome.ok) return c.json(outcome.body, outcome.status);
  return c.json(outcome.body);
});
