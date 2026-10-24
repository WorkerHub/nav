import { nowIso } from "../db/sql";

export interface ChallengeRecord {
  id: string;
  kind: string;
  user_id: string | null;
  value: string;
  created_at: string;
  expires_at: string;
}

/**
 * Ephemeral single-use values (WebAuthn challenges, pending TOTP secrets,
 * 2FA temp tokens). Stored in D1 (the project's single store — no KV as primary
 * storage); expired rows are purged opportunistically.
 */
export async function putChallenge(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    kind: string;
    user_id?: string | null;
    value: string;
    ttlSeconds: number;
  },
): Promise<void> {
  const now = new Date();
  const expires = new Date(
    now.getTime() + data.ttlSeconds * 1000,
  ).toISOString();
  await db
    .prepare(
      `INSERT INTO ${prefix}challenges (id, kind, user_id, value, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    )
    .bind(
      data.id,
      data.kind,
      data.user_id ?? null,
      data.value,
      nowIso(),
      expires,
    )
    .run();
  await purgeChallenges(db, prefix);
}

export async function getChallenge(
  db: D1Database,
  prefix: string,
  id: string,
  kind?: string,
): Promise<ChallengeRecord | null> {
  const row = await db
    .prepare(`SELECT * FROM ${prefix}challenges WHERE id = ?`)
    .bind(id)
    .first<ChallengeRecord>();
  if (!row) return null;
  if (kind && row.kind !== kind) return null;
  if (row.expires_at < nowIso()) {
    await deleteChallenge(db, prefix, id);
    return null;
  }
  return row;
}

export async function deleteChallenge(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}challenges WHERE id = ?`)
    .bind(id)
    .run();
}

export async function purgeChallenges(
  db: D1Database,
  prefix: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}challenges WHERE expires_at < ?`)
    .bind(nowIso())
    .run();
}
