import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Database,
  KeyRound,
  Loader2,
  LogIn,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { LoginDialog } from "@/components/login-dialog";
import { MigrationResults } from "@/components/setup/migration-results";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ApiError,
  getSetupState,
  runOwnerSetup,
  runSetupUpgrade,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { SetupOwnerResult, SetupResult, SetupState } from "@/lib/types";

/**
 * /setup 页面（SETUP-PAGE-SPEC §4）。
 *
 * 形态状态机（先查 GET /api/setup/state）：
 *  loading → error / disabled（enabled===false）/ 未初始化（ownerExists===false）/ 已初始化。
 *
 * 安全口径：
 *  - disabled 形态 DOM 中不出现任何密钥输入框；
 *  - 密钥只走 X-Setup-Secret 请求头，提交后立刻清空 state 与输入框，不写
 *    localStorage / 日志 / URL；
 *  - 未初始化与已初始化是两个独立表单组件 + 不同 key，形态切换时 DOM 节点必换
 *    （防密码管理器按节点缓存语义）；密钥框 autocomplete="off"（不是登录密码）。
 */
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "disabled" }
  | { kind: "uninitialized"; tablePrefix: string }
  | { kind: "initialized"; tablePrefix: string };

function toPhase(state: SetupState): Phase {
  if (!state.enabled) return { kind: "disabled" };
  if (!state.ownerExists)
    return { kind: "uninitialized", tablePrefix: state.tablePrefix };
  return { kind: "initialized", tablePrefix: state.tablePrefix };
}

/** 403 密钥错误 / 429 限流 / 409 后端 detail 原文 / 其余通用错误。 */
function setupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "密钥错误，请检查 SETUP_SECRET 后重试。";
    if (err.status === 429)
      return "尝试过于频繁，请稍后再试（同一 IP 每 10 分钟最多 3 次）。";
    if (err.status === 409) return err.detail ?? err.message;
  }
  return "操作失败，请稍后重试。";
}

