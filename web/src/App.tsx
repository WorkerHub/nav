import * as React from "react";
import { Toaster } from "@/components/ui/sonner";
import { AdminPage } from "@/components/admin/admin-page";
import { PublicPage } from "@/components/public-page";
import { SetupPage } from "@/components/setup/setup-page";
import { useNavStore } from "@/lib/nav-store";

/**
 * 应用路由：/ 公开页，登录以 /api/private 401 触发的弹窗承载（不整页跳转），
 * /setup 数据库初始化/升级页，/#admin 后台（登录后可用）。
 *
 * pathname 优先（/setup 是独立页面，后端 SPA 回退已落到 index.html），
 * 其余保持原有的 #admin 哈希路由。
 */
type Route = "public" | "admin" | "setup";

function readRoute(): Route {
  if (window.location.pathname.replace(/\/+$/, "") === "/setup") return "setup";
  return window.location.hash === "#admin" ? "admin" : "public";
}

export default function App() {
  const [route, setRoute] = React.useState<Route>(() => readRoute());
  const { authenticated, loginPromptOpen, setLoginPrompt } = useNavStore();

  React.useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // 站内跳转（不整页刷新）：写历史再同步路由状态
  const navigate = React.useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setRoute(readRoute());
  }, []);

  // 未登录访问 #admin → 弹登录
  React.useEffect(() => {
    if (route === "admin" && !authenticated && !loginPromptOpen) {
      setLoginPrompt(true);
    }
  }, [route, authenticated, loginPromptOpen, setLoginPrompt]);

  return (
    <>
      {route === "setup" ? (
        <SetupPage
          onGoHome={() => navigate("/")}
          onGoAdmin={() => navigate("/#admin")}
        />
      ) : route === "admin" && authenticated ? (
        <AdminPage onBack={() => navigate("/")} />
      ) : (
        <PublicPage onOpenAdmin={() => navigate("/#admin")} />
      )}
      <Toaster />
    </>
  );
}
