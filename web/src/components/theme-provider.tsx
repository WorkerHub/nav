import * as React from "react";
import {
  DARK_MEDIA_QUERY,
  resolveTheme,
  useSiteThemeMode,
  useThemeStore,
} from "@/lib/theme";

/**
 * 主题 Provider（ONE-448）：把站点设置里的 `settings.theme` 落到 `<html>` 上。
 *
 * - 真源只有一个：站点数据里的 settings.theme（公开页 /api/public、登录后
 *   /api/private、后台 /api/admin/settings）。公开页与管理面走同一个 Provider，
 *   因此两侧表现一致；后台保存设置后 store 里的 adminData 立即刷新，优先取它，
 *   避免沿用旧的 publicData。
 * - system 档订阅 matchMedia：系统深浅色一变即时跟随，无需刷新页面。
 * - 生效方式是 documentElement 的 `.dark` 类（web/src/index.css 的 dark 变体）
 *   加 `color-scheme`（让滚动条 / 原生控件跟着变）。
 * - 用 useLayoutEffect 在绘制前完成切换，避免「先亮后暗」的闪烁；站点数据
 *   未加载时什么都不改，不拿 light/dark 去猜。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSiteThemeMode();
  const systemDark = useThemeStore((s) => s.systemDark);
  const setSystemDark = useThemeStore((s) => s.setSystemDark);

  // system 档实时跟随系统外观（含用户在系统设置里切换、跨设备同步）
  React.useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setSystemDark]);

  const resolved = mode ? resolveTheme(mode, systemDark) : null;

  React.useLayoutEffect(() => {
    if (!resolved) return;
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  return <>{children}</>;
}
