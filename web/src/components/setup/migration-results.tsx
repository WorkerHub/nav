import { Badge } from "@/components/ui/badge";
import type { SetupMigration } from "@/lib/types";

/**
 * 迁移结果展示（/setup 页与后台系统管理共用）：生效表前缀 + 逐条 applied/skipped。
 * 两种形态共用同一渲染，不各自手搓列表。
 */
export function MigrationResults({
  tablePrefix,
  migrations,
}: {
  tablePrefix: string;
  migrations: SetupMigration[];
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">生效表前缀</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {tablePrefix || "(无前缀)"}
        </code>
      </div>
      {migrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">账本中没有迁移记录。</p>
      ) : (
        <ul className="grid gap-1.5">
          {migrations.map((migration) => (
            <li
              key={migration.name}
              className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5"
            >
              <span className="font-mono text-xs">{migration.name}</span>
              <Badge
                variant={
                  migration.status === "applied"
                    ? "default"
                    : migration.status === "skipped"
                      ? "secondary"
                      : "destructive"
                }
              >
                {migration.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
