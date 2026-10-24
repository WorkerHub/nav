import type { PasskeyCredential, Session, User } from "../../types";
import { nowIso } from "../sql";

export async function countUsers(
  db: D1Database,
  prefix: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${prefix}users`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findUserByUsername(
  db: D1Database,
  prefix: string,
  username: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}users WHERE username = ? COLLATE NOCASE`)
    .bind(username.trim())
    .first<User>();
}

export async function findUserById(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}users WHERE id = ?`)
    .bind(id)
    .first<User>();
}

/**
 * Single-statement insert so "the only owner account" cannot race: the INSERT
 * only succeeds while the users table is empty.
 */
export async function createOwner(
  db: D1Database,
  prefix: string,
  data: { id: string; username: string; password_hash: string },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}users (id, username, password_hash, is_active, created_at, updated_at)
       SELECT ?, ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM ${prefix}users) = 0`,
    )
    .bind(data.id, data.username, data.password_hash, now, now)
    .run();
}

export async function updatePasswordHash(
  db: D1Database,
  prefix: string,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ${prefix}users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(passwordHash, nowIso(), userId)
    .run();
}

// ─── Passkey credentials ─────────────────────────────────────────────────────

export async function listPasskeys(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<PasskeyCredential[]> {
  const result = await db
    .prepare(`SELECT * FROM ${prefix}passkey_credentials WHERE user_id = ?`)
    .bind(userId)
    .all<PasskeyCredential>();
  return result.results;
}

export async function findPasskey(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<PasskeyCredential | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}passkey_credentials WHERE id = ?`)
    .bind(id)
    .first<PasskeyCredential>();
}

export async function insertPasskey(
  db: D1Database,
  prefix: string,
  data: { id: string; user_id: string; public_key: string; counter: number },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}passkey_credentials (id, user_id, public_key, counter, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(data.id, data.user_id, data.public_key, data.counter, now, now)
    .run();
}

export async function updatePasskeyCounter(
  db: D1Database,
  prefix: string,
  id: string,
  counter: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ${prefix}passkey_credentials SET counter = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(counter, nowIso(), id)
    .run();
}

export async function deletePasskeys(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}passkey_credentials WHERE user_id = ?`)
    .bind(userId)
    .run();
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function insertSession(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    user_id: string;
    expires_at: string;
    ip: string | null;
    user_agent: string | null;
  },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.user_id,
      now,
      data.expires_at,
      now,
      data.ip,
      data.user_agent,
    )
    .run();
}

export async function findSession(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<Session | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}sessions WHERE id = ?`)
    .bind(id)
    .first<Session>();
}

export async function touchSession(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db
    .prepare(`UPDATE ${prefix}sessions SET last_seen_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
}

export async function deleteSession(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM ${prefix}sessions WHERE id = ?`).bind(id).run();
}

export async function deleteExpiredSessions(
  db: D1Database,
  prefix: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}sessions WHERE expires_at < ?`)
    .bind(nowIso())
    .run();
}
