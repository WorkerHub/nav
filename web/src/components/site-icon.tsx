import * as React from "react";
import { faviconCandidates, hashColor, initialOf } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * 站点图标：真实 favicon 优先（icon_url → Google s2 → 目标站 /favicon.ico），
 * 全部失败时回退「按域名哈希着色的首字圆」（MASTER.md §1.4）。
 */
export function SiteIcon({
  title,
  url,
  iconUrl,
  size = 40,
  className,
}: {
  title: string;
  url: string;
  iconUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const candidates = React.useMemo(
    () => faviconCandidates(url, iconUrl),
    [url, iconUrl],
  );
  const [index, setIndex] = React.useState(0);

  if (index >= candidates.length) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
          className,
        )}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          background: hashColor(url || title),
        }}
      >
        {initialOf(title, url)}
      </span>
    );
  }

  return (
    <img
      src={candidates[index]}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setIndex((i) => i + 1)}
      className={cn("shrink-0 rounded-md object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
