import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  type AdminData,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink, SearchEngine } from "@/lib/types";
import { deferred } from "./deferred";

// store 层乐观排序：只 mock 三个 reorder 请求，其余 api 保留真实实现（不被 import 期执行）。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminReorderCategories: vi.fn(),
    adminReorderLinks: vi.fn(),
    adminReorderEngines: vi.fn(),
  };
});

const reorderCategoriesMock = vi.mocked(adminReorderCategories);
const reorderLinksMock = vi.mocked(adminReorderLinks);
const reorderEnginesMock = vi.mocked(adminReorderEngines);

const stamp = "2026-11-06T00:00:00.000Z";

function category(id: string, name: string, sortOrder: number): AdminCategory {
  return {
    id,
    name,
    icon: null,
    sortOrder,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function link(
  id: string,
  categoryId: string,
  title: string,
  sortOrder: number,
): AdminLink {
  return {
    id,
    categoryId,
    title,
    url: `https://example.com/${id}`,
    iconUrl: null,
    description: null,
    sortOrder,
    visibility: "public",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function engine(id: string, name: string, sortOrder: number): SearchEngine {
  return {
    id,
    name,
    urlTemplate: `https://${id}.example.com/search?q={q}`,
    icon: null,
    sortOrder,
    isDefault: sortOrder === 0,
  };
}

function makeAdminData(): AdminData {
  return {
    categories: [
      category("c1", "开发", 0),
      category("c2", "阅读", 1),
      category("c3", "日常", 2),
    ],
    links: [
      link("l1", "c1", "GitHub", 0),
      link("l2", "c2", "少数派", 1),
      link("l3", "c2", "知乎", 2),
      link("l4", "c1", "MDN", 3),
    ],
    searchEngines: [engine("e1", "Google", 0), engine("e2", "Bing", 1)],
    settings: {
      siteTitle: "我的导航",
      backgroundUrl: "",
      wallpaperSource: "bing",
      logoUrl: "",
      columns: 6,
      searchNewTab: true,
    },
  };
}

/** 取某个实体数组的 (id, sortOrder) 快照，便于整体断言顺序重写。 */
function orderOf(
  key: keyof Pick<AdminData, "categories" | "links" | "searchEngines">,
) {
  return useNavStore
    .getState()
    .adminData![key].map((item) => [item.id, item.sortOrder]);
}

beforeEach(() => {
  reorderCategoriesMock.mockReset();
  reorderLinksMock.mockReset();
  reorderEnginesMock.mockReset();
  useNavStore.setState({ adminData: makeAdminData() });
});

describe("store 乐观排序：请求未返回时新顺序已生效", () => {
  it("分类：调用后同步重写 sortOrder 并按新顺序排列，不等 reorder 请求", () => {
    const d = deferred();
    reorderCategoriesMock.mockReturnValue(d.promise);

    // 故意不 await：模拟「松手瞬间 / 点按钮瞬间」
    const pending = useNavStore
      .getState()
      .reorderCategories(["c3", "c1", "c2"]);

    expect(orderOf("categories")).toEqual([
      ["c3", 0],
      ["c1", 1],
      ["c2", 2],
    ]);
    expect(reorderCategoriesMock).toHaveBeenCalledWith(["c3", "c1", "c2"]);
    expect(reorderCategoriesMock).toHaveBeenCalledTimes(1);

    d.resolve();
    return pending;
  });

  it("链接：按全局 ids 重写全量 links 的 sortOrder（跨分类同样生效）", () => {
    const d = deferred();
    reorderLinksMock.mockReturnValue(d.promise);

    const pending = useNavStore
      .getState()
      .reorderLinks(["l1", "l3", "l2", "l4"]);

    expect(orderOf("links")).toEqual([
      ["l1", 0],
      ["l3", 1],
      ["l2", 2],
      ["l4", 3],
    ]);
    expect(reorderLinksMock).toHaveBeenCalledWith(["l1", "l3", "l2", "l4"]);

    d.resolve();
    return pending;
  });

  it("搜索引擎：调用后同步重写 sortOrder 并按新顺序排列", () => {
    const d = deferred();
    reorderEnginesMock.mockReturnValue(d.promise);

    const pending = useNavStore.getState().reorderEngines(["e2", "e1"]);

    expect(orderOf("searchEngines")).toEqual([
      ["e2", 0],
      ["e1", 1],
    ]);

    d.resolve();
    return pending;
  });

  it("成功后不再自动重拉（对账仍由面板 onChanged 完成）", async () => {
    reorderCategoriesMock.mockResolvedValue(undefined);
    const data = useNavStore.getState().adminData!;

    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    // 只改了 categories 这一片：其余切片还是同一引用（若 loadAdmin 重拉，会整份换新）
    const next = useNavStore.getState().adminData!;
    expect(next.links).toBe(data.links);
    expect(next.searchEngines).toBe(data.searchEngines);
    expect(next.settings).toBe(data.settings);
    expect(orderOf("categories")).toEqual([
      ["c2", 0],
      ["c1", 1],
      ["c3", 2],
    ]);
  });
});

describe("store 乐观排序：失败回滚并抛出", () => {
  it("分类：接口失败回滚到操作前顺序，并 rethrow 供面板 toast", async () => {
    reorderCategoriesMock.mockRejectedValue(new Error("网络错误"));
    const before = makeAdminData().categories;

    await expect(
      useNavStore.getState().reorderCategories(["c3", "c2", "c1"]),
    ).rejects.toThrow("网络错误");

    expect(useNavStore.getState().adminData!.categories).toEqual(before);
  });

  it("链接：接口失败回滚全量 links 顺序", async () => {
    reorderLinksMock.mockRejectedValue(new Error("网络错误"));
    const before = makeAdminData().links;

    await expect(
      useNavStore.getState().reorderLinks(["l4", "l3", "l2", "l1"]),
    ).rejects.toThrow("网络错误");

    expect(useNavStore.getState().adminData!.links).toEqual(before);
  });

  it("搜索引擎：接口失败回滚顺序", async () => {
    reorderEnginesMock.mockRejectedValue(new Error("网络错误"));
    const before = makeAdminData().searchEngines;

    await expect(
      useNavStore.getState().reorderEngines(["e2", "e1"]),
    ).rejects.toThrow("网络错误");

    expect(useNavStore.getState().adminData!.searchEngines).toEqual(before);
  });

  it("失败时若对账数据已落地，不用旧快照盖掉新数据", async () => {
    const d = deferred();
    reorderCategoriesMock.mockReturnValue(d.promise);
    const pending = useNavStore
      .getState()
      .reorderCategories(["c3", "c1", "c2"]);

    // 请求在飞时 loadAdmin 对账落地（例如上一次操作的重拉）：替换成服务端权威数据
    const reconciled: AdminData = {
      ...makeAdminData(),
      categories: [
        category("c3", "日常", 0),
        category("c1", "开发", 1),
        category("c2", "阅读", 2),
        category("c4", "新分类", 3),
      ],
    };
    useNavStore.setState({ adminData: reconciled });

    d.reject(new Error("网络错误"));
    await expect(pending).rejects.toThrow("网络错误");

    expect(useNavStore.getState().adminData).toBe(reconciled);
  });
});

describe("store 乐观排序：后台数据未加载", () => {
  it("adminData 为空时仍发出请求，不凭空造状态", async () => {
    useNavStore.setState({ adminData: null });
    reorderCategoriesMock.mockResolvedValue(undefined);

    await useNavStore.getState().reorderCategories(["c1"]);

    expect(reorderCategoriesMock).toHaveBeenCalledWith(["c1"]);
    expect(useNavStore.getState().adminData).toBeNull();
  });
});
