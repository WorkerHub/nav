import { create } from "zustand";
import { useNavStore } from "@/lib/nav-store";
import type { SiteSettings } from "@/lib/types";

/**
 * 主题（站点设置 `settings.theme`，三档 system / light / dark）。
 *
 * 唯一真源是站点数据里的 `settings.theme`（后端 settings 表，经 /api/public、
 * /api/private、/api/admin/settings 下发）。前端不写也不读 localStorage —— 主题
 * 是站点级设置，不是按访客保存的偏好，这里刻意不引入第二个真源。
 *
 * `system` 档只用 `matchMedia('(prefers-color-scheme: dark)')` 在内存里解析成
 * 当前的深/浅色，并监听系统外观变化实时跟随；解析结果不落盘。
 */
export type ThemeMode = SiteSettings["theme"];
export type ResolvedTheme = "light" | "dark";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** 当前系统外观（无 matchMedia 的环境按浅色处理） */
export function readSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/** 三档 → 实际生效的深浅色 */
export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** 站点数据里的主题档位；null = 站点数据尚未加载（此时不猜深浅色）。 */
export function useSiteThemeMode(): ThemeMode | null {
  return useNavStore(
    (s) => s.adminData?.settings.theme ?? s.publicData?.settings.theme ?? null,
  );
}

/**
 * 系统外观状态（系统事实，不是站点设置）。
 * 由 ThemeProvider 订阅 matchMedia 写入，供 Toaster 等需要显式深浅色的组件读取。
 */
interface ThemeState {
  systemDark: boolean;
  setSystemDark: (systemDark: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  systemDark: readSystemDark(),
  setSystemDark: (systemDark) =>
    set((s) => (s.systemDark === systemDark ? s : { systemDark })),
}));

/** 生效中的实际主题；null 表示站点数据未加载（不要当 light 兜底渲染）。 */
export function useResolvedTheme(): ResolvedTheme | null {
  const mode = useSiteThemeMode();
  const systemDark = useThemeStore((s) => s.systemDark);
  return mode ? resolveTheme(mode, systemDark) : null;
}
