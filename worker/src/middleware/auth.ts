import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getTablePrefix, type HonoEnv } from "../types";
import { verifyJWT } from "../core/auth";
import { findSession, findUserById } from "../db/queries/users";
import { nowIso } from "../db/sql";

export const SESSION_COOKIE = "nav_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export function sessionMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

/** 401 JSON helper shared by the private API surface. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return unauthorized();

  const payload = await verifyJWT(token, c.env.SESSION_SECRET);
  if (!payload) return unauthorized();

  const prefix = getTablePrefix(c.env);
  const session = await findSession(c.env.DB, prefix, payload.sid);
  if (!session || session.expires_at < nowIso()) return unauthorized();
  if (session.user_id !== payload.sub) return unauthorized();

  const user = await findUserById(c.env.DB, prefix, session.user_id);
  if (!user?.is_active) return unauthorized();

  c.set("userId", user.id);
  await next();
}
