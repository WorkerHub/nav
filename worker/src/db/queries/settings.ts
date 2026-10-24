import type { Setting } from "../../types";
import { nowIso } from "../sql";

export async function getSetting(
  db: D1Database,
  prefix: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM ${prefix}settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  prefix: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${prefix}settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, nowIso())
    .run();
}

export async function getAllSettings(
  db: D1Database,
  prefix: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare(`SELECT key, value FROM ${prefix}settings`)
    .all<Pick<Setting, "key" | "value">>();
  return Object.fromEntries(result.results.map((r) => [r.key, r.value]));
}
