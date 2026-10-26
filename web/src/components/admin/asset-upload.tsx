import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminDeleteAsset,
  adminUploadAsset,
  type AssetPurpose,
} from "@/lib/api";

/**
 * 图片上传控件（站点背景 / Logo / 链接·分类·搜索引擎图标共用）。
 *
 * 契约：`POST /api/admin/assets`（multipart `file` + `purpose`）→ `{ path }`，
 * 路径形如 `/assets/assets/{purpose}/{uuid}.{ext}`；上传成功即回填字段。
 * 类型 / 大小校验在后端（按 purpose 限大小），超限时把后端 `error` 原文透出。
 */

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico";

const HINT: Record<AssetPurpose, string> = {
  background: "支持 PNG / JPEG / WebP / GIF / SVG / ICO，≤ 5MB",
  logo: "支持 PNG / JPEG / WebP / GIF / SVG / ICO，≤ 1MB",
  icon: "支持 PNG / JPEG / WebP / GIF / SVG / ICO，≤ 1MB",
};

/** 是否为本站已上传资源（`/assets/...`）—— 只有这类值替换时才需要删旧对象。 */
export function isUploadedAsset(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.startsWith("/assets/");
}

/**
 * 图标清旧：后端只对 settings 的 background/logo 自动清旧，图标（链接/分类/引擎）
 * 的清旧由前端负责。这里在字段值真的落库后调用，删除被替换掉的旧 R2 对象。
 * 清旧失败不阻塞主流程（对象成为孤儿，但用户看到的数据是正确的）。
 */
export async function deleteReplacedAsset(
  previous: string | null | undefined,
  next: string | null | undefined,
): Promise<void> {
  if (!isUploadedAsset(previous)) return;
  if (previous === next) return;
  try {
    await adminDeleteAsset(previous);
  } catch {
    /* 旧对象清理失败：不打断已成功的保存 */
  }
}

/**
 * 记录本次编辑过程中新上传出来的路径：
 *  - `commit()` 保存成功后调用，清空记录（这些路径已落库，不再回收）；
 *  - `discard()` 取消编辑时调用，删掉尚未落库的新对象，避免孤儿。
 */
export function useAssetDraftCleanup() {
  const pending = React.useRef<string[]>([]);

  const track = React.useCallback((path: string) => {
    if (isUploadedAsset(path)) pending.current.push(path);
  }, []);

  const commit = React.useCallback(() => {
    pending.current = [];
  }, []);

  const discard = React.useCallback(async () => {
    const paths = pending.current;
    pending.current = [];
    for (const path of paths) {
      try {
        await adminDeleteAsset(path);
      } catch {
        /* 回收失败不打断取消操作 */
      }
    }
  }, []);

  return { track, commit, discard };
}

export function AssetUploadField({
  id,
  label,
  purpose,
  value,
  onChange,
  onUploaded,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  purpose: AssetPurpose;
  value: string;
  onChange: (next: string) => void;
  /** 上传成功回调（用于草稿回收），不影响回填。 */
  onUploaded?: (path: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  // 记录“哪张图加载失败”；值换成新图片时自动恢复预览（无需在 effect 里重置）
  const [brokenValue, setBrokenValue] = React.useState<string | null>(null);
  const broken = value !== "" && brokenValue === value;

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { path } = await adminUploadAsset(file, purpose);
      onChange(path);
      onUploaded?.(path);
      toast.success(`${label}已上传`);
    } catch (error) {
      toast.error(`上传失败：${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const previewAlt = `${label}预览`;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          placeholder="填图片 URL，或点右侧上传"
          disabled={disabled || uploading}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          aria-label={`上传${label}`}
          className="hidden"
          onChange={(event) => void pick(event)}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="size-4" aria-hidden="true" />
          )}
          {uploading ? "上传中…" : "上传"}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 gap-1"
            disabled={disabled || uploading}
            onClick={() => onChange("")}
          >
            <X className="size-4" aria-hidden="true" />
            移除
          </Button>
        ) : null}
      </div>
      {value ? (
        broken ? (
          <p className="text-xs text-destructive">
            无法预览该图片，请检查地址或重新上传
          </p>
        ) : (
          <img
            src={value}
            alt={previewAlt}
            onError={() => setBrokenValue(value)}
            className="h-20 w-auto max-w-[240px] rounded-lg border bg-muted/30 object-contain p-1"
          />
        )
      ) : null}
      <p className="text-xs text-muted-foreground">{hint ?? HINT[purpose]}</p>
    </div>
  );
}

/** 后台列表里的图标缩略（分类 / 搜索引擎图标：外链与 `/assets/...` 都能显示）。 */
export function AssetThumb({
  src,
  alt,
  size = 20,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number;
}) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded border bg-muted/30 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
