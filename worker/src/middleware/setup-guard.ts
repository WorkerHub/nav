import type { Context, Next } from "hono";
import { getTablePrefix, type HonoEnv } from "../types";
import { getSetting } from "../db/queries/settings";
import { countUsers } from "../db/queries/users";
import { nowIso } from "../db/sql";
import { unauthorized } from "./auth";

/**
 * Setup is open while no owner account exists AND the setup token is presented.
 * Once the owner exists, setup is permanently closed.
 */
export async function setupGuard(c: Context<HonoEnv>, next: Next) {
  const prefix = getTablePrefix(c.env);
  const users = await countUsers(c.env.DB, prefix);
  if (users > 0) {
    return c.json({ error: "setup already completed" }, 403);
  }
  await next();
}

export async function setupCompleted(
  db: D1Database,
  prefix: string,
): Promise<boolean> {
  const value = await getSetting(db, prefix, "setup_completed");
  return value === "1";
}

export async function markSetupCompleted(
  db: D1Database,
  prefix: string,
): Promise<void> {
  const { setSetting } = await import("../db/queries/settings");
  await setSetting(db, prefix, "setup_completed", "1");
}

export { unauthorized, nowIso };
