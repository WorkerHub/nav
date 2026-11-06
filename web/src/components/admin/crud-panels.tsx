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
import { IconPickerField } from "@/components/admin/icon-picker";
import { SiteIcon } from "@/components/site-icon";
import {
  adminCreateCategory,
  adminCreateLink,
  adminDeleteCategory,
  adminDeleteLink,
  adminUpdateCategory,
  adminUpdateLink,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink, Visibility } from "@/lib/types";

/** 分类 CRUD + dnd-kit 拖拽排序 */
export function CategoryPanel({
  categories,
  onChanged,
}: {
  categories: AdminCategory[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<AdminCategory | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("public");
  const draft = useAssetDraftCleanup();

  const openCreate = () => {
    setName("");
    setIcon("");
    setVisibility("public");
    setCreating(true);
  };

  const openEdit = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    setIcon(c.icon ?? "");
    setVisibility(c.visibility);
    setEditing(c);
    setCreating(false);
  };

  const close = () => {
    void draft.discard();
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    const nextName = name.trim();
    if (!nextName) {
      toast.error("分类名称不能为空");
      return;
    }
    // 同名分类前端拦一道（后端无唯一约束）：trim + 不区分大小写，编辑时排除自身
    const duplicated = categories.some(
      (c) =>
        c.id !== editing?.id &&
        c.name.trim().toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicated) {
      toast.error(`分类「${nextName}」已存在，请换一个名称`);
      return;
    }
    const previousIcon = editing?.icon ?? null;
    const payload = { name: nextName, icon: icon || null, visibility };
    if (editing) {
      await adminUpdateCategory(editing.id, payload);
      toast.success("分类已更新");
    } else {
      await adminCreateCategory(payload);
      toast.success("分类已创建");
    }
    draft.commit();
    // 图标清旧由前端负责（后端只对 settings 的 background/logo 自动清旧）
    await deleteReplacedAsset(previousIcon, payload.icon);
    setEditing(null);
    setCreating(false);
    onChanged();
  };

  const remove = async (id: string) => {
    await adminDeleteCategory(id);
    toast.success("分类已删除");
    onChanged();
  };

  // 乐观排序：store 先写新顺序（界面立即定住），成功后 onChanged() 整表重拉对账
  const reorder = async (ids: string[]) => {
    try {
      await useNavStore.getState().reorderCategories(ids);
      onChanged();
    } catch (e) {
      toast.error(`排序失败，已恢复原顺序：${(e as Error).message}`);
    }
  };

  const entries: SortableEntry[] = categories.map((c) => ({
    id: c.id,
    label: c.name,
    meta: (
      <span className="flex items-center gap-2">
        <AssetThumb src={c.icon} alt="" />
        <Badge variant={c.visibility === "private" ? "default" : "secondary"}>
          {c.visibility === "private" ? "私有" : "公开"}
        </Badge>
      </span>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">分类</h2>
        <Button onClick={openCreate}>新建分类</Button>
      </div>

      <SortableList
        entries={entries}
        onReorder={reorder}
        onEdit={openEdit}
        onRemove={remove}
        confirmRemove
        removeDescription="删除分类后无法恢复，该分类下的链接也会一并删除。"
      />

      <Dialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑分类" : "新建分类"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cat-name">名称</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <AssetUploadField
              id="cat-icon"
              label="分类图标"
              purpose="icon"
              value={icon}
              onChange={setIcon}
              onUploaded={draft.track}
            />
            <div className="flex items-center justify-between">
              <Label htmlFor="cat-vis">私有分类</Label>
              <Switch
                id="cat-vis"
                checked={visibility === "private"}
                onCheckedChange={(v) => setVisibility(v ? "private" : "public")}
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

/** 「所有」筛选项的哨兵值：Radix Select 不允许 SelectItem 用空串（空串代表未选） */
const ALL_CATEGORIES = "__all__";

/** 链接 CRUD + 分类内排序（后台 links 为扁平列表，按 categoryId 过滤） */
export function LinkPanel({
  categories,
  links,
  onChanged,
}: {
  categories: AdminCategory[];
  links: AdminLink[];
  onChanged: () => void;
}) {
  const [categoryId, setCategoryId] = React.useState<string>(ALL_CATEGORIES);
  const category = categories.find((c) => c.id === categoryId);
  // 「所有」：不过滤分类，直接按全局 sortOrder 展示全部链接
  const categoryLinks = (
    category ? links.filter((l) => l.categoryId === category.id) : [...links]
  ).sort((a, b) => a.sortOrder - b.sortOrder);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({
    title: "",
    url: "",
    iconUrl: "",
    description: "",
    visibility: "public" as Visibility,
  });
  const draft = useAssetDraftCleanup();

  const openCreate = () => {
    if (!category) {
      toast.error("请先选择一个分类");
      return;
    }
    setForm({
      title: "",
      url: "",
      iconUrl: "",
      description: "",
      visibility: "public",
    });
    setEditingId(null);
    setCreating(true);
  };

  const openEdit = (id: string) => {
    const l = categoryLinks.find((x) => x.id === id);
    if (!l) return;
    setForm({
      title: l.title,
      url: l.url,
      iconUrl: l.iconUrl ?? "",
      description: l.description ?? "",
      visibility: l.visibility,
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
    const previousIcon = links.find((l) => l.id === editingId)?.iconUrl ?? null;
    const payload = {
      title: form.title,
      url: form.url,
      iconUrl: form.iconUrl || null,
      description: form.description || null,
      visibility: form.visibility,
    };
    if (editingId) {
      await adminUpdateLink(editingId, payload);
      toast.success("链接已更新");
    } else {
      if (!category) return;
      await adminCreateLink({ ...payload, categoryId: category.id });
      toast.success("链接已创建");
    }
    draft.commit();
    // 图标清旧由前端负责（后端只对 settings 的 background/logo 自动清旧）
    await deleteReplacedAsset(previousIcon, payload.iconUrl);
    setCreating(false);
    setEditingId(null);
    onChanged();
  };

  const remove = async (id: string) => {
    await adminDeleteLink(id);
    toast.success("链接已删除");
    onChanged();
  };

  const reorder = async (orderedIds: string[]) => {
    // 契约 reorder 为全局 ids 列表（sort_order 全局）；此处重建全量顺序，
    // 仅替换当前分类链接的相对位置，其余分类链接保持原有相对顺序。
    const selectedSet = new Set(orderedIds);
    const sorted = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
    const firstIdx = sorted.findIndex((l) => selectedSet.has(l.id));
    const before: string[] = [];
    const after: string[] = [];
    sorted.forEach((l, i) => {
      if (selectedSet.has(l.id)) return;
      if (i < firstIdx) before.push(l.id);
      else after.push(l.id);
    });
    // 乐观更新作用于重建后的**全量** links（跨分类相对顺序不变），成功后 onChanged() 对账
    try {
      await useNavStore
        .getState()
        .reorderLinks([...before, ...orderedIds, ...after]);
      onChanged();
    } catch (e) {
      toast.error(`排序失败，已恢复原顺序：${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">链接</h2>
        <div className="flex items-center gap-2">
          <Select
            value={category ? categoryId : ALL_CATEGORIES}
            onValueChange={setCategoryId}
          >
            <SelectTrigger className="w-40" aria-label="选择分类">
              <SelectValue placeholder="选择分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>所有</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>新建链接</Button>
        </div>
      </div>

      {categories.length > 0 ? (
        <SortableList
          entries={categoryLinks.map((l) => ({
            id: l.id,
            label: l.title,
            meta: (
              <span className="flex items-center gap-2">
                <SiteIcon
                  title={l.title}
                  url={l.url}
                  iconUrl={l.iconUrl}
                  size={20}
                />
                <Badge
                  variant={l.visibility === "private" ? "default" : "secondary"}
                >
                  {l.visibility === "private" ? "私有" : "公开"}
                </Badge>
              </span>
            ),
          }))}
          onReorder={reorder}
          onEdit={openEdit}
          onRemove={remove}
          confirmRemove
          removeDescription="删除链接后无法恢复，请确认。"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          暂无分类，请先创建分类。
        </p>
      )}

      <Dialog
        open={creating || !!editingId}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑链接" : "新建链接"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="link-title">标题</Label>
              <Input
                id="link-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <IconPickerField
              id="link-icon"
              label="链接图标"
              value={form.iconUrl}
              onChange={(iconUrl) => setForm({ ...form, iconUrl })}
              onUploaded={draft.track}
              title={form.title}
              url={form.url}
            />
            <div className="grid gap-2">
              <Label htmlFor="link-desc">描述</Label>
              <Input
                id="link-desc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="link-vis">私有链接</Label>
              <Switch
                id="link-vis"
                checked={form.visibility === "private"}
                onCheckedChange={(v) =>
                  setForm({ ...form, visibility: v ? "private" : "public" })
                }
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
