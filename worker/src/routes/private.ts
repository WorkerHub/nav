import { Hono } from "hono";
import { getTablePrefix, type HonoEnv, type SiteDataDto } from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  listCategories,
  listLinks,
  listSearchEngines,
} from "../db/queries/content";
import { getAllSettings } from "../db/queries/settings";
import { buildSiteData } from "../services/site-data";
import { ensureSchema } from "../lib/migrate";

export const privateRoutes = new Hono<HonoEnv>();

// 401 JSON for any unauthenticated request to /api/private/* (contract ONE-168).
privateRoutes.use("*", authMiddleware);

/**
 * GET /api/private — full site data (public + private). Requires a valid
 * session; responses must never be cached (contract ONE-168).
 */
privateRoutes.get("/", async (c) => {
  const prefix = getTablePrefix(c.env);
  await ensureSchema(c.env);
  const [categories, links, engines, settings] = await Promise.all([
    listCategories(c.env.DB, prefix),
    listLinks(c.env.DB, prefix),
    listSearchEngines(c.env.DB, prefix),
    getAllSettings(c.env.DB, prefix),
  ]);

  const data: SiteDataDto = buildSiteData(
    categories,
    links,
    engines,
    settings,
    {
      includePrivate: true,
    },
  );

  c.header("cache-control", "no-store");
  return c.json(data);
});

privateRoutes.all("*", (c) => {
  c.header("cache-control", "no-store");
  return c.json({ error: "not found" }, 404);
});
