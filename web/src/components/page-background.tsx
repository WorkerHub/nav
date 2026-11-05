import * as React from "react";
import type { SiteSettings } from "@/lib/types";

/**
 * 全屏壁纸背景层（公开页与后台共用）：
 * 同一壁纸解析口径 —— `wallpaperSource` + `backgroundUrl` + `/api/wallpaper/today`
 * （含 bing 探针回落链），壁纸上加阅读性罩层（沿用前台渐变值）。
 *
 * settings 为 undefined（站点数据未到达）时先不解析来源、也不发探针，以免提前拉取
 * 整张大图；此时只显示纯色底。
 */
export function PageBackground({
  settings,
}: {
  settings: SiteSettings | undefined;
}) {
  // 壁纸来源（缺省 bing）。custom 且填了 backgroundUrl 才用自定义图，
  // 否则（bing / custom 但 backgroundUrl 为空）都走 Bing 每日壁纸端点。
  const settingsReady = settings !== undefined;
  const wallpaperSource = settings?.wallpaperSource ?? "bing";
  const customBackgroundUrl = settings?.backgroundUrl ?? "";
  const useBing =
    settingsReady && (wallpaperSource !== "custom" || !customBackgroundUrl);

  // bing 取图失败时回落：先试 backgroundUrl（非空），再落到纯色底（url 层去掉）。
  const [bingFailed, setBingFailed] = React.useState(false);
  React.useEffect(() => {
    setBingFailed(false);
    if (!useBing) return;
    const img = new Image();
    img.onload = () => setBingFailed(false);
    img.onerror = () => setBingFailed(true);
    img.src = "/api/wallpaper/today";
  }, [useBing]);

  const backgroundUrl = !settingsReady
    ? ""
    : useBing && !bingFailed
      ? "/api/wallpaper/today"
      : customBackgroundUrl;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(rgba(15,23,42,0.55), rgba(15,23,42,0.35)), url(${JSON.stringify(
          backgroundUrl,
        )})`,
        backgroundColor: "#0f172a",
      }}
    />
  );
}
