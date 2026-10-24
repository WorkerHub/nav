import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass";
import { SiteIcon } from "@/components/site-icon";
import type { SearchEngine } from "@/lib/types";

/**
 * 顶部多引擎搜索框：引擎切换（下拉）、`/` 键全局聚焦、Enter 按 {q} 模板跳转。
 */
export function SearchBar({ engines }: { engines: SearchEngine[] }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [engineId, setEngineId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const engine =
    engines.find((e) => e.id === engineId) ??
    engines.find((e) => e.isDefault) ??
    engines[0];

  // 全局 `/` 聚焦搜索框（不在输入框内时）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !engine) return;
    window.location.href = engine.urlTemplate.replace(
      "{q}",
      encodeURIComponent(q),
    );
  };

  return (
    <GlassCard className="mx-auto flex w-full max-w-2xl items-center gap-2 p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 shrink-0 gap-1.5 px-2.5 text-foreground/90"
            aria-label={`当前搜索引擎：${engine?.name ?? "未配置"}，点击切换`}
          >
            {engine ? (
              <SiteIcon
                title={engine.name}
                url={engine.urlTemplate.replace("{q}", "")}
                size={20}
              />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="max-w-24 truncate text-sm">{engine?.name}</span>
            <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {engines.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onSelect={() => setEngineId(e.id)}
              className="gap-2"
            >
              <SiteIcon
                title={e.name}
                url={e.urlTemplate.replace("{q}", "")}
                size={18}
              />
              <span className="truncate">{e.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <form onSubmit={submit} className="flex flex-1 items-center gap-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索…（按 / 聚焦）"
          className="h-11 border-transparent bg-transparent text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="搜索关键词"
          autoComplete="off"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11"
          aria-label="搜索"
        >
          <Search className="size-5" aria-hidden="true" />
        </Button>
      </form>
    </GlassCard>
  );
}
