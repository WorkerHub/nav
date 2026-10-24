import type { Category, Link, SearchEngine } from "../../types";
import { nowIso } from "../sql";

const CATEGORY_COLUMNS = ["name", "icon", "sort_order", "visibility"] as const;
const LINK_COLUMNS = [
  "category_id",
  "title",
  "url",
  "icon_url",
  "description",
  "sort_order",
  "visibility",
] as const;
const ENGINE_COLUMNS = [
  "name",
  "url_template",
  "icon",
  "sort_order",
  "is_default",
] as const;

function assertColumns(
  table: string,
  data: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key))
      throw new Error(`invalid column ${key} for ${table}`);
  }
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(
  db: D1Database,
  prefix: string,
): Promise<Category[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ${prefix}categories ORDER BY sort_order, created_at`,
    )
    .all<Category>();
  return result.results;
}

export async function findCategory(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<Category | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}categories WHERE id = ?`)
    .bind(id)
    .first<Category>();
}

export async function insertCategory(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    name: string;
    icon: string | null;
    sort_order: number;
    visibility: string;
  },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}categories (id, name, icon, sort_order, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.name,
      data.icon,
      data.sort_order,
      data.visibility,
      now,
      now,
    )
    .run();
}

export async function updateCategory(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<{
    name: string;
    icon: string | null;
    sort_order: number;
    visibility: string;
  }>,
): Promise<void> {
  assertColumns(
    "updateCategory",
    data as Record<string, unknown>,
    CATEGORY_COLUMNS,
  );
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const sets = fields.map((f) => `${f} = ?`);
  sets.push("updated_at = ?");
  const values = [
    ...fields.map((f) => (data as Record<string, unknown>)[f]),
    nowIso(),
    id,
  ];
  await db
    .prepare(`UPDATE ${prefix}categories SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteCategory(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}categories WHERE id = ?`)
    .bind(id)
    .run();
}

// ─── Links ───────────────────────────────────────────────────────────────────

export async function listLinks(
  db: D1Database,
  prefix: string,
): Promise<Link[]> {
  const result = await db
    .prepare(`SELECT * FROM ${prefix}links ORDER BY sort_order, created_at`)
    .all<Link>();
  return result.results;
}

export async function findLink(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<Link | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}links WHERE id = ?`)
    .bind(id)
    .first<Link>();
}

export async function insertLink(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    category_id: string;
    title: string;
    url: string;
    icon_url: string | null;
    description: string | null;
    sort_order: number;
    visibility: string;
  },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}links (id, category_id, title, url, icon_url, description, sort_order, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.category_id,
      data.title,
      data.url,
      data.icon_url,
      data.description,
      data.sort_order,
      data.visibility,
      now,
      now,
    )
    .run();
}

export async function updateLink(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<{
    category_id: string;
    title: string;
    url: string;
    icon_url: string | null;
    description: string | null;
    sort_order: number;
    visibility: string;
  }>,
): Promise<void> {
  assertColumns("updateLink", data as Record<string, unknown>, LINK_COLUMNS);
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const sets = fields.map((f) => `${f} = ?`);
  sets.push("updated_at = ?");
  const values = [
    ...fields.map((f) => (data as Record<string, unknown>)[f]),
    nowIso(),
    id,
  ];
  await db
    .prepare(`UPDATE ${prefix}links SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteLink(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM ${prefix}links WHERE id = ?`).bind(id).run();
}

/**
 * SQLite/D1 does not enforce FK constraints by default, so deleting a category
 * must remove its links explicitly (no orphans).
 */
export async function deleteLinksByCategory(
  db: D1Database,
  prefix: string,
  categoryId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}links WHERE category_id = ?`)
    .bind(categoryId)
    .run();
}

// ─── Search engines ──────────────────────────────────────────────────────────

export async function listSearchEngines(
  db: D1Database,
  prefix: string,
): Promise<SearchEngine[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ${prefix}search_engines ORDER BY sort_order, created_at`,
    )
    .all<SearchEngine>();
  return result.results;
}

export async function findSearchEngine(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<SearchEngine | null> {
  return db
    .prepare(`SELECT * FROM ${prefix}search_engines WHERE id = ?`)
    .bind(id)
    .first<SearchEngine>();
}

export async function insertSearchEngine(
  db: D1Database,
  prefix: string,
  data: {
    id: string;
    name: string;
    url_template: string;
    icon: string | null;
    sort_order: number;
    is_default: number;
  },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO ${prefix}search_engines (id, name, url_template, icon, sort_order, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.name,
      data.url_template,
      data.icon,
      data.sort_order,
      data.is_default,
      now,
      now,
    )
    .run();
}

export async function updateSearchEngine(
  db: D1Database,
  prefix: string,
  id: string,
  data: Partial<{
    name: string;
    url_template: string;
    icon: string | null;
    sort_order: number;
    is_default: number;
  }>,
): Promise<void> {
  assertColumns(
    "updateSearchEngine",
    data as Record<string, unknown>,
    ENGINE_COLUMNS,
  );
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const sets = fields.map((f) => `${f} = ?`);
  sets.push("updated_at = ?");
  const values = [
    ...fields.map((f) => (data as Record<string, unknown>)[f]),
    nowIso(),
    id,
  ];
  await db
    .prepare(
      `UPDATE ${prefix}search_engines SET ${sets.join(", ")} WHERE id = ?`,
    )
    .bind(...values)
    .run();
}

export async function deleteSearchEngine(
  db: D1Database,
  prefix: string,
  id: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${prefix}search_engines WHERE id = ?`)
    .bind(id)
    .run();
}

export async function clearDefaultSearchEngines(
  db: D1Database,
  prefix: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ${prefix}search_engines SET is_default = 0, updated_at = ?`,
    )
    .bind(nowIso())
    .run();
}
