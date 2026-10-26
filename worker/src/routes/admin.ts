import { Hono } from "hono";
import {
  getTablePrefix,
  isVisibility,
  type HonoEnv,
  type SiteSettingsDto,
} from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  clearDefaultSearchEngines,
  deleteCategory,
  deleteLinksByCategory,
  deleteLink,
  deleteSearchEngine,
  findCategory,
  findLink,
  findSearchEngine,
  insertCategory,
  insertLink,
  insertSearchEngine,
  listCategories,
  listLinks,
  listSearchEngines,
  updateCategory,
  updateLink,
  updateSearchEngine,
} from "../db/queries/content";
import { getAllSettings, setSetting } from "../db/queries/settings";
import { listRecordedMigrations } from "../lib/migrations-runner";
import { generateId } from "../core/auth";
import type { Link } from "../types";
import { toSearchEngineDto, toSiteSettingsDto } from "../services/site-data";
import { deleteAssetByPublicPath } from "../services/assets";
import { deleteAsset, uploadAsset } from "./assets";
import {
  getSetupPageEnabled,
  runSetupMigrations,
  setSetupPageEnabled,
} from "../services/setup";

export const adminRoutes = new Hono<HonoEnv>();

// Contract ONE-168: all /api/admin/* writes require a session; 401 JSON otherwise.
adminRoutes.use("*", authMiddleware);

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

type Visibility = "public" | "private";

function readVisibility(value: unknown): Visibility | undefined {
  if (value === undefined) return undefined;
  return isVisibility(value) ? value : undefined;
}

function parseSortOrder(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Categories ──────────────────────────────────────────────────────────────

adminRoutes.get("/categories", async (c) => {
  const prefix = getTablePrefix(c.env);
  const categories = await listCategories(c.env.DB, prefix);
  return c.json({
    categories: categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      sortOrder: cat.sort_order,
      visibility: cat.visibility,
      createdAt: cat.created_at,
      updatedAt: cat.updated_at,
    })),
  });
});

adminRoutes.post("/categories", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req
    .json<{
      name?: unknown;
      icon?: unknown;
      sortOrder?: unknown;
      visibility?: unknown;
    }>()
    .catch(
      (): {
        name?: unknown;
        icon?: unknown;
        sortOrder?: unknown;
        visibility?: unknown;
      } => ({}),
    );

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");
  const visibility = readVisibility(body.visibility) ?? "public";
  if (body.visibility !== undefined && !isVisibility(body.visibility))
    return badRequest("visibility must be 'public' or 'private'");

  const id = generateId();
  await insertCategory(c.env.DB, prefix, {
    id,
    name,
    icon: typeof body.icon === "string" ? body.icon : null,
    sort_order: parseSortOrder(body.sortOrder, 0),
    visibility,
  });

  return c.json(
    {
      id,
      name,
      icon: typeof body.icon === "string" ? body.icon : null,
      sortOrder: parseSortOrder(body.sortOrder, 0),
      visibility,
    },
    201,
  );
});

adminRoutes.put("/categories/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findCategory(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name must not be empty");
    data.name = name;
  }
  if (body.icon !== undefined)
    data.icon = typeof body.icon === "string" ? body.icon : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility))
      return badRequest("visibility must be 'public' or 'private'");
    data.visibility = body.visibility;
  }

  await updateCategory(c.env.DB, prefix, id, data);
  const updated = await findCategory(c.env.DB, prefix, id);
  return c.json({
    id: updated?.id,
    name: updated?.name,
    icon: updated?.icon,
    sortOrder: updated?.sort_order,
    visibility: updated?.visibility,
  });
});

