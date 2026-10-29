import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/search-bar";
import type { SearchEngine } from "@/lib/types";

/**
 * 搜索跳转方式（站点设置 `searchNewTab`，默认开）：
 *  - 开：`window.open(url, "_blank", "noopener,noreferrer")`，起始页与会话保留；
 *  - 关：沿用 `window.location.href` 当前页跳转。
 * 两种方式都在 submit 的公共分支里，切换引擎（含自定义引擎）后行为一致。
 */

const google: SearchEngine = {
  id: "eng-google",
  name: "Google",
  urlTemplate: "https://www.google.com/search?q={q}",
  icon: null,
  sortOrder: 0,
  isDefault: true,
};

const custom: SearchEngine = {
  id: "eng-custom",
  name: "自建搜索",
  urlTemplate: "https://search.example.com/?wd={q}&lang=zh",
  icon: null,
  sortOrder: 1,
  isDefault: false,
};

const engines = [google, custom];

/** jsdom 不实现真实导航：把 location 换成可读 href 的桩，断言跳转目标。 */
function stubLocation() {
  const location = { href: "http://localhost/start" };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: location as unknown as Location,
  });
  return location;
}

let openSpy: ReturnType<typeof vi.spyOn>;
let location: { href: string };

beforeEach(() => {
  location = stubLocation();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

async function search(query: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("搜索关键词"), `${query}{enter}`);
}

async function switchEngine(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /当前搜索引擎/ }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("SearchBar 跳转方式：默认新标签打开", () => {
  it("回车在新标签页打开，当前页不动（noopener,noreferrer）", async () => {
    render(<SearchBar engines={engines} />);

    await search("react hooks");

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=react%20hooks",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.href).toBe("http://localhost/start");
  });

  it("显式 openInNewTab={true} 同为新标签打开", async () => {
    render(<SearchBar engines={engines} openInNewTab />);

    await search("nav");

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=nav",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.href).toBe("http://localhost/start");
  });

  it("切换引擎后仍是新标签打开，且用该引擎的模板", async () => {
    render(<SearchBar engines={engines} />);

    await switchEngine("自建搜索");
    await search("nav 导航");

    expect(openSpy).toHaveBeenCalledWith(
      "https://search.example.com/?wd=nav%20%E5%AF%BC%E8%88%AA&lang=zh",
      "_blank",
      "noopener,noreferrer",
    );
    expect(location.href).toBe("http://localhost/start");
  });
});

describe("SearchBar 跳转方式：关闭开关后当前页跳转", () => {
  it("回车在当前页跳转，不新开标签", async () => {
    render(<SearchBar engines={engines} openInNewTab={false} />);

    await search("react hooks");

    expect(openSpy).not.toHaveBeenCalled();
    expect(location.href).toBe("https://www.google.com/search?q=react%20hooks");
  });

  it("切换引擎后仍是当前页跳转，且用该引擎的模板", async () => {
    render(<SearchBar engines={engines} openInNewTab={false} />);

    await switchEngine("自建搜索");
    await search("nav 导航");

    expect(openSpy).not.toHaveBeenCalled();
    expect(location.href).toBe(
      "https://search.example.com/?wd=nav%20%E5%AF%BC%E8%88%AA&lang=zh",
    );
  });
});

describe("SearchBar 边界：空查询", () => {
  it("空查询 / 纯空格不跳转、不新开标签", async () => {
    render(<SearchBar engines={engines} />);

    await search("   ");

    expect(openSpy).not.toHaveBeenCalled();
    expect(location.href).toBe("http://localhost/start");
  });
});
