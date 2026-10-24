import { nowIso } from "../db/sql";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;
export const ATTEMPT_WINDOW_SECONDS = 15 * 60;

/**
 * Login throttling + progressive lockout, D1-backed (single store, no KV).
 * - rate limit: at most MAX_FAILED_ATTEMPTS failures per username+IP window
 * - lockout: after MAX_FAILED_ATTEMPTS consecutive failures the account is
 *   locked for LOCKOUT_SECONDS (locked_until on the latest attempt row)
 */
export async function isLockedOut(
  db: D1Database,
  prefix: string,
  username: string,
  ip: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT locked_until FROM ${prefix}login_attempts
       WHERE username = ? COLLATE NOCASE AND locked_until IS NOT NULL AND locked_until > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(username, nowIso())
    .first<{ locked_until: string }>();
  void ip;
  return Boolean(row);
}

export async function countRecentFailures(
  db: D1Database,
  prefix: string,
  username: string,
  ip: string,
): Promise<number> {
  const since = new Date(
    Date.now() - ATTEMPT_WINDOW_SECONDS * 1000,
  ).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${prefix}login_attempts
       WHERE username = ? COLLATE NOCASE AND ip = ? AND success = 0 AND created_at > ?`,
    )
    .bind(username, ip, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordAttempt(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    username: string;
    ip: string;
    success: boolean;
    lockUntil?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${prefix}login_attempts (id, username, ip, success, created_at, locked_until)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.username,
      data.ip,
      data.success ? 1 : 0,
      nowIso(),
      data.lockUntil ?? null,
    )
    .run();
}

export async function clearFailures(
  db: D1Database,
  prefix: string,
  username: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM ${prefix}login_attempts WHERE username = ? COLLATE NOCASE AND success = 0`,
    )
    .bind(username)
    .run();
}

export async function purgeOldAttempts(
  db: D1Database,
  prefix: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await db
    .prepare(`DELETE FROM ${prefix}login_attempts WHERE created_at < ?`)
    .bind(cutoff)
    .run();
}

/** Record a failure; returns the remaining attempts before lockout. */
export async function recordFailure(
  db: D1Database,
  prefix: string,
  data: { id: string; username: string; ip: string },
): Promise<{ locked: boolean; remaining: number }> {
  const fails =
    (await countRecentFailures(db, prefix, data.username, data.ip)) + 1;
  const locked = fails >= MAX_FAILED_ATTEMPTS;
  const lockUntil = locked
    ? new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString()
    : null;
  await recordAttempt(db, prefix, {
    id: data.id,
    username: data.username,
    ip: data.ip,
    success: false,
    lockUntil,
  });
  return { locked, remaining: Math.max(0, MAX_FAILED_ATTEMPTS - fails) };
}
