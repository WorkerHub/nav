// Default seed data (ONE-446).
//
// A freshly initialised install has the whole schema but zero rows in
// `{prefix}search_engines`, which leaves the start page without a usable search
// box. The setup / upgrade path therefore tops that one table up with the five
// engines below — but ONLY while it is empty. As soon as the owner has any
// engine of their own (or deliberately emptied the table) nothing is written.
//
// Idempotency holds on two levels:
// - an emptiness probe (one COUNT) decides whether to write at all;
// - deterministic ids + `INSERT OR IGNORE`, so even two setup requests racing
//   between probe and insert cannot create a second copy of the same engine —
//   the primary key absorbs the duplicate.
//
// This is deliberately NOT a migration version: the ledger stays the single
// source of truth for the schema, and the seed is data, re-checkable on every
// upgrade without adding a `schema_v2`.

import { nowIso } from "./sql";

/** One default search engine, written verbatim into `{prefix}search_engines`. */
export interface SeedSearchEngine {
  /** Stable id: fixed slug, never regenerated, so re-seeding is idempotent. */
  id: string;
  name: string;
  /** `{q}` is the query placeholder substituted by the client. */
  urlTemplate: string;
  sortOrder: number;
  isDefault: boolean;
}

/** Frozen seed set (ONE-446 §冻结接口契约): order 1–5, only Google is default. */
export const SEED_SEARCH_ENGINES: readonly SeedSearchEngine[] = [
  {
    id: "seed-google",
    name: "Google",
    urlTemplate: "https://www.google.com/search?q={q}",
    sortOrder: 1,
    isDefault: true,
  },
  {
    id: "seed-bing",
    name: "Bing",
    urlTemplate: "https://www.bing.com/search?q={q}",
    sortOrder: 2,
    isDefault: false,
  },
  {
    id: "seed-duckduckgo",
    name: "DuckDuckGo",
    urlTemplate: "https://duckduckgo.com/?q={q}",
    sortOrder: 3,
    isDefault: false,
  },
  {
    id: "seed-baidu",
    name: "百度",
    urlTemplate: "https://www.baidu.com/s?wd={q}",
    sortOrder: 4,
    isDefault: false,
  },
  {
    id: "seed-github",
    name: "GitHub",
    urlTemplate: "https://github.com/search?q={q}",
    sortOrder: 5,
    isDefault: false,
  },
];

/** Table the defaults live in — keeps the `{prefix}` formula in one place. */
export function searchEnginesTable(prefix: string): string {
  return `${prefix}search_engines`;
}

export interface SeedSearchEnginesOutcome {
  /** `true` only when this call found the table empty and wrote the defaults. */
  seeded: boolean;
  /** Rows written by this call (0 when the table already had engines). */
  inserted: number;
}

/**
 * Inserts {@link SEED_SEARCH_ENGINES} into `{prefix}search_engines` when — and
 * only when — the table is empty. Any existing row makes this a no-op, so a
 * second setup / upgrade run leaves the table byte-identical.
 */
export async function seedSearchEngines(
  db: D1Database,
  prefix: string,
): Promise<SeedSearchEnginesOutcome> {
  const table = searchEnginesTable(prefix);

  const existing = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  // `?? 0` also covers a driver returning no row for the aggregate.
  if ((existing?.count ?? 0) > 0) return { seeded: false, inserted: 0 };

  const now = nowIso();
  const placeholders = SEED_SEARCH_ENGINES.map(
    () => "(?, ?, ?, ?, ?, ?, ?, ?)",
  ).join(", ");
  const values = SEED_SEARCH_ENGINES.flatMap((engine) => [
    engine.id,
    engine.name,
    engine.urlTemplate,
    // icon: optional by contract — no bundled artwork, so NULL.
    null,
    engine.sortOrder,
    engine.isDefault ? 1 : 0,
    now,
    now,
  ]);

  await db
    .prepare(
      `INSERT OR IGNORE INTO ${table} (id, name, url_template, icon, sort_order, is_default, created_at, updated_at) VALUES ${placeholders}`,
    )
    .bind(...values)
    .run();

  return { seeded: true, inserted: SEED_SEARCH_ENGINES.length };
}
