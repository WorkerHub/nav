import {
  ArrowDownUp,
  ArrowLeft,
  FolderTree,
  Link,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import { SecurityPanel } from "@/components/admin/security-panel";
import {
  ImportExportPanel,
  SearchEnginePanel,
  SettingsPanel,
} from "@/components/admin/settings-panels";
import { SystemPanel } from "@/components/admin/system-panel";
import { PageBackground } from "@/components/page-background";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavStore } from "@/lib/nav-store";

/**
 * 后台（/admin）：分类 / 链接 / 搜索引擎 / 站点设置 CRUD + 导入导出 + 安全（两步验证）
 * + 系统管理，列表用 dnd-kit 拖拽排序（含上移/下移键盘替代）。
 *
 * 外壳与前台同一设计语言：玻璃顶栏 + 壁纸背景 + 左侧玻璃竖排菜单 + 玻璃内容卡。
 * 后台数据由 store（useNavStore.adminData）承载，本页只负责加载与分发；
 * 安全区的数据（2FA 状态、Passkey 凭据）属会话期敏感数据，由 SecurityPanel 自行拉取，
 * 不进全局 store。
 */
export function AdminPage({ onBack }: { onBack: () => void }) {
  const adminData = useNavStore((s) => s.adminData);
  const loadAdmin = useNavStore((s) => s.loadAdmin);
  const logout = useNavStore((s) => s.logout);
  const isDesktop = useIsDesktop();

  React.useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  const categories = adminData?.categories ?? [];
  const links = adminData?.links ?? [];
  const engines = adminData?.searchEngines ?? [];
  const settings = adminData?.settings;

  return (
    <div className="relative min-h-screen">
      <PageBackground settings={settings} />

      {/* 顶栏：整条毛玻璃，与前台同款（站点标题/Logo + 返回首页 + 主题 + 退出登录） */}
      <header className="glass-bar sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-8">
          <h1 className="flex min-w-0 items-center font-heading text-lg font-semibold text-foreground sm:text-xl">
            {settings?.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.siteTitle || "站点 Logo"}
                className="h-8 w-auto max-w-[200px] object-contain"
              />
            ) : (
              <span className="min-w-0 truncate">
                {settings?.siteTitle ?? "我的导航"}
              </span>
            )}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="glass gap-1.5 text-foreground hover:text-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              返回首页
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="glass gap-1.5 text-foreground hover:text-foreground"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" aria-hidden="true" />
              退出登录
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
        {settings ? (
          <Tabs
            defaultValue="categories"
            orientation={isDesktop ? "vertical" : "horizontal"}
            className="w-full gap-6"
          >
            {/* 左栏竖排菜单（宽屏）/ 顶部横向滚动菜单条（窄屏），同一 TabsList */}
            <TabsList
              variant="line"
              className={
                isDesktop
                  ? "glass h-fit w-[230px] flex-col items-stretch gap-1 self-start rounded-2xl p-2"
                  : "glass h-auto w-full items-stretch gap-1 overflow-x-auto rounded-2xl p-2"
              }
            >
              {MENU_ITEMS.map(({ value, label, Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="admin-menu-trigger flex-1 justify-start gap-2 rounded-xl px-3 py-2"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="categories">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <CategoryPanel
                  categories={categories}
                  onChanged={() => void loadAdmin()}
                />
              </div>
            </TabsContent>

            <TabsContent value="links">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <LinkPanel
                  categories={categories}
                  links={links}
                  onChanged={() => void loadAdmin()}
                />
              </div>
            </TabsContent>

            <TabsContent value="engines">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <SearchEnginePanel
                  engines={engines}
                  onChanged={() => void loadAdmin()}
                />
              </div>
            </TabsContent>

            <TabsContent value="settings">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <SettingsPanel
                  settings={settings}
                  onChanged={() => void loadAdmin()}
                />
              </div>
            </TabsContent>

            <TabsContent value="io">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <ImportExportPanel
                  categories={categories}
                  links={links}
                  engines={engines}
                  settings={settings}
                  onChanged={() => void loadAdmin()}
                />
              </div>
            </TabsContent>

            <TabsContent value="security">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <SecurityPanel />
              </div>
            </TabsContent>

            <TabsContent value="system">
              <div className="glass max-w-2xl rounded-2xl p-6">
                <SystemPanel />
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">加载中…</p>
        )}
      </main>
    </div>
  );
}

/** 后台菜单七项（现 Tabs 菜单整体搬入左栏，竖排 + 图标）。 */
const MENU_ITEMS = [
  { value: "categories", label: "分类", Icon: FolderTree },
  { value: "links", label: "链接", Icon: Link },
  { value: "engines", label: "搜索引擎", Icon: Search },
  { value: "settings", label: "站点设置", Icon: Settings },
  { value: "io", label: "导入导出", Icon: ArrowDownUp },
  { value: "security", label: "安全 / 两步验证", Icon: ShieldCheck },
  { value: "system", label: "系统管理", Icon: Wrench },
] as const;

/**
 * 宽屏（≥1024px）→ 左栏竖排菜单；窄屏 → 内容区顶部横向可滚动菜单条。
 * 仅用于翻转 Radix Tabs 的 orientation 与 TabsList 呈现，不手写 tab 状态机。
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : true,
  );
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}
