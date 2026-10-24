import * as React from "react";
import { KeyRound, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavStore } from "@/lib/nav-store";

/**
 * 登录弹窗：密码 + TOTP（两步流）与 Passkey 两种方式。
 * 后端 /api/auth/login 返回 requires2fa 时才进入 TOTP 第二步；
 * /api/private 返回 401 JSON 时由 store 置 loginPromptOpen 弹出（不整页跳转）。
 */
export function LoginDialog() {
  const {
    loginPromptOpen,
    setLoginPrompt,
    loginWithPassword,
    verifyTotp,
    loginWithPasskey,
  } = useNavStore();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [tempToken, setTempToken] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<
    "password" | "totp" | "passkey" | null
  >(null);

  const reset = () => {
    setPassword("");
    setTotp("");
    setTempToken(null);
    setBusy(null);
  };

  const onOpenChange = (open: boolean) => {
    setLoginPrompt(open);
    if (!open) reset();
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("password");
    try {
      const result = await loginWithPassword(username, password);
      if ("requires2fa" in result) {
        setTempToken(result.tempToken);
        toast.info("已启用二次验证，请输入 TOTP 验证码");
      } else {
        toast.success("已登录");
      }
    } catch {
      toast.error("登录失败：用户名或密码不正确");
    } finally {
      setBusy(null);
    }
  };

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setBusy("totp");
    try {
      await verifyTotp(tempToken, totp);
      reset();
      toast.success("已登录");
    } catch {
      toast.error("验证码不正确");
    } finally {
      setBusy(null);
    }
  };

  const submitPasskey = async () => {
    setBusy("passkey");
    try {
      await loginWithPasskey();
      toast.success("已登录");
    } catch {
      toast.error("Passkey 登录失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={loginPromptOpen} onOpenChange={onOpenChange}>
      <DialogContent className="glass sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">登录</DialogTitle>
          <DialogDescription>
            登录后可查看私有链接并进入后台管理。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="password" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">密码登录</TabsTrigger>
            <TabsTrigger value="passkey">Passkey</TabsTrigger>
          </TabsList>

          <TabsContent value="password" className="mt-4">
            {tempToken ? (
              // 第二步：TOTP（仅后端 requires2fa 后出现）
              <form onSubmit={submitTotp} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="login-totp">TOTP 验证码</Label>
                  <Input
                    id="login-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 位数字"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busy !== null}
                  className="w-full"
                >
                  {busy === "totp" ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <LogIn className="size-4" aria-hidden="true" />
                  )}
                  验证并登录
                </Button>
              </form>
            ) : (
              // 第一步：username + password
              <form onSubmit={submitPassword} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="login-username">用户名</Label>
                  <Input
                    id="login-username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busy !== null}
                  className="w-full"
                >
                  {busy === "password" ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <LogIn className="size-4" aria-hidden="true" />
                  )}
                  登录
                </Button>
              </form>
            )}
          </TabsContent>

          <TabsContent value="passkey" className="mt-4">
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                使用设备上的 Passkey（指纹 / 面容 / 安全密钥）登录。
              </p>
              <Button
                onClick={submitPasskey}
                disabled={busy !== null}
                className="w-full"
              >
                {busy === "passkey" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="size-4" aria-hidden="true" />
                )}
                使用 Passkey 登录
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
