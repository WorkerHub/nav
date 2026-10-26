import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  SortableList,
  type SortableEntry,
} from "@/components/admin/sortable-list";
import {
  AssetThumb,
  AssetUploadField,
  deleteReplacedAsset,
  useAssetDraftCleanup,
} from "@/components/admin/asset-upload";
import {
  adminCreateEngine,
  adminDeleteEngine,
  adminImportCategories,
  adminImportEngines,
  adminReorderEngines,
  adminUpdateEngine,
  adminUpdateSettings,
} from "@/lib/api";
import {
  buildExport,
  download,
  exportJson,
  parseBookmarksHtml,
  parseImportJson,
} from "@/lib/bookmarks";
import { useNavStore } from "@/lib/nav-store";
import type {
  AdminCategory,
  AdminLink,
  SearchEngine,
  SiteSettings,
} from "@/lib/types";

/** 搜索引擎 CRUD + 排序 + 设默认 */
export function SearchEnginePanel({
  engines,
  onChanged,
}: {
  engines: SearchEngine[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    urlTemplate: "",
    icon: "",
    isDefault: false,
  });
  const draft = useAssetDraftCleanup();

  const openCreate = () => {
    setForm({
      name: "",
      urlTemplate: "https://example.com/search?q={q}",
      icon: "",
      isDefault: false,
    });
    setEditingId(null);
    setCreating(true);
  };

  const openEdit = (id: string) => {
    const e = engines.find((x) => x.id === id);
    if (!e) return;
    setForm({
      name: e.name,
      urlTemplate: e.urlTemplate,
      icon: e.icon ?? "",
      isDefault: e.isDefault,
    });
    setEditingId(id);
    setCreating(false);
  };

  const close = () => {
    void draft.discard();
    setCreating(false);
    setEditingId(null);
  };

  const save = async () => {
    const previousIcon = engines.find((e) => e.id === editingId)?.icon ?? null;
    const payload = { ...form, icon: form.icon || null };
    if (editingId) {
      await adminUpdateEngine(editingId, payload);
      toast.success("搜索引擎已更新");
    } else {
      await adminCreateEngine(payload);
      toast.success("搜索引擎已创建");
    }
    draft.commit();
    // 图标清旧由前端负责：新图标已落库，删掉被替换掉的旧 R2 对象
    await deleteReplacedAsset(previousIcon, payload.icon);
    setCreating(false);
    setEditingId(null);
    onChanged();
  };

  const remove = async (id: string) => {
    await adminDeleteEngine(id);
    toast.success("搜索引擎已删除");
    onChanged();
  };

  const setDefault = async (id: string) => {
    await adminUpdateEngine(id, { isDefault: true });
    onChanged();
  };

  const reorder = async (ids: string[]) => {
    await adminReorderEngines(ids);
    onChanged();
  };

  const entries: SortableEntry[] = engines.map((e) => ({
    id: e.id,
    label: e.name,
    meta: (
      <span className="flex items-center gap-2">
        <AssetThumb src={e.icon} alt="" />
        {e.isDefault ? <Badge>默认</Badge> : null}
      </span>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">搜索引擎</h2>
        <Button onClick={openCreate}>新建引擎</Button>
      </div>

      <SortableList
        entries={entries}
        onReorder={reorder}
        onEdit={openEdit}
        onRemove={remove}
      />

      {!engines.some((e) => e.isDefault) && engines.length > 0 && (
        <p className="text-sm text-muted-foreground">尚未设置默认搜索引擎。</p>
      )}
      <div className="flex flex-wrap gap-2">
        {engines
          .filter((e) => !e.isDefault)
          .map((e) => (
            <Button
              key={e.id}
              variant="outline"
              size="sm"
              onClick={() => void setDefault(e.id)}
            >
              设“{e.name}”为默认
            </Button>
          ))}
      </div>

      <Dialog
        open={creating || !!editingId}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "编辑搜索引擎" : "新建搜索引擎"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="eng-name">名称</Label>
              <Input
                id="eng-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eng-url">URL 模板（含 {"{q}"} 占位）</Label>
              <Input
                id="eng-url"
                value={form.urlTemplate}
                onChange={(e) =>
                  setForm({ ...form, urlTemplate: e.target.value })
                }
              />
            </div>
            <AssetUploadField
              id="eng-icon"
              label="图标"
              purpose="icon"
              value={form.icon}
              onChange={(icon) => setForm({ ...form, icon })}
              onUploaded={draft.track}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="eng-default">设为默认</Label>
              <Switch
                id="eng-default"
                checked={form.isDefault}
                onCheckedChange={(v) => setForm({ ...form, isDefault: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 站点设置 */
export function SettingsPanel({
  settings,
  onChanged,
}: {
  settings: SiteSettings;
  onChanged: () => void;
}) {
  // 直接用 store 传入的 settings 初始化；不再用 useEffect 同步 setState。
  const [form, setForm] = React.useState<SiteSettings>({
    ...settings,
    logoUrl: settings.logoUrl ?? "",
  });

  const save = async () => {
    // 背景 / Logo 的旧 R2 对象由后端在 PUT /settings 时自动清旧，前端不再重复删。
    const saved = await adminUpdateSettings({
      ...form,
      logoUrl: form.logoUrl ?? "",
    });
    // 主题等站点级设置：用保存响应就地刷新 store，保存即生效（不必等 loadAdmin 重拉）
    useNavStore.getState().patchAdminSettings(saved);
    toast.success("设置已保存");
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">站点设置</h2>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="set-title">站点标题</Label>
          <Input
            id="set-title"
            value={form.siteTitle}
            onChange={(e) => setForm({ ...form, siteTitle: e.target.value })}
          />
        </div>
        <AssetUploadField
          id="set-bg"
          label="背景图"
          purpose="background"
          value={form.backgroundUrl ?? ""}
          onChange={(backgroundUrl) => setForm({ ...form, backgroundUrl })}
        />
        <AssetUploadField
          id="set-logo"
          label="站点 Logo"
          purpose="logo"
          value={form.logoUrl ?? ""}
          onChange={(logoUrl) => setForm({ ...form, logoUrl })}
        />
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="set-cols">列数（1–12）</Label>
            <Input
              id="set-cols"
              type="number"
              min={1}
              max={12}
              value={form.columns}
              onChange={(e) =>
                setForm({ ...form, columns: Number(e.target.value) })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="set-theme">主题</Label>
            <Select
              value={form.theme}
              onValueChange={(v) =>
                setForm({ ...form, theme: v as SiteSettings["theme"] })
              }
            >
              <SelectTrigger id="set-theme" aria-label="选择主题">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <Button onClick={() => void save()} className="w-fit">
        保存设置
      </Button>
    </div>
  );
}

/** 导入导出：书签 HTML 导入、JSON 导入/导出（前端解析与生成） */
export function ImportExportPanel({
  categories,
  links,
  engines,
  settings,
  onChanged,
}: {
  categories: AdminCategory[];
  links: AdminLink[];
  engines: SearchEngine[];
  settings: SiteSettings;
  onChanged: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const jsonRef = React.useRef<HTMLInputElement>(null);

  const importBookmarks = async (file: File) => {
    const text = await file.text();
    const result = parseBookmarksHtml(text);
    const counts = await adminImportCategories(result.categories);
    toast.success(
      `已导入 ${counts.categoryCount} 个分类、${counts.linkCount} 条链接`,
    );
    onChanged();
  };

  const importJson = async (file: File) => {
    try {
      const data = parseImportJson(await file.text());
      await adminImportCategories(data.categories);
      if (data.searchEngines?.length)
        await adminImportEngines(data.searchEngines);
      if (data.settings) {
        // 导入的主题同样立即生效（store 就地刷新，ThemeProvider 跟 settings.theme 走）
        useNavStore
          .getState()
          .patchAdminSettings(await adminUpdateSettings(data.settings));
      }
      toast.success("JSON 已导入");
      onChanged();
    } catch (e) {
      toast.error(`导入失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">导入导出</h2>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          导入浏览器书签 HTML
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".html,text/html"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importBookmarks(f);
            e.target.value = "";
          }}
        />

        <Button variant="outline" onClick={() => jsonRef.current?.click()}>
          导入 JSON
        </Button>
        <input
          ref={jsonRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = "";
          }}
        />

        <Button
          variant="outline"
          onClick={() =>
            download(
              "nav-export.json",
              exportJson(buildExport(categories, links, engines, settings)),
            )
          }
        >
          导出 JSON
        </Button>
      </div>

      <Separator />
      <p className="text-sm text-muted-foreground">
        书签 HTML 导入按源文件还原分类与链接数量；JSON 导出可再导入还原。
      </p>
    </div>
  );
}
