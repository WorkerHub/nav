import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminListAll,
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  type AdminData,
} from "@/lib/api";
import { useNavStore } from "@/lib/nav-store";
import type { AdminCategory, AdminLink, SearchEngine } from "@/lib/types";
import { deferred } from "./deferred";

// store 层乐观排序：只 mock 三个 reorder 请求与对账重拉，其余 api 保留真实实现。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminListAll: vi.fn(),
    adminReorderCategories: vi.fn(),
    adminReorderLinks: vi.fn(),
    adminReorderEngines: vi.fn(),
  };
});

const listAllMock = vi.mocked(adminListAll);
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

/** 以某个顺序构造服务端权威数据（模拟对账响应）。 */
function withCategoryOrder(
  data: AdminData,
  order: [string, string][],
): AdminData {
  return {
    ...data,
    categories: order.map(([id, name], index) => category(id, name, index)),
  };
}

function adminData(): AdminData {
  const data = useNavStore.getState().adminData;
  if (!data) throw new Error("store 里没有 adminData");
  return data;
}

/** 取某个实体数组的 (id, sortOrder) 快照，便于整体断言顺序重写。 */
function orderOf(key: "categories" | "links" | "searchEngines") {
  const list: { id: string; sortOrder: number }[] = adminData()[key];
  return list.map((item) => [item.id, item.sortOrder]);
}

