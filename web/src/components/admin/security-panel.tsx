import {
  Copy,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ApiError,
  deleteCredentials,
  getTotpStatus,
  listCredentials,
  registerPasskey,
  totpDisable,
  totpEnable,
  totpSetup,
} from "@/lib/api";
import type { PasskeyCredential, TotpSetup, TotpStatus } from "@/lib/types";

/**
 * 后台「安全 / 两步验证」选项卡：TOTP 与 Passkey 两种第二因素的设置面。
 *
 * 端点全部复用后端既有实现（worker/src/routes/passkey.ts），前端不新增契约：
 *  - TOTP：GET /totp 读状态 → POST /totp/setup 取 secret + otpauth URI →
 *    展示二维码/密钥 → POST /totp/enable 验证码确认；停用 POST /totp/disable
 *    必须再输一次账号密码（后端 403 校验）。
 *  - Passkey：POST register/options → navigator.credentials.create →
 *    POST register/verify；GET /credentials 列表；DELETE /credentials 清除。
 *
 * 敏感值纪律：secret 只活在本组件的内存状态里（不写 localStorage、不进日志、
 * 不进 console），设置流程结束或取消即丢弃；otpauth URI 只喂给二维码，不上屏。
 */

/** 把接口失败翻成可读文案；401 统一按会话失效处理（与后台其他区一致）。 */
function describeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "会话已失效，请重新登录。";
    return e.detail ?? e.message ?? fallback;
  }
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError" || e.name === "AbortError") {
      return "操作已取消，或该设备/浏览器不支持 Passkey。";
    }
    if (e.name === "SecurityError") {
      return "当前页面不是安全上下文（需 HTTPS 或 localhost），无法使用 Passkey。";
    }
  }
  if (e instanceof Error && e.message === "passkey cancelled") {
    return "操作已取消。";
  }
  return fallback;
}

function formatTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString("zh-CN", { hour12: false });
}

