/** 图标策略（design-system/nav/MASTER.md §1.4）：真实 favicon 优先，失败回退按域名哈希着色的首字圆。 */

/** favicon 优先级：手动 icon_url > Google s2 服务 > 目标站 /favicon.ico（由 <SiteIcon> 依次回退） */
export function faviconCandidates(
  url: string,
  iconUrl?: string | null,
): string[] {
  const out: string[] = [];
  if (iconUrl) out.push(iconUrl);
  try {
    const host = new URL(url).hostname;
    out.push(`https://www.google.com/s2/favicons?domain=${host}&sz=64`);
    out.push(`https://${host}/favicon.ico`);
  } catch {
    /* malformed url → 首字圆 */
  }
  return out;
}

/** 8 色安全调色板（MASTER.md §3.3，均可承载白字） */
export const INITIAL_PALETTE = [
  "#2563EB",
  "#7C3AED",
  "#0891B2",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#475569",
];

/** 域名哈希 → 调色板索引 */
export function hashColor(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return INITIAL_PALETTE[h % INITIAL_PALETTE.length];
}

/** 首字：域名或标题首字符 */
export function initialOf(title: string, url: string): string {
  const source = title.trim() || safeHost(url);
  return source.slice(0, 1).toUpperCase() || "?";
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
