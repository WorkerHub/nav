import * as React from "react";
import { Loader2 } from "lucide-react";
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

/** 探活未回时的占位（ONE-445：这期间既不能弹登录框，也不能显示「未登录」）。 */
function AuthPending() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass flex items-center gap-3 rounded-xl px-5 py-4 text-sm text-white/90">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        正在确认登录状态…
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = React.useState<Route>(() => readRoute());
  const authStatus = useNavStore((s) => s.authStatus);
  const loginPromptOpen = useNavStore((s) => s.loginPromptOpen);
  const setLoginPrompt = useNavStore((s) => s.setLoginPrompt);
  const bootstrapSession = useNavStore((s) => s.bootstrapSession);

  // 刷新后先探活（GET /api/auth/session）：会话有效即恢复登录，失效回落未登录
  React.useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

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

  // 未登录访问 #admin → 弹登录（探活结束、确认 anonymous 后才弹，pending 期间不弹）
  React.useEffect(() => {
    if (route === "admin" && authStatus === "anonymous" && !loginPromptOpen) {
      setLoginPrompt(true);
    }
  }, [route, authStatus, loginPromptOpen, setLoginPrompt]);

  return (
    <>
      {route === "setup" ? (
        <SetupPage
          onGoHome={() => navigate("/")}
          onGoAdmin={() => navigate("/#admin")}
        />
      ) : route === "admin" && authStatus === "pending" ? (
        // 探活期间：#admin 显示加载态，不闪未登录、不弹登录框
        <AuthPending />
      ) : route === "admin" && authStatus === "authenticated" ? (
        <AdminPage onBack={() => navigate("/")} />
      ) : (
        <PublicPage onOpenAdmin={() => navigate("/#admin")} />
      )}
      <Toaster />
    </>
  );
}
