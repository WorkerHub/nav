import { Hono } from "hono";
import { getTablePrefix, type HonoEnv, type SiteDataDto } from "../types";
import {
  listCategories,
  listLinks,
  listSearchEngines,
} from "../db/queries/content";
import { getAllSettings } from "../db/queries/settings";
import { buildSiteData } from "../services/site-data";
import { ensureSchema } from "../lib/migrate";

export const publicRoutes = new Hono<HonoEnv>();

/**
 * GET /api/public — public categories + public links, search engines, site
 * settings. Private rows are never fetched into this payload, so a private
 * category/link cannot leak here (SPEC §2). Publicly cacheable.
 */
publicRoutes.get("/", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const [categories, links, engines, settings] = await Promise.all([
    listCategories(c.env.DB, prefix),
    listLinks(c.env.DB, prefix),
    listSearchEngines(c.env.DB, prefix),
    getAllSettings(c.env.DB, prefix),
  ]);

  // Visibility = stricter of category and link: drop public links that live in
  // a private category before assembling the DTO (SPEC §2).
  const privateCategoryIds = new Set(
    categories
      .filter((cat) => cat.visibility === "private")
      .map((cat) => cat.id),
  );
  const publicLinks = links.filter(
    (link) =>
      link.visibility === "public" && !privateCategoryIds.has(link.category_id),
  );

  const data: SiteDataDto = buildSiteData(
    categories.filter((cat) => cat.visibility === "public"),
    publicLinks,
    engines,
    settings,
    { includePrivate: false },
  );

  c.header("cache-control", "public, max-age=60");
  return c.json(data);
});
