import type { HonoEnv, JWTPayload } from "../types";
import { getTablePrefix } from "../types";
import { generateId, signJWT } from "../core/auth";
import { insertSession } from "../db/queries/users";
import { setCookie } from "hono/cookie";
import { SESSION_COOKIE, sessionMaxAge } from "../middleware/auth";

export function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Issue a session row + HttpOnly/Secure/SameSite cookie (SPEC §4). */
export async function issueSession(
  c: {
    env: HonoEnv["Bindings"];
    req: { header: (n: string) => string | undefined };
  },
  userId: string,
): Promise<void> {
  const prefix = getTablePrefix(c.env);
  const sid = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + sessionMaxAge()) * 1000).toISOString();

  await insertSession(c.env.DB, prefix, {
    id: sid,
    user_id: userId,
    expires_at: expiresAt,
    ip: clientIp(c),
    user_agent: c.req.header("user-agent") ?? null,
  });

  const payload: JWTPayload = {
    typ: "access",
    sub: userId,
    jti: generateId(),
    sid,
    iat: now,
    exp: now + sessionMaxAge(),
  };
  const token = await signJWT(payload, c.env.SESSION_SECRET);

  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: sessionMaxAge(),
  });
}
