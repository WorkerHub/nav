import * as React from "react";
import { FadeIn, GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import { safeHost } from "@/lib/icons";
import type { SiteCategory, SiteLink } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 链接卡片：图标 + 标题 + 域名；桌面 7–8 列 / 手机 4 列 */
function LinkTile({ link, index }: { link: SiteLink; index: number }) {
  return (
    <FadeIn delay={Math.min(index * 0.02, 0.3)}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="glass glass-hover group flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center"
      >
        <SiteIcon
          title={link.title}
          url={link.url}
          iconUrl={link.iconUrl}
          size={44}
        />
        <span className="line-clamp-2 w-full text-sm font-medium text-foreground/90">
          {link.title}
        </span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {safeHost(link.url)}
        </span>
      </a>
    </FadeIn>
  );
}

export function LinkGrid({ links }: { links: SiteLink[] }) {
  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
      {links.map((link, i) => (
        <LinkTile key={link.id} link={link} index={i} />
      ))}
    </div>
  );
}

/** 分类区块（锚点目标）；private 时带 accent 描边与「私有」徽标 */
export function CategorySection({
  category,
  privateZone = false,
}: {
  category: SiteCategory;
  privateZone?: boolean;
}) {
  return (
    <section id={`cat-${category.id}`} className="scroll-mt-24">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-heading text-xl font-semibold text-white drop-shadow">
          {category.name}
        </h2>
        {privateZone && (
          <GlassCard
            hover={false}
            className="rounded-full px-2.5 py-0.5 text-xs text-white/90"
          >
            私有
          </GlassCard>
        )}
      </div>
      <LinkGrid links={category.links} />
    </section>
  );
}

/** 顶部锚点栏：滚动定位 + 当前分类高亮 */
export function CategoryAnchorBar({
  categories,
}: {
  categories: SiteCategory[];
}) {
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    categories.forEach((c) => {
      const el = document.getElementById(`cat-${c.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [categories]);

  return (
    <nav aria-label="分类锚点" className="flex flex-wrap items-center gap-1">
      {categories.map((c) => {
        const isActive = active === `cat-${c.id}`;
        return (
          <a
            key={c.id}
            href={`#cat-${c.id}`}
            className={cn(
              "glass rounded-full px-3.5 py-1.5 text-sm text-white/85 transition-colors hover:text-white",
              isActive && "bg-white/30 font-semibold text-white",
            )}
          >
            {c.name}
          </a>
        );
      })}
    </nav>
  );
}
