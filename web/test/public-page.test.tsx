import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import type { SearchEngine, SiteCategory, SiteSettings } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  wallpaperSource: "bing",
  logoUrl: "",
  columns: 6,
  searchNewTab: true,
};

function seed(settings: SiteSettings) {
  useNavStore.setState({
    publicData: { categories: [], searchEngines: [], settings },
    privateData: null,
    authStatus: "anonymous",
    loginPromptOpen: false,
    loadPublic: async () => {},
    loadPrivate: async () => {},
  });
}

describe("PublicPage 头部：有 Logo 显示 Logo，无 Logo 显示标题文字", () => {
  beforeEach(() => {
    seed(baseSettings);
  });

  it("settings.logoUrl 有值：头部渲染 Logo 图（alt 取站点标题）", () => {
    seed({ ...baseSettings, logoUrl: "/assets/assets/logo/site.svg" });

    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1 });
    const logo = within(heading).getByRole("img", { name: "我的导航" });
    expect(logo).toHaveAttribute("src", "/assets/assets/logo/site.svg");
    expect(heading).toHaveTextContent("");
  });

  it("settings.logoUrl 为空：头部维持标题文字", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("我的导航");
    expect(within(heading).queryByRole("img")).toBeNull();
  });
});

describe("PublicPage 顶栏：整条毛玻璃 + 标题入栏 + 分类锚点栏已移除", () => {
  /** 两个分类各带链接：旧锚点栏在分类多时会横向溢出，现已整块移除。 */
  const categories: SiteCategory[] = [
    {
      id: "cat-dev",
      name: "开发",
      icon: null,
      sortOrder: 0,
      links: [
        {
          id: "link-1",
          categoryId: "cat-dev",
          title: "GitHub",
          url: "https://github.com/",
          iconUrl: null,
          description: null,
          sortOrder: 0,
        },
      ],
    },
    { id: "cat-read", name: "阅读", icon: null, sortOrder: 1, links: [] },
  ];

  beforeEach(() => {
    useNavStore.setState({
      publicData: { categories, searchEngines: [], settings: baseSettings },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
  });

  it("站点标题在顶栏（h1）内，顶栏整条毛玻璃", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    // 整条毛玻璃：glass-bar 提供半透明底 + backdrop-blur + 底部分隔线（web/src/index.css）
    expect(header).toHaveClass("glass-bar", "sticky", "top-0");

    const heading = screen.getByRole("heading", { level: 1 });
    expect(header?.contains(heading)).toBe(true);
    expect(heading).toHaveTextContent("我的导航");
  });

  it("不再渲染分类锚点栏，正文分类区块与链接照旧", () => {
    render(<PublicPage onOpenAdmin={vi.fn()} />);

    expect(
      screen.queryByRole("navigation", { name: "分类锚点" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "开发" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/",
    );
  });
});

describe("PublicPage：搜索跳转方式跟随站点设置 searchNewTab", () => {
  const engines: SearchEngine[] = [
    {
      id: "eng-google",
      name: "Google",
      urlTemplate: "https://www.google.com/search?q={q}",
      icon: null,
      sortOrder: 0,
      isDefault: true,
    },
  ];

  function seedWithEngines(settings: SiteSettings) {
    useNavStore.setState({
      publicData: { categories: [], searchEngines: engines, settings },
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
  }

  async function submitSearch() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("搜索关键词"), "nav{enter}");
  }

  it("searchNewTab=false：搜索在当前页跳转（不新开标签）", async () => {
    seedWithEngines({ ...baseSettings, searchNewTab: false });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const location = { href: "http://localhost/start" };
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: location as unknown as Location,
    });

    render(<PublicPage onOpenAdmin={vi.fn()} />);
    await submitSearch();

    expect(openSpy).not.toHaveBeenCalled();
    expect(location.href).toBe("https://www.google.com/search?q=nav");
  });

  it("设置缺该字段（存量库）时按默认开：新标签打开", async () => {
    seedWithEngines({ ...baseSettings, searchNewTab: undefined as never });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const location = { href: "http://localhost/start" };
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: location as unknown as Location,
    });

    render(<PublicPage onOpenAdmin={vi.fn()} />);
    await submitSearch();

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=nav",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.href).toBe("http://localhost/start");
  });
});

describe("PublicPage：壁纸来源解析（缺省 bing）", () => {
  /** 背景层是唯一的 aria-hidden 且带 backgroundImage 的 div。 */
  function backgroundLayer(container: HTMLElement): HTMLElement {
    const el = Array.from(
      container.querySelectorAll<HTMLElement>('div[aria-hidden="true"]'),
    ).find((d) => d.style.backgroundImage);
    if (!el) throw new Error("背景层未找到");
    return el;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("站点设置未到达（publicData 为 null）：不发起探针，背景层不指向端点", () => {
    useNavStore.setState({
      publicData: null,
      privateData: null,
      authStatus: "anonymous",
      loginPromptOpen: false,
      loadPublic: async () => {},
      loadPrivate: async () => {},
    });
    const imageSpy = vi.fn();
    vi.stubGlobal("Image", imageSpy);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    // 设置没回之前不应提前拉取整张大图。
    expect(imageSpy).not.toHaveBeenCalled();
    expect(backgroundLayer(container).style.backgroundImage).not.toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=bing（缺省）+ 无 backgroundUrl：背景层指向 /api/wallpaper/today", () => {
    seed(baseSettings);
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=custom + backgroundUrl 非空：背景层用 backgroundUrl", () => {
    seed({
      ...baseSettings,
      wallpaperSource: "custom",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    const bg = backgroundLayer(container).style.backgroundImage;
    expect(bg).toContain("https://cdn.example.com/bg.jpg");
    expect(bg).not.toContain("/api/wallpaper/today");
  });

  it("wallpaperSource=custom 但 backgroundUrl 为空：回落 /api/wallpaper/today", () => {
    seed({ ...baseSettings, wallpaperSource: "custom", backgroundUrl: "" });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("wallpaperSource=bing 但 backgroundUrl 非空：仍用 Bing（忽略自定义图）", () => {
    seed({
      ...baseSettings,
      wallpaperSource: "bing",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);
    expect(backgroundLayer(container).style.backgroundImage).toContain(
      "/api/wallpaper/today",
    );
  });

  it("bing 图加载失败：回落 backgroundUrl（非空）", async () => {
    seed({
      ...baseSettings,
      wallpaperSource: "bing",
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    await waitFor(() =>
      expect(backgroundLayer(container).style.backgroundImage).toContain(
        "https://cdn.example.com/bg.jpg",
      ),
    );
  });

  it("bing 图加载失败且无 backgroundUrl：去掉 url 层（纯色底）", async () => {
    seed({ ...baseSettings, wallpaperSource: "bing", backgroundUrl: "" });

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const { container } = render(<PublicPage onOpenAdmin={vi.fn()} />);

    await waitFor(() => {
      const bg = backgroundLayer(container).style.backgroundImage;
      expect(bg).not.toContain("/api/wallpaper/today");
      expect(bg).not.toContain("cdn.example.com");
    });
  });
});