adminRoutes.delete("/categories/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findCategory(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteLinksByCategory(c.env.DB, prefix, id);
  await deleteCategory(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Links ───────────────────────────────────────────────────────────────────

/** Admin link DTO: full row incl. visibility + timestamps (contract: docs/api-contract.md). */
function adminLinkDto(link: Link) {
  return {
    id: link.id,
    categoryId: link.category_id,
    title: link.title,
    url: link.url,
    iconUrl: link.icon_url,
    description: link.description,
    sortOrder: link.sort_order,
    visibility: link.visibility,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

adminRoutes.get("/links", async (c) => {
  const prefix = getTablePrefix(c.env);
  const links = await listLinks(c.env.DB, prefix);
  return c.json({ links: links.map(adminLinkDto) });
});

adminRoutes.post("/links", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  if (!title) return badRequest("title is required");
  if (!url) return badRequest("url is required");
  if (!categoryId) return badRequest("categoryId is required");

  const category = await findCategory(c.env.DB, prefix, categoryId);
  if (!category) return badRequest("categoryId does not exist");
  if (body.visibility !== undefined && !isVisibility(body.visibility))
    return badRequest("visibility must be 'public' or 'private'");

  const id = generateId();
  const visibility = readVisibility(body.visibility) ?? "public";
  await insertLink(c.env.DB, prefix, {
    id,
    category_id: categoryId,
    title,
    url,
    icon_url:
      typeof body.iconUrl === "string" && body.iconUrl ? body.iconUrl : null,
    description: typeof body.description === "string" ? body.description : null,
    sort_order: parseSortOrder(body.sortOrder, 0),
    visibility,
  });

  return c.json({ id }, 201);
});

adminRoutes.put("/links/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findLink(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return badRequest("title must not be empty");
    data.title = title;
  }
  if (body.url !== undefined) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return badRequest("url must not be empty");
    data.url = url;
  }
  if (body.categoryId !== undefined) {
    const category = await findCategory(
      c.env.DB,
      prefix,
      String(body.categoryId),
    );
    if (!category) return badRequest("categoryId does not exist");
    data.category_id = body.categoryId;
  }
  if (body.iconUrl !== undefined)
    data.icon_url =
      typeof body.iconUrl === "string" && body.iconUrl ? body.iconUrl : null;
  if (body.description !== undefined)
    data.description =
      typeof body.description === "string" ? body.description : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility))
      return badRequest("visibility must be 'public' or 'private'");
    data.visibility = body.visibility;
  }

  await updateLink(c.env.DB, prefix, id, data);
  const updated = await findLink(c.env.DB, prefix, id);
  return c.json(updated ? adminLinkDto(updated) : { id });
});

adminRoutes.delete("/links/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findLink(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteLink(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Search engines ──────────────────────────────────────────────────────────

adminRoutes.get("/search-engines", async (c) => {
  const prefix = getTablePrefix(c.env);
  const engines = await listSearchEngines(c.env.DB, prefix);
  return c.json({ searchEngines: engines.map(toSearchEngineDto) });
});

adminRoutes.post("/search-engines", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const urlTemplate =
    typeof body.urlTemplate === "string" ? body.urlTemplate.trim() : "";
  if (!name) return badRequest("name is required");
  if (!urlTemplate) return badRequest("urlTemplate is required");
  if (!urlTemplate.includes("{q}"))
    return badRequest("urlTemplate must contain {q}");

  const id = generateId();
  const isDefault = body.isDefault === true || body.isDefault === 1;
  if (isDefault) await clearDefaultSearchEngines(c.env.DB, prefix);

  await insertSearchEngine(c.env.DB, prefix, {
    id,
    name,
    url_template: urlTemplate,
    icon: typeof body.icon === "string" ? body.icon : null,
    sort_order: parseSortOrder(body.sortOrder, 0),
    is_default: isDefault ? 1 : 0,
  });

  return c.json({ id }, 201);
});

adminRoutes.put("/search-engines/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findSearchEngine(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("name must not be empty");
    data.name = name;
  }
  if (body.urlTemplate !== undefined) {
    const urlTemplate =
      typeof body.urlTemplate === "string" ? body.urlTemplate.trim() : "";
    if (!urlTemplate.includes("{q}"))
      return badRequest("urlTemplate must contain {q}");
    data.url_template = urlTemplate;
  }
  if (body.icon !== undefined)
    data.icon = typeof body.icon === "string" ? body.icon : null;
  if (body.sortOrder !== undefined)
    data.sort_order = parseSortOrder(body.sortOrder, existing.sort_order);
  if (body.isDefault !== undefined) {
    const isDefault = body.isDefault === true || body.isDefault === 1;
    if (isDefault) await clearDefaultSearchEngines(c.env.DB, prefix);
    data.is_default = isDefault ? 1 : 0;
  }

  await updateSearchEngine(c.env.DB, prefix, id, data);
  return c.json({ id });
});

adminRoutes.delete("/search-engines/:id", async (c) => {
  const prefix = getTablePrefix(c.env);
  const id = c.req.param("id");
  const existing = await findSearchEngine(c.env.DB, prefix, id);
  if (!existing) return c.json({ error: "not found" }, 404);
  await deleteSearchEngine(c.env.DB, prefix, id);
  return c.json({ success: true });
});

// ─── Sort order (batch) ──────────────────────────────────────────────────────

