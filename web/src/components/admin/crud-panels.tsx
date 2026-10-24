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
  adminCreateCategory,
  adminCreateLink,
  adminDeleteCategory,
  adminDeleteLink,
  adminReorderCategories,
  adminReorderLinks,
  adminUpdateCategory,
  adminUpdateLink,
} from "@/lib/api";
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
  const [visibility, setVisibility] = React.useState<Visibility>("public");

  const openCreate = () => {
    setName("");
    setVisibility("public");
    setCreating(true);
  };

  const openEdit = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    setVisibility(c.visibility);
    setEditing(c);
    setCreating(false);
  };

  const save = async () => {
    if (editing) {
      await adminUpdateCategory(editing.id, { name, visibility });
      toast.success("分类已更新");
    } else {
      await adminCreateCategory({ name, visibility });
      toast.success("分类已创建");
    }
    setEditing(null);
    setCreating(false);
    onChanged();
  };

  const remove = async (id: string) => {
    await adminDeleteCategory(id);
    toast.success("分类已删除");
    onChanged();
  };

  const reorder = async (ids: string[]) => {
    await adminReorderCategories(ids);
    onChanged();
  };

  const entries: SortableEntry[] = categories.map((c) => ({
    id: c.id,
    label: c.name,
    meta: (
      <Badge variant={c.visibility === "private" ? "default" : "secondary"}>
        {c.visibility === "private" ? "私有" : "公开"}
      </Badge>
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
      />

      <Dialog
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
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
  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? "");
  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const categoryLinks = links
    .filter((l) => l.categoryId === category?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({
    title: "",
    url: "",
    iconUrl: "",
    description: "",
    visibility: "public" as Visibility,
  });

  const openCreate = () => {
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

  const save = async () => {
    if (!category) return;
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
      await adminCreateLink({ ...payload, categoryId: category.id });
      toast.success("链接已创建");
    }
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
    await adminReorderLinks([...before, ...orderedIds, ...after]);
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">链接</h2>
        <div className="flex items-center gap-2">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-40" aria-label="选择分类">
              <SelectValue placeholder="选择分类" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate} disabled={!category}>
            新建链接
          </Button>
        </div>
      </div>

      {category ? (
        <SortableList
          entries={categoryLinks.map((l) => ({
            id: l.id,
            label: l.title,
            meta: (
              <Badge
                variant={l.visibility === "private" ? "default" : "secondary"}
              >
                {l.visibility === "private" ? "私有" : "公开"}
              </Badge>
            ),
          }))}
          onReorder={reorder}
          onEdit={openEdit}
          onRemove={remove}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          暂无分类，请先创建分类。
        </p>
      )}

      <Dialog
        open={creating || !!editingId}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditingId(null);
          }
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
            <div className="grid gap-2">
              <Label htmlFor="link-icon">
                iconUrl（可空，空则自动抓 favicon）
              </Label>
              <Input
                id="link-icon"
                value={form.iconUrl}
                onChange={(e) => setForm({ ...form, iconUrl: e.target.value })}
              />
            </div>
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
