import * as React from "react";
import { LogIn, LogOut, Settings } from "lucide-react";
import { FadeIn } from "@/components/glass";
import { CategoryAnchorBar, CategorySection } from "@/components/link-grid";
import { LoginDialog } from "@/components/login-dialog";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/components/ui/button";
import { useNavStore } from "@/lib/nav-store";

/**
 * 公开页（/）：背景图 + 毛玻璃搜索框 + 锚点栏 + 「我的导航」图标网格 + 登录后的私有区。
 *
 * 安全口径：未登录时私有区完全不渲染 —— privateData 未加载时组件树里没有私有区块，
 * 数据请求也只发 /api/public（未登录不请求 /api/private）。
 */
export function PublicPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const {
    publicData,
    privateData,
    authenticated,
    loadPublic,
    loadPrivate,
    logout,
    setLoginPrompt,
  } = useNavStore();

  React.useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  // 登录后才拉取私有区（未登录不请求 /api/private，401 时 store 内部处理弹登录）
  React.useEffect(() => {
    if (authenticated) void loadPrivate();
  }, [authenticated, loadPrivate]);

  // 契约：/api/private 返回与 /api/public 同结构的全量数据（公开+私有）。
  // 登录后直接以 privateData.categories 作为全量列表，不再拼接 public/private。
  const siteData = authenticated ? privateData : publicData;
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
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `linear-gradient(rgba(15,23,42,0.55), rgba(15,23,42,0.35)), url(${JSON.stringify(
            settings?.backgroundUrl ?? "",
          )})`,
          backgroundColor: "#0f172a",
        }}
      />

      {/* 顶部锚点栏 */}
      <header className="sticky top-0 z-20 px-4 py-3 sm:px-8">
        <FadeIn className="mx-auto flex max-w-7xl items-center gap-3">
          <CategoryAnchorBar categories={categories} />
          <div className="ml-auto flex items-center gap-2">
            {authenticated ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="glass gap-1.5 text-white/90 hover:text-white"
                  onClick={onOpenAdmin}
                >
                  <Settings className="size-4" aria-hidden="true" />
                  后台
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="glass gap-1.5 text-white/90 hover:text-white"
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
                className="glass gap-1.5 text-white/80 hover:text-white"
                onClick={() => setLoginPrompt(true)}
              >
                <LogIn className="size-4" aria-hidden="true" />
                登录
              </Button>
            )}
          </div>
        </FadeIn>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-20 sm:px-8">
        {/* 搜索区 */}
        <FadeIn className="pt-8 sm:pt-16">
          <h1 className="mb-6 text-center font-heading text-4xl font-semibold text-white drop-shadow">
            {settings?.siteTitle ?? "我的导航"}
          </h1>
          {siteData && <SearchBar engines={siteData.searchEngines} />}
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