adminRoutes.post("/categories/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of category ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of category ids");
    await updateCategory(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

adminRoutes.post("/links/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of link ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of link ids");
    await updateLink(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

adminRoutes.post("/search-engines/reorder", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.ids))
    return badRequest("ids must be an array of search engine ids");
  for (const [index, id] of body.ids.entries()) {
    if (typeof id !== "string")
      return badRequest("ids must be an array of search engine ids");
    await updateSearchEngine(c.env.DB, prefix, id, { sort_order: index });
  }
  return c.json({ success: true });
});

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTING_KEYS = [
  "site_title",
  "background_url",
  "logo_url",
  "theme",
  "columns",
] as const;

adminRoutes.get("/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const settings = await getAllSettings(c.env.DB, prefix);
  const dto: SiteSettingsDto = toSiteSettingsDto(settings);
  return c.json(dto);
});

adminRoutes.put("/settings", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  const previous = await getAllSettings(c.env.DB, prefix);

  const updates: Record<string, string> = {};
  /** Local `/assets/…` values orphaned by this write (owner of the binding). */
  const replacedAssets: string[] = [];

  if (body.siteTitle !== undefined) updates.site_title = String(body.siteTitle);
  if (body.backgroundUrl !== undefined) {
    updates.background_url = String(body.backgroundUrl);
    collectReplacedAsset(
      previous.background_url,
      updates.background_url,
      replacedAssets,
    );
  }
  if (body.logoUrl !== undefined) {
    updates.logo_url = String(body.logoUrl);
    collectReplacedAsset(previous.logo_url, updates.logo_url, replacedAssets);
  }
  if (body.theme !== undefined) {
    const theme = String(body.theme);
    if (!["light", "dark", "system"].includes(theme))
      return badRequest("theme must be light, dark or system");
    updates.theme = theme;
  }
  if (body.columns !== undefined) {
    const columns = Number.parseInt(String(body.columns), 10);
    if (!Number.isFinite(columns) || columns < 1 || columns > 12)
      return badRequest("columns must be between 1 and 12");
    updates.columns = String(columns);
  }

  for (const [key, value] of Object.entries(updates)) {
    await setSetting(c.env.DB, prefix, key, value);
  }

  // Auto-clean: a local upload that was just replaced is deleted from R2.
  // External URLs never reach this list, and a missing binding is a no-op.
  for (const publicPath of replacedAssets) {
    await deleteAssetByPublicPath(c.env.R2, publicPath);
  }

  const settings = await getAllSettings(c.env.DB, prefix);
  return c.json(toSiteSettingsDto(settings));
});

/** Queue the old value for deletion when a local upload is replaced by anything else. */
function collectReplacedAsset(
  previousValue: string | undefined,
  nextValue: string,
  into: string[],
): void {
  if (!previousValue || previousValue === nextValue) return;
  if (previousValue.startsWith("/assets/")) into.push(previousValue);
}

adminRoutes.get("/settings/keys", (c) => c.json({ keys: SETTING_KEYS }));

// ─── Assets (uploaded images in R2, SPEC ONE-444) ────────────────────────────

// Both handlers sit inside adminRoutes, so authMiddleware already requires a
// session. Must stay above the strict admin 404 fallback below.
adminRoutes.post("/assets", uploadAsset);
adminRoutes.delete("/assets", deleteAsset);

// ─── System: database maintenance + setup page switch (SPEC §3.5) ────────────

/**
 * POST /api/admin/setup — session-authenticated (no setup secret) upgrade.
 * Payload and 409 conflict shape are identical to POST /api/setup.
 */
adminRoutes.post("/setup", async (c) => {
  const outcome = await runSetupMigrations(c.env);
  if (!outcome.ok) return c.json(outcome.body, outcome.status);
  return c.json(outcome.body);
});

/** GET /api/admin/system — effective prefix, page switch, recorded ledger. */
adminRoutes.get("/system", async (c) => {
  const prefix = getTablePrefix(c.env);
  const [ledger, setupPageEnabled] = await Promise.all([
    listRecordedMigrations(c.env.DB, prefix),
    getSetupPageEnabled(c.env, prefix),
  ]);
  return c.json({ tablePrefix: prefix, setupPageEnabled, ledger });
});

/** PUT /api/admin/system/setup-page — body `{enabled: boolean}` (strict). */
adminRoutes.put("/system/setup-page", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean")
    return badRequest("enabled must be a boolean");

  await setSetupPageEnabled(c.env, body.enabled);
  return c.json({ setupPageEnabled: body.enabled });
});

// Fallbacks kept intentionally strict: unknown admin routes are 404 JSON.
adminRoutes.all("*", (c) => c.json({ error: "not found" }, 404));