export function SetupPage({
  onGoHome,
  onGoAdmin,
}: {
  onGoHome: () => void;
  onGoAdmin: () => void;
}) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const authenticated = useNavStore((s) => s.authenticated);
  const setLoginPrompt = useNavStore((s) => s.setLoginPrompt);

  const refresh = React.useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      setPhase(toPhase(await getSetupState()));
    } catch {
      setPhase({ kind: "error", message: "无法读取数据库状态，请稍后重试。" });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // 登录后重新取一次状态：所有者刚在管理面开启页面时，这里会立刻翻到已初始化形态。
  // 仅在 disabled 形态下触发 —— 未初始化形态建号成功后会保留迁移结果，不被刷新覆盖。
  React.useEffect(() => {
    if (authenticated && phase.kind === "disabled") void refresh();
  }, [authenticated, phase.kind, refresh]);

  // 未初始化形态建号成功后会话已签发：把 store 的私有数据/登录态同步过来，
  // 「进入管理面」即可直接进后台（不另造登录逻辑）。
  const handleOwnerCreated = React.useCallback(() => {
    void useNavStore.getState().loadPrivate();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl">
              nav 数据库初始化 / 升级
            </CardTitle>
            <CardDescription>
              输入 SETUP_SECRET
              检查并升级数据库（只做前进式账本迁移，不删任何表）。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {phase.kind === "loading" && <LoadingBlock />}
            {phase.kind === "error" && (
              <ErrorBlock
                message={phase.message}
                onRetry={() => void refresh()}
              />
            )}
            {phase.kind === "disabled" && (
              <DisabledBlock
                authenticated={authenticated}
                onLogin={() => setLoginPrompt(true)}
                onGoAdmin={onGoAdmin}
              />
            )}
            {phase.kind === "uninitialized" && (
              // 未初始化表单：独立组件 + 固定 key，与已初始化表单互不共享 DOM 节点
              <OwnerSetupForm
                key="setup-owner-form"
                tablePrefix={phase.tablePrefix}
                onCreated={handleOwnerCreated}
                onGoHome={onGoHome}
                onGoAdmin={onGoAdmin}
              />
            )}
            {phase.kind === "initialized" && (
              <UpgradeSetupForm
                key="setup-upgrade-form"
                tablePrefix={phase.tablePrefix}
                onGoHome={onGoHome}
              />
            )}
          </CardContent>
        </Card>

        <div className="mt-4 flex items-center justify-between px-1">
          <Button variant="ghost" size="sm" onClick={onGoHome}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回首页
          </Button>
          {authenticated && (
            <Button variant="ghost" size="sm" onClick={onGoAdmin}>
              管理面
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* disabled 形态的「去登录」复用既有登录弹窗，不另造登录入口 */}
      <LoginDialog />
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      正在检查数据库状态…
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 text-sm text-destructive">
        <ShieldAlert className="mt-0.5 size-4" aria-hidden="true" />
        {message}
      </p>
      <Button variant="outline" className="w-fit" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/** setup 页面开关关闭：只给提示与登录入口，DOM 里没有任何密钥表单。 */
function DisabledBlock({
  authenticated,
  onLogin,
  onGoAdmin,
}: {
  authenticated: boolean;
  onLogin: () => void;
  onGoAdmin: () => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        setup 页面已关闭，请登录后在管理面 → 系统管理中开启
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onLogin}>
          <LogIn className="size-4" aria-hidden="true" />
          去登录
        </Button>
        {authenticated && (
          <Button variant="outline" onClick={onGoAdmin}>
            进入管理面 → 系统管理
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 未初始化形态（ownerExists === false）：SETUP_SECRET + 用户名 + 密码（含确认），
 * 提交 POST /api/auth/setup；成功后展示迁移结果与首页/管理面入口（会话已签发）。
 */
function OwnerSetupForm({
  tablePrefix,
  onCreated,
  onGoHome,
  onGoAdmin,
}: {
  tablePrefix: string;
  onCreated: () => void;
  onGoHome: () => void;
  onGoAdmin: () => void;
}) {
  const [secret, setSecret] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SetupOwnerResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError("密码至少 8 位。");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }

    // 密钥一提交立即从 state/输入框清掉（无论成功失败），不在内存里多留一秒
    const submittedSecret = secret;
    setSecret("");
    setError(null);
    setBusy(true);
    try {
      const res = await runOwnerSetup({
        secret: submittedSecret,
        username: username.trim(),
        password,
      });
      setPassword("");
      setConfirm("");
      setResult(res);
      toast.success("数据库初始化完成，已登录");
      onCreated();
    } catch (err) {
      setError(setupErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="grid gap-4">
        <p className="text-sm font-medium">数据库初始化完成</p>
        <MigrationResults
          tablePrefix={result.tablePrefix}
          migrations={result.migrations}
        />
        <p className="text-sm text-muted-foreground">
          已创建所有者账号{" "}
          <span className="font-medium">{result.user.username}</span>
          ，并已签发登录会话。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onGoHome}>进入首页</Button>
          <Button variant="outline" onClick={onGoAdmin}>
            进入管理面
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        数据库尚未初始化：填写 SETUP_SECRET 并创建唯一的所有者账号。
        当前生效表前缀为{" "}
        <code className="font-mono text-xs">{tablePrefix}</code>。
      </p>

      <div className="grid gap-2">
        <Label htmlFor="setup-secret">SETUP_SECRET</Label>
        <Input
          id="setup-secret"
          name="setup-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
          autoFocus
        />
      </div>

      <Separator />

      <div className="grid gap-2">
        <Label htmlFor="setup-owner-username">用户名</Label>
        <Input
          id="setup-owner-username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="setup-owner-password">密码（至少 8 位）</Label>
        <Input
          id="setup-owner-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="setup-owner-password-confirm">确认密码</Label>
        <Input
          id="setup-owner-password-confirm"
          name="password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy} className="w-fit">
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Database className="size-4" aria-hidden="true" />
        )}
        初始化数据库并创建所有者
      </Button>
    </form>
  );
}

/**
 * 已初始化形态（ownerExists === true 且页面开启）：只有 SETUP_SECRET 一项，
 * 提交 POST /api/setup；成功展示迁移结果并明示未创建/修改任何账号。
 */
function UpgradeSetupForm({
  tablePrefix,
  onGoHome,
}: {
  tablePrefix: string;
  onGoHome: () => void;
}) {
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SetupResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const submittedSecret = secret;
    setSecret("");
    setError(null);
    setBusy(true);
    try {
      setResult(await runSetupUpgrade(submittedSecret));
      toast.success("数据库检查完成");
    } catch (err) {
      setError(setupErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="grid gap-4">
        <p className="text-sm font-medium">数据库检查完成</p>
        <MigrationResults
          tablePrefix={result.tablePrefix}
          migrations={result.migrations}
        />
        <p className="text-sm text-muted-foreground">
          本次未创建或修改任何账号，只执行了账本迁移。
        </p>
        <Button variant="outline" className="w-fit" onClick={onGoHome}>
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        数据库已初始化：输入 SETUP_SECRET
        执行一次账本迁移检查（已应用的迁移会显示
        skipped，不会改动账号）。当前生效表前缀为{" "}
        <code className="font-mono text-xs">{tablePrefix}</code>。
      </p>

      <div className="grid gap-2">
        <Label htmlFor="setup-secret">SETUP_SECRET</Label>
        <Input
          id="setup-secret"
          name="setup-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
          autoFocus
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy} className="w-fit">
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="size-4" aria-hidden="true" />
        )}
        检查并升级数据库
      </Button>
    </form>
  );
}
