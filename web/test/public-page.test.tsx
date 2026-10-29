import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import type { SearchEngine, SiteSettings } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  logoUrl: "",
  theme: "system",
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
