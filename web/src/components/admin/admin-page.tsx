import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import {
  ImportExportPanel,
  SearchEnginePanel,
  SettingsPanel,
} from "@/components/admin/settings-panels";
import { SystemPanel } from "@/components/admin/system-panel";
import { useNavStore } from "@/lib/nav-store";

/**
 * 后台（/admin）：分类 / 链接 / 搜索引擎 / 站点设置 CRUD + 导入导出 + 系统管理，
 * 列表用 dnd-kit 拖拽排序（含上移/下移键盘替代）。
 * 后台数据由 store（useNavStore.adminData）承载，本页只负责加载与分发。
 */
export function AdminPage({ onBack }: { onBack: () => void }) {
  const adminData = useNavStore((s) => s.adminData);
  const loadAdmin = useNavStore((s) => s.loadAdmin);

  React.useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  const categories = adminData?.categories ?? [];
  const links = adminData?.links ?? [];
  const engines = adminData?.searchEngines ?? [];
  const settings = adminData?.settings ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Group orientation="horizontal" className="min-h-screen">
        <Panel defaultSize="20%" minSize="15%" className="border-r bg-card">
          <div className="flex h-full flex-col gap-4 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2"
              onClick={onBack}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              返回首页
            </Button>
            <div className="text-sm text-muted-foreground">nav 后台管理</div>
          </div>
        </Panel>

        <Separator className="w-px bg-border" />

        <Panel defaultSize="80%" className="p-6">
          {settings ? (
            <Tabs defaultValue="categories" className="w-full">
              <TabsList>
                <TabsTrigger value="categories">分类</TabsTrigger>
                <TabsTrigger value="links">链接</TabsTrigger>
                <TabsTrigger value="engines">搜索引擎</TabsTrigger>
                <TabsTrigger value="settings">站点设置</TabsTrigger>
                <TabsTrigger value="io">导入导出</TabsTrigger>
                <TabsTrigger value="system">系统管理</TabsTrigger>
              </TabsList>

              <TabsContent value="categories" className="mt-6 max-w-2xl">
                <CategoryPanel
                  categories={categories}
                  onChanged={() => void loadAdmin()}
                />
              </TabsContent>

              <TabsContent value="links" className="mt-6 max-w-2xl">
                <LinkPanel
                  categories={categories}
                  links={links}
                  onChanged={() => void loadAdmin()}
                />
              </TabsContent>

              <TabsContent value="engines" className="mt-6 max-w-2xl">
                <SearchEnginePanel
                  engines={engines}
                  onChanged={() => void loadAdmin()}
                />
              </TabsContent>

              <TabsContent value="settings" className="mt-6 max-w-2xl">
                <SettingsPanel
                  settings={settings}
                  onChanged={() => void loadAdmin()}
                />
              </TabsContent>

              <TabsContent value="io" className="mt-6 max-w-2xl">
                <ImportExportPanel
                  categories={categories}
                  links={links}
                  engines={engines}
                  settings={settings}
                  onChanged={() => void loadAdmin()}
                />
              </TabsContent>

              <TabsContent value="system" className="mt-6 max-w-2xl">
                <SystemPanel />
              </TabsContent>
            </Tabs>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </Panel>
      </Group>
    </div>
  );
}
