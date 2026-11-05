import * as React from "react";
import { LogIn, LogOut, Settings } from "lucide-react";
import { FadeIn } from "@/components/glass";
import { CategorySection } from "@/components/link-grid";
import { LoginDialog } from "@/components/login-dialog";
import { PageBackground } from "@/components/page-background";
import { SearchBar } from "@/components/search-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuthenticated, useNavStore } from "@/lib/nav-store";

/**
 * 公开页（/）：背景图 + 整条毛玻璃顶栏（站点标题/Logo + 登录态操作）+ 毛玻璃搜索框
 * + 「我的导航」图标网格 + 登录后的私有区。
 *
 * 安全口径：未登录时私有区完全不渲染 —— privateData 未加载时组件树里没有私有区块，
 * 数据请求也只发 /api/public（未登录不请求 /api/private）。
 *
 * 登录态是 store 里的三态（pending/authenticated/anonymous）：探活未回时登录区不渲染
 * 任何按钮（不闪「登录」），探活通过后由 store 恢复登录并拉取私有区。
 */
export function PublicPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const {
    publicData,
    privateData,
    authStatus,
    loadPublic,
    loadPrivate,
    logout,
    setLoginPrompt,
  } = useNavStore();
  const authenticated = useAuthenticated();

  React.useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  // 登录后才拉取私有区（未登录不请求 /api/private，401 时 store 内部处理弹登录）
  React.useEffect(() => {
    if (authenticated) void loadPrivate();
  }, [authenticated, loadPrivate]);

  // 契约：/api/private 返回与 /api/public 同结构的全量数据（公开+私有）。
  // 登录后直接以 privateData.categories 作为全量列表，不再拼接 public/private。
  // privateData 未回时先用 publicData 顶上，避免探活/登录后空白一帧。
  const siteData = (authenticated && privateData) || publicData;
  const settings = siteData?.settings;
  const categories = siteData?.categories ?? [];

  // 私有标识：/api/private 的分类 DTO 不含 visibility，用「全量里有、公开列表里没有」推导私有分类。
  const publicIds = new Set(publicData?.categories.map((c) => c.id) ?? []);
  const privateIds = new Set(
    categories.filter((c) => !publicIds.has(c.id)).map((c) => c.id),
  );

  return (
    <div className="relative min-h-screen">
      {/* 背景层：全屏背景图 + 阅读性罩层 */}
      <PageBackground settings={settings} />

      {/* 顶栏：整条毛玻璃，左侧站点标题/Logo，右侧后台、退出与主题切换 */}
      <header className="glass-bar sticky top-0 z-20">
        <FadeIn className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-8">
          {/*
            站点标题放在顶栏（h1 语义）：logoUrl 有值显示适配栏高的 Logo 图，否则显示站点标题文字。
            文字沿用顶栏 text-foreground 口径（与右侧按钮一致）：浅色档玻璃底近白、深色档近黑，两档对比度都成立。
          */}
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
            {/*
              顶栏按钮统一用前景色：浅色档的玻璃芯片是近白底，白字对比度只有 2.4:1。
              新增顶栏按钮请沿用 text-foreground（深色档它就是近白，两档都成立）。
            */}
            {authStatus === "pending" ? null : authenticated ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="glass gap-1.5 text-foreground hover:text-foreground"
                  onClick={onOpenAdmin}
                >
                  <Settings className="size-4" aria-hidden="true" />
                  后台
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="glass gap-1.5 text-foreground hover:text-foreground"
                  onClick={() => void logout()}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  退出
                </Button>
              </>
            ) : (
              // 低调登录入口
              <Button
                variant="ghost"
                size="sm"
                className="glass gap-1.5 text-foreground hover:text-foreground"
                onClick={() => setLoginPrompt(true)}
              >
                <LogIn className="size-4" aria-hidden="true" />
                登录
              </Button>
            )}
            {/*
              访客个人主题偏好：不受登录态影响（探活中/已登录/未登录都显示）。
              放在这一组的最右：登录/后台按钮出现或消失时，它不会跟着左右跳动。
            */}
            <ThemeToggle />
          </div>
        </FadeIn>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-20 sm:px-8">
        {/* 搜索区：站点标题已移入顶栏，这里只剩搜索框 */}
        <FadeIn className="pt-8 sm:pt-16">
          {siteData && (
            <SearchBar
              engines={siteData.searchEngines}
              openInNewTab={siteData.settings.searchNewTab ?? true}
            />
          )}
        </FadeIn>

        {/* 导航区：登录后为全量分类（公开+私有），私有分类带「私有」标识 */}
        <div className="flex flex-col gap-10">
          {categories.map((category, i) => (
            <FadeIn key={category.id} delay={Math.min(i * 0.05, 0.3)}>
              <CategorySection
                category={category}
                privateZone={privateIds.has(category.id)}
              />
            </FadeIn>
          ))}
        </div>
      </main>

      <LoginDialog />
    </div>
  );
}
