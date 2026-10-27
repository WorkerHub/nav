import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicPage } from "@/components/public-page";
import { useNavStore } from "@/lib/nav-store";
import type { SiteSettings } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  logoUrl: "",
  theme: "system",
  columns: 6,
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
