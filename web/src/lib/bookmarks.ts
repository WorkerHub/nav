/**
 * 导入导出（前端解析与生成，SPEC v1.0 §7）：
 *  - 浏览器书签 HTML 导入（Netscape Bookmark File 格式：DL/DT/H3/A）
 *  - JSON 导入 / 导出（与 NavExport 结构一致，导出可再导入还原）
 */
import type {
  AdminCategory,
  AdminLink,
  ImportCategory,
  ImportLink,
  NavExport,
  SearchEngine,
  SiteSettings,
} from "./types";

export interface ImportResult {
  categories: ImportCategory[];
  totalLinks: number;
}

/**
 * 解析浏览器书签 HTML → 分类 + 链接（分类数量与链接数量与源文件一致）。
 * 批量写入前排重：同一 URL 或同一标题（同名）只保留首次出现，避免重复导入。
 */
export function parseBookmarksHtml(html: string): ImportResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const categories: ImportCategory[] = [];
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();

  const root = doc.querySelector("body > dl") ?? doc.body;
  const loose: ImportLink[] = [];

  const makeLink = (a: HTMLAnchorElement): ImportLink | null => {
    const title = a.textContent?.trim() || a.href;
    const url = a.href;
    const keyUrl = url.trim().toLowerCase();
    const keyTitle = title.trim().toLowerCase();
    // 同名 / 同 URL 排重
    if (seenUrl.has(keyUrl)) return null;
    if (keyTitle && seenTitle.has(keyTitle)) return null;
    seenUrl.add(keyUrl);
    if (keyTitle) seenTitle.add(keyTitle);
    return {
      title,
      url,
      iconUrl: a.getAttribute("icon") || a.getAttribute("icon_url") || null,
      description: null,
      visibility: "public",
    };
  };

  root.querySelectorAll("h3").forEach((h3, index) => {
    const dl = h3.nextElementSibling;
    const category: ImportCategory = {
      name: h3.textContent?.trim() || `分类 ${index + 1}`,
      visibility: "public",
      links: [],
    };
    if (dl && dl.tagName === "DL") {
      dl.querySelectorAll("a").forEach((a) => {
        const link = makeLink(a as HTMLAnchorElement);
        if (link) category.links.push(link);
      });
    }
    categories.push(category);
  });

  // 书签栏等根级散落链接
  root.querySelectorAll(":scope > dt > a").forEach((a) => {
    const link = makeLink(a as HTMLAnchorElement);
    if (link) loose.push(link);
  });

  if (loose.length > 0) {
    categories.push({ name: "未分类", visibility: "public", links: loose });
  }

  return {
    categories,
    totalLinks: categories.reduce((n, c) => n + c.links.length, 0),
  };
}

/** 从后台扁平数据组装导出结构（分类内嵌链接） */
export function buildExport(
  categories: AdminCategory[],
  links: AdminLink[],
  engines: SearchEngine[],
  settings: SiteSettings,
): NavExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: categories.map((c) => ({
      name: c.name,
      icon: c.icon,
      visibility: c.visibility,
      links: links
        .filter((l) => l.categoryId === c.id)
        .map((l) => ({
          title: l.title,
          url: l.url,
          iconUrl: l.iconUrl,
          description: l.description,
          visibility: l.visibility,
        })),
    })),
    searchEngines: engines,
    settings,
  };
}

/** JSON 导出（导出可再导入还原） */
export function exportJson(data: NavExport): string {
  return JSON.stringify(data, null, 2);
}

export function parseImportJson(text: string): NavExport {
  const data = JSON.parse(text) as NavExport;
  if (!Array.isArray(data.categories)) throw new Error("JSON 缺少 categories");
  return data;
}

export function download(
  filename: string,
  content: string,
  mime = "application/json",
) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
