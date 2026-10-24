import * as React from "react";
import { Toaster } from "@/components/ui/sonner";
import { AdminPage } from "@/components/admin/admin-page";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";

/**
 * 应用路由：/ 公开页，登录以 /api/private 401 触发的弹窗承载（不整页跳转），
 * #admin 后台（登录后可用）。
 */
export default function App() {
  const [route, setRoute] = React.useState<"public" | "admin">("public");
  const { authenticated, loginPromptOpen, setLoginPrompt } = useNavStore();

  React.useEffect(() => {
    const onPop = () =>
      setRoute(window.location.hash === "#admin" ? "admin" : "public");
    window.addEventListener("hashchange", onPop);
    onPop();
    return () => window.removeEventListener("hashchange", onPop);
  }, []);

  // 未登录访问 #admin → 弹登录
  React.useEffect(() => {
    if (route === "admin" && !authenticated && !loginPromptOpen) {
      setLoginPrompt(true);
    }
  }, [route, authenticated, loginPromptOpen, setLoginPrompt]);

  return (
    <>
      {route === "admin" && authenticated ? (
        <AdminPage
          onBack={() => {
            window.location.hash = "";
            setRoute("public");
          }}
        />
      ) : (
        <PublicPage
          onOpenAdmin={() => {
            window.location.hash = "#admin";
            setRoute("admin");
          }}
        />
      )}
      <Toaster />
    </>
  );
}