beforeEach(() => {
  listAllMock.mockReset();
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
    const data = adminData();

    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    // 只改了 categories 这一片：其余切片还是同一引用（若 loadAdmin 重拉，会整份换新）
    const next = adminData();
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

    expect(adminData().categories).toEqual(before);
  });

  it("链接：接口失败回滚全量 links 顺序", async () => {
    reorderLinksMock.mockRejectedValue(new Error("网络错误"));
    const before = makeAdminData().links;

    await expect(
      useNavStore.getState().reorderLinks(["l4", "l3", "l2", "l1"]),
    ).rejects.toThrow("网络错误");

    expect(adminData().links).toEqual(before);
  });

  it("搜索引擎：接口失败回滚顺序", async () => {
    reorderEnginesMock.mockRejectedValue(new Error("网络错误"));
    const before = makeAdminData().searchEngines;

    await expect(
      useNavStore.getState().reorderEngines(["e2", "e1"]),
    ).rejects.toThrow("网络错误");

    expect(adminData().searchEngines).toEqual(before);
  });

  it("失败回滚只还原顺序：对账带来的新分类保留", async () => {
    const d = deferred();
    reorderCategoriesMock.mockReturnValue(d.promise);
    const pending = useNavStore
      .getState()
      .reorderCategories(["c3", "c1", "c2"]);

    // 请求在飞时对账落地：服务端顺序还是旧的，并且多了一个新分类 c4
    const reconciled: AdminData = {
      ...makeAdminData(),
      categories: [
        category("c1", "开发", 0),
        category("c2", "阅读", 1),
        category("c3", "日常", 2),
        category("c4", "新分类", 3),
      ],
    };
    listAllMock.mockResolvedValue(reconciled);
    await useNavStore.getState().loadAdmin();
    // 对账把在飞的那次排序重新套上（新分类同样保留）
    expect(adminData().categories.map((c) => c.id)).toEqual([
      "c3",
      "c1",
      "c2",
      "c4",
    ]);

    d.reject(new Error("网络错误"));
    await expect(pending).rejects.toThrow("网络错误");

    // 顺序回到操作前；对账新增的 c4 不被旧快照抹掉
    const after = adminData();
    expect(after.categories.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(after.categories.find((c) => c.id === "c4")?.name).toBe("新分类");
    expect(after.settings).toBe(reconciled.settings);
    expect(after.links).toBe(reconciled.links);
  });

  it("失败回滚只还原顺序：对账期间改的名字保留新值", async () => {
    const d = deferred();
    reorderCategoriesMock.mockReturnValue(d.promise);
    const pending = useNavStore
      .getState()
      .reorderCategories(["c3", "c1", "c2"]);

    listAllMock.mockResolvedValue({
      ...makeAdminData(),
      categories: [
        category("c1", "开发（改名）", 0),
        category("c2", "阅读", 1),
        category("c3", "日常", 2),
      ],
    });
    await useNavStore.getState().loadAdmin();
    expect(adminData().categories.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);

    d.reject(new Error("网络错误"));
    await expect(pending).rejects.toThrow("网络错误");

    const after = adminData();
    expect(after.categories.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(after.categories.find((c) => c.id === "c1")?.name).toBe(
      "开发（改名）",
    );
  });

  it("前一次失败不盖掉后一次已落库的排序（期间发生过对账）", async () => {
    const first = deferred();
    reorderCategoriesMock.mockReturnValueOnce(first.promise);
    const p1 = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    // 后一次排序成功：服务端权威顺序变成 c1,c3,c2
    reorderCategoriesMock.mockResolvedValueOnce(undefined);
    await useNavStore.getState().reorderCategories(["c1", "c3", "c2"]);

    // 后一次触发的对账落地（服务端顺序就是它写入的顺序）
    listAllMock.mockResolvedValue(
      withCategoryOrder(makeAdminData(), [
        ["c1", "开发"],
        ["c3", "日常"],
        ["c2", "阅读"],
      ]),
    );
    await useNavStore.getState().loadAdmin();
    expect(adminData().categories.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);

    first.reject(new Error("网络错误"));
    await expect(p1).rejects.toThrow("网络错误");

    // 停在服务端权威（后一次）顺序，不被前一次的 prev 盖回去
    expect(adminData().categories.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });

  it("本地顺序已被别处改写时，失败不再回滚", async () => {
    const d = deferred();
    reorderCategoriesMock.mockReturnValue(d.promise);
    const pending = useNavStore
      .getState()
      .reorderCategories(["c2", "c1", "c3"]);

    // 请求在飞时，本地顺序被改成另一种排列（已不是本次写入的顺序）
    useNavStore.setState({
      adminData: withCategoryOrder(makeAdminData(), [
        ["c1", "开发"],
        ["c3", "日常"],
        ["c2", "阅读"],
      ]),
    });

    d.reject(new Error("网络错误"));
    await expect(pending).rejects.toThrow("网络错误");

    // 不回滚：保持被改写后的顺序
    expect(adminData().categories.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });

  it("期间有更晚的排序成功时，前一次失败不去改它", async () => {
    const first = deferred();
    reorderCategoriesMock.mockReturnValueOnce(first.promise);
    const p1 = useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);

    reorderCategoriesMock.mockResolvedValueOnce(undefined);
    await useNavStore.getState().reorderCategories(["c1", "c3", "c2"]);
    expect(adminData().categories.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);

    first.reject(new Error("网络错误"));
    await expect(p1).rejects.toThrow("网络错误");

    // 后一次排序的结果保持不变
    expect(adminData().categories.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });
});

describe("store 对账时序：loadAdmin 不盖掉更晚的乐观排序", () => {
  it("对账请求在飞时又拖了一次：对账落地后仍是后一次的顺序", async () => {
    const reorder = deferred();
    reorderCategoriesMock.mockReturnValue(reorder.promise);
    const stale = deferred<AdminData>();
    listAllMock.mockReturnValue(stale.promise);

    // 先发出对账请求（此时服务端还是旧顺序）
    const loading = useNavStore.getState().loadAdmin();
    // 用户随即拖拽：乐观顺序已生效，排序请求仍在飞
    const reordering = useNavStore
      .getState()
      .reorderCategories(["c2", "c1", "c3"]);
    expect(orderOf("categories")).toEqual([
      ["c2", 0],
      ["c1", 1],
      ["c3", 2],
    ]);

    // 对账响应带着旧顺序落地：不能把用户刚做的排序盖回去
    stale.resolve(makeAdminData());
    await loading;
    expect(orderOf("categories")).toEqual([
      ["c2", 0],
      ["c1", 1],
      ["c3", 2],
    ]);

    reorder.resolve();
    await reordering;
  });

  it("上一次的对账晚到时，保留后一次已提交的排序；之后的对账正常接受服务端顺序", async () => {
    // 第一次排序成功（服务端只含这一次）
    reorderCategoriesMock.mockResolvedValue(undefined);
    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    const serverAfterFirst = withCategoryOrder(makeAdminData(), [
      ["c2", "阅读"],
      ["c1", "开发"],
      ["c3", "日常"],
    ]);

    // 第一次排序触发的对账请求发出（响应是「只含第一次」的旧数据）
    const stale = deferred<AdminData>();
    listAllMock.mockReturnValue(stale.promise);
    const loading = useNavStore.getState().loadAdmin();

    // 用户又拖了一次：乐观 + 请求成功，此时界面是第二次的顺序
    await useNavStore.getState().reorderCategories(["c1", "c2", "c3"]);
    expect(orderOf("categories")).toEqual([
      ["c1", 0],
      ["c2", 1],
      ["c3", 2],
    ]);

    // 旧响应落地：仍保持第二次的顺序（回弹不再被推迟）
    stale.resolve(serverAfterFirst);
    await loading;
    expect(orderOf("categories")).toEqual([
      ["c1", 0],
      ["c2", 1],
      ["c3", 2],
    ]);

    // 第二次排序之后发出的对账：正常接受服务端权威顺序
    const serverAfterSecond = withCategoryOrder(makeAdminData(), [
      ["c1", "开发"],
      ["c2", "阅读"],
      ["c3", "日常"],
    ]);
    listAllMock.mockResolvedValue(serverAfterSecond);
    await useNavStore.getState().loadAdmin();
    expect(orderOf("categories")).toEqual([
      ["c1", 0],
      ["c2", 1],
      ["c3", 2],
    ]);
  });

  it("对账发出前已 settle 的排序会被撤销登记，之后的对账照常覆盖", async () => {
    reorderCategoriesMock.mockResolvedValue(undefined);
    // 服务端顺序被别处改动（例如另一台设备）：对账应接受服务端顺序
    const serverOrder = withCategoryOrder(makeAdminData(), [
      ["c3", "日常"],
      ["c2", "阅读"],
      ["c1", "开发"],
    ]);
    listAllMock.mockResolvedValue(serverOrder);

    await useNavStore.getState().reorderCategories(["c2", "c1", "c3"]);
    await useNavStore.getState().loadAdmin();

    expect(orderOf("categories")).toEqual([
      ["c3", 0],
      ["c2", 1],
      ["c1", 2],
    ]);
  });
});

describe("store 乐观排序：后台数据未加载", () => {
  it("adminData 为空时静默返回：不发请求、不凭空造状态", async () => {
    useNavStore.setState({ adminData: null });
    reorderCategoriesMock.mockResolvedValue(undefined);

    await useNavStore.getState().reorderCategories(["c1"]);

    expect(reorderCategoriesMock).not.toHaveBeenCalled();
    expect(useNavStore.getState().adminData).toBeNull();
  });
});
