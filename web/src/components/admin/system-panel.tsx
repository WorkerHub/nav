import * as React from "react";
import { Database, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  adminGetSystem,
  adminRunSetup,
  adminSetSetupPage,
} from "@/lib/api";
import { MigrationResults } from "@/components/setup/migration-results";
import type { AdminSystem, SetupResult } from "@/lib/types";

/**
 * 后台「系统管理」选项卡（SETUP-PAGE-SPEC §5）：
 *  - 数据库维护：生效 tablePrefix + 账本已记录迁移；「检查并升级数据库」走
 *    POST /api/admin/setup（免密钥，会话鉴权），逐条展示 applied/skipped；
 *  - setup 页面：Switch 绑定 setupPageEnabled，PUT 后回读确认；旁注说明开关只
 *    门控页面、不门控密钥接口。
 */
export function SystemPanel() {
  const [system, setSystem] = React.useState<AdminSystem | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [upgrading, setUpgrading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState<SetupResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setSystem(await adminGetSystem());
      setLoadError(null);
    } catch (e) {
      setLoadError(
        e instanceof ApiError && e.status === 401
          ? "会话已失效，请重新登录。"
          : "读取系统信息失败，请稍后重试。",
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const upgrade = async () => {
    setUpgrading(true);
    setResult(null);
    setRunError(null);
    try {
      const res = await adminRunSetup();
      setResult(res);
      const applied = res.migrations.filter(
        (m) => m.status === "applied",
      ).length;
      const skipped = res.migrations.filter(
        (m) => m.status === "skipped",
      ).length;
      toast.success(
        `数据库检查完成：${applied} 个迁移已应用，${skipped} 个已是最新`,
      );
      await load(); // 回读账本，账本状态以库为准
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 前缀冲突：后端 detail 原文直接显示在区内，不吞错误
        const detail = e.detail ?? e.message;
        setRunError(detail);
        toast.error(`表前缀冲突：${detail}`);
      } else {
        const message = "升级失败，请稍后重试。";
        setRunError(message);
        toast.error(message);
      }
    } finally {
      setUpgrading(false);
    }
  };

  const toggleSetupPage = async (enabled: boolean) => {
    setSaving(true);
    try {
      const saved = await adminSetSetupPage(enabled);
      toast.success(
        saved.setupPageEnabled ? "已开启 setup 页面" : "已关闭 setup 页面",
      );
    } catch {
      toast.error("保存失败，请稍后重试");
    } finally {
      // 无论成败都回读确认，开关状态以服务端为准
      await load();
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-heading text-lg font-semibold">系统管理</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" aria-hidden="true" />
            数据库维护
          </CardTitle>
          <CardDescription>
            只做前进式账本迁移：不建号、不改密码、不删任何表。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loadError ? (
            <Alert variant="destructive">
              <AlertTitle>读取失败</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : !system ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              正在读取系统信息…
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">生效表前缀</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {system.tablePrefix || "(无前缀)"}
                </code>
              </div>

              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">
                  账本已记录迁移
                </span>
                {system.ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    账本中暂无迁移记录。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {system.ledger.map((name) => (
                      <Badge
                        key={name}
                        variant="secondary"
                        className="font-mono"
                      >
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void upgrade()} disabled={upgrading}>
                  {upgrading ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Database className="size-4" aria-hidden="true" />
                  )}
                  {upgrading ? "正在检查并升级…" : "检查并升级数据库"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  免密钥，使用当前登录会话执行。
                </span>
              </div>

              {runError && (
                <Alert variant="destructive">
                  <AlertTitle>升级失败</AlertTitle>
                  <AlertDescription className="break-words">
                    {runError}
                  </AlertDescription>
                </Alert>
              )}

              {result && (
                <div className="grid gap-2">
                  <span className="text-sm text-muted-foreground">
                    本次执行结果
                  </span>
                  <MigrationResults
                    tablePrefix={result.tablePrefix}
                    migrations={result.migrations}
                  />
                  <p className="text-sm text-muted-foreground">
                    未创建或修改任何账号。
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>setup 页面</CardTitle>
          <CardDescription>
            控制 /setup 页面是否对外开放（单人站点，初始化完成后默认关闭）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="system-setup-page">允许访问 /setup 页面</Label>
              <p className="text-sm text-muted-foreground">
                关闭后 /setup
                只显示已关闭提示；管理面升级按钮与密钥接口不受此开关影响。
              </p>
            </div>
            <Switch
              id="system-setup-page"
              checked={system?.setupPageEnabled ?? false}
              disabled={!system || saving}
              onCheckedChange={(checked) => void toggleSetupPage(checked)}
            />
          </div>

          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href="/setup" target="_blank" rel="noreferrer">
              打开 setup 页面
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
