import type {
  Category,
  Link,
  PublicCategoryDto,
  PublicLinkDto,
  SearchEngine,
  SearchEngineDto,
  SiteDataDto,
  SiteSettingsDto,
} from "../types";

/**
 * Visibility takes the stricter of the two: a public link inside a private
 * category is never delivered on the public surface (SPEC §2).
 */
export function toPublicLinkDto(link: Link): PublicLinkDto {
  return {
    id: link.id,
    categoryId: link.category_id,
    title: link.title,
    url: link.url,
    iconUrl: link.icon_url,
    description: link.description,
    sortOrder: link.sort_order,
  };
}

export function toSearchEngineDto(engine: SearchEngine): SearchEngineDto {
  return {
    id: engine.id,
    name: engine.name,
    urlTemplate: engine.url_template,
    icon: engine.icon,
    sortOrder: engine.sort_order,
    isDefault: engine.is_default === 1,
  };
}

export function toSiteSettingsDto(
  settings: Record<string, string>,
): SiteSettingsDto {
  const columns = Number.parseInt(settings.columns ?? "0", 10);
  return {
    siteTitle: settings.site_title ?? "nav",
    backgroundUrl: settings.background_url ?? "",
    logoUrl: settings.logo_url ?? "",
    theme: settings.theme ?? "system",
    columns: Number.isFinite(columns) && columns > 0 ? columns : 0,
  };
}

export function buildSiteData(
  categories: Category[],
  links: Link[],
  engines: SearchEngine[],
  settings: Record<string, string>,
  opts: { includePrivate: boolean },
): SiteDataDto {
  const linksByCategory = new Map<string, Link[]>();
  for (const link of links) {
    const bucket = linksByCategory.get(link.category_id) ?? [];
    bucket.push(link);
    linksByCategory.set(link.category_id, bucket);
  }

  const dtoCategories: PublicCategoryDto[] = [];
  for (const category of categories) {
    const categoryPrivate = category.visibility === "private";
    if (categoryPrivate && !opts.includePrivate) continue;

    const visibleLinks = (linksByCategory.get(category.id) ?? []).filter(
      (link) => {
        if (!opts.includePrivate) return link.visibility === "public";
        return true;
      },
    );

    dtoCategories.push({
      id: category.id,
      name: category.name,
      icon: category.icon,
      sortOrder: category.sort_order,
      links: visibleLinks.map(toPublicLinkDto),
    });
  }

  return {
    categories: dtoCategories,
    searchEngines: engines.map(toSearchEngineDto),
    settings: toSiteSettingsDto(settings),
  };
}