export function SecurityPanel() {
  const [totp, setTotp] = React.useState<TotpStatus | null>(null);
  const [totpError, setTotpError] = React.useState<string | null>(null);
  /** 只在设置流程里存在的待确认密钥（取消/确认成功即丢弃） */
  const [setup, setSetup] = React.useState<TotpSetup | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState<
    "totp-load" | "totp-setup" | "totp-enable" | "totp-disable" | null
  >(null);

  const [credentials, setCredentials] = React.useState<
    PasskeyCredential[] | null
  >(null);
  const [credError, setCredError] = React.useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = React.useState<
    "register" | "delete" | null
  >(null);

  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableError, setDisableError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const loadTotp = React.useCallback(async () => {
    setBusy("totp-load");
    try {
      setTotp(await getTotpStatus());
      setTotpError(null);
    } catch (e) {
      setTotpError(describeError(e, "读取两步验证状态失败，请稍后重试。"));
    } finally {
      setBusy(null);
    }
  }, []);

  const loadCredentials = React.useCallback(async () => {
    try {
      setCredentials(await listCredentials());
      setCredError(null);
    } catch (e) {
      setCredError(describeError(e, "读取 Passkey 凭据失败，请稍后重试。"));
    }
  }, []);

  React.useEffect(() => {
    void loadTotp();
    void loadCredentials();
  }, [loadTotp, loadCredentials]);

  // ─── TOTP ──────────────────────────────────────────────────────────────────

  const startTotp = async () => {
    setBusy("totp-setup");
    setTotpError(null);
    try {
      setSetup(await totpSetup());
      setCode("");
    } catch (e) {
      setTotpError(describeError(e, "生成密钥失败，请稍后重试。"));
    } finally {
      setBusy(null);
    }
  };

  const cancelTotp = () => {
    // 丢弃待确认密钥；后端 challenge 10 分钟内自然过期
    setSetup(null);
    setCode("");
  };

  const confirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("totp-enable");
    setTotpError(null);
    try {
      await totpEnable(code.trim());
      setSetup(null);
      setCode("");
      toast.success("两步验证已启用，下次登录需要输入验证码");
      await loadTotp();
    } catch (err) {
      setTotpError(describeError(err, "验证码不正确，请重试。"));
    } finally {
      setBusy(null);
    }
  };

  const disableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("totp-disable");
    setDisableError(null);
    try {
      await totpDisable(password);
      setDisableOpen(false);
      setPassword("");
      toast.success("两步验证已停用");
      await loadTotp();
    } catch (err) {
      // 后端密码不对回 403：错误就地显示在确认框里（面板上的 Alert 会被弹窗遮住）
      setDisableError(
        err instanceof ApiError && err.status === 403
          ? "密码不正确，请重新输入。"
          : describeError(err, "停用失败，请稍后重试。"),
      );
    } finally {
      setBusy(null);
    }
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("密钥已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择密钥文本复制");
    }
  };

  // ─── Passkey ───────────────────────────────────────────────────────────────

  const addPasskey = async () => {
    setPasskeyBusy("register");
    setCredError(null);
    try {
      await registerPasskey();
      toast.success("Passkey 已注册，可用它登录");
      await loadCredentials();
    } catch (e) {
      setCredError(describeError(e, "注册 Passkey 失败，请稍后重试。"));
    } finally {
      setPasskeyBusy(null);
    }
  };

  const removeAllPasskeys = async () => {
    setPasskeyBusy("delete");
    setCredError(null);
    try {
      await deleteCredentials();
      setConfirmOpen(false);
      toast.success("已清除全部 Passkey");
      await loadCredentials();
    } catch (e) {
      setCredError(describeError(e, "清除 Passkey 失败，请稍后重试。"));
    } finally {
      setPasskeyBusy(null);
    }
  };

  const webAuthnSupported =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-1">
        <h2 className="font-heading text-lg font-semibold">安全 / 两步验证</h2>
        <p className="text-sm text-muted-foreground">
          单人站点：这两步验证只保护你自己的账号，不影响访客看到的公开页。
        </p>
      </div>

      {/* ─── TOTP ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4" aria-hidden="true" />
            身份验证器（TOTP）
          </CardTitle>
          <CardDescription>
            用 Google Authenticator、1Password、Authy 等应用生成 6
            位验证码；开启后密码登录需再输一次验证码。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {totpError && (
            <Alert variant="destructive">
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription className="break-words">
                {totpError}
              </AlertDescription>
            </Alert>
          )}

          {!totp ? (
            totpError ? null : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                正在读取两步验证状态…
              </p>
            )
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">状态</span>
                {totp.enabled ? (
                  <Badge>
                    <ShieldCheck className="size-3" aria-hidden="true" />
                    已启用
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <ShieldOff className="size-3" aria-hidden="true" />
                    未启用
                  </Badge>
                )}
              </div>

              {totp.enabled ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPassword("");
                    setDisableError(null);
                    setDisableOpen(true);
                  }}
                >
                  停用两步验证
                </Button>
              ) : (
                <Button
                  onClick={() => void startTotp()}
                  disabled={busy !== null || setup !== null}
                >
                  {busy === "totp-setup" && (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  启用两步验证
                </Button>
              )}
            </div>
          )}

          {setup && (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
                <div className="w-fit rounded-lg bg-white p-3 ring-1 ring-foreground/10">
                  {/* 二维码由 qrcode.react 生成（内联 SVG），不手搓编码 */}
                  <QRCodeSVG
                    value={setup.uri}
                    size={168}
                    level="M"
                    marginSize={2}
                    title="两步验证二维码"
                  />
                </div>

                <form onSubmit={confirmTotp} className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    用验证器 App
                    扫描二维码；无法扫码时，手动录入下面的密钥（类型：基于时间）。
                  </p>

                  <div className="grid gap-2">
                    <Label htmlFor="totp-secret">手动录入密钥</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="totp-secret"
                        readOnly
                        value={setup.secret}
                        className="font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="复制密钥"
                        onClick={() => void copySecret(setup.secret)}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      密钥等同密码，请勿截图外发；完成设置后本页不再显示。
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="totp-code">验证器当前 6 位验证码</Label>
                    <Input
                      id="totp-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 位数字"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy !== null}>
                      {busy === "totp-enable" && (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      验证并启用
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelTotp}
                      disabled={busy !== null}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Passkey ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            Passkey 凭据
          </CardTitle>
          <CardDescription>
            用设备自带的指纹 / 面容 /
            安全密钥免密登录。登录页「Passkey」页签使用这里的凭据。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {credError && (
            <Alert variant="destructive">
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription className="break-words">
                {credError}
              </AlertDescription>
            </Alert>
          )}

          {!credentials ? (
            credError ? null : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                正在读取 Passkey 凭据…
              </p>
            )
          ) : credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有注册任何 Passkey。
            </p>
          ) : (
            <ul className="grid gap-2">
              {credentials.map((cred, index) => (
                <li
                  key={cred.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">
                      Passkey #{index + 1}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {cred.id.slice(0, 12)}…（已使用 {cred.counter} 次）
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    创建于 {formatTime(cred.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void addPasskey()}
              disabled={passkeyBusy !== null || !webAuthnSupported}
            >
              {passkeyBusy === "register" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4" aria-hidden="true" />
              )}
              注册新 Passkey
            </Button>

            <Button
              variant="destructive"
              onClick={() => {
                setCredError(null);
                setConfirmOpen(true);
              }}
              disabled={
                passkeyBusy !== null || !credentials || credentials.length === 0
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              移除全部 Passkey
            </Button>

            <span className="text-sm text-muted-foreground">
              {webAuthnSupported
                ? "注册时会调用系统弹窗，需 HTTPS 或 localhost。"
                : "当前浏览器不支持 WebAuthn，无法注册 Passkey。"}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            移除后这些设备不能再用于登录；密码（及已启用的 TOTP）不受影响。
          </p>
        </CardContent>
      </Card>

      {/* 停用 TOTP：二次确认 + 密码校验（后端 /totp/disable 要求密码） */}
      <Dialog
        open={disableOpen}
        onOpenChange={(open) => {
          setDisableOpen(open);
          if (!open) {
            setPassword("");
            setDisableError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">停用两步验证</DialogTitle>
            <DialogDescription>
              停用后密码登录不再需要验证码。请输入当前账号密码确认。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={disableTotp} className="grid gap-4">
            {disableError && (
              <Alert variant="destructive">
                <AlertTitle>停用未完成</AlertTitle>
                <AlertDescription>{disableError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="totp-disable-password">账号密码</Label>
              <Input
                id="totp-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisableOpen(false)}
                disabled={busy !== null}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy !== null || password.length === 0}
              >
                {busy === "totp-disable" && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                确认停用
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 移除全部 Passkey：破坏性操作走 AlertDialog（不可撤销） */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除全部 Passkey？</AlertDialogTitle>
            <AlertDialogDescription>
              将清除当前账号下的 {credentials?.length ?? 0} 个 Passkey
              凭据（后端 DELETE /credentials
              的实现为整账号清除，不支持单条删除）。清除后这些设备不能再用于登录，且无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={passkeyBusy !== null} />
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              disabled={passkeyBusy !== null}
              onClick={(e) => {
                e.preventDefault();
                void removeAllPasskeys();
              }}
            >
              {passkeyBusy === "delete" && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              移除全部 Passkey
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
