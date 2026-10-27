/**
 * 联调 mock（仅开发环境动态加载，生产构建不打包本文件）：
 * 以 localStorage 持久化的内存库，形状与冻结契约 camelCase 一致。
 *
 * 安全验收口径：
 *  - getPublic() 只吐公开分类与公开链接（分类内嵌链接），无私有数据、不打码、不占位；
 *  - 未登录时 getPrivate() 抛 UnauthorizedError，私有数据不出现在任何返回里。
 */
import type {
  AdminCategory,
  AdminLink,
  PrivateData,
  PublicData,
  SearchEngine,
  SiteSettings,
  ImportCategory,
} from "./types";

const STORAGE_KEY = "nav.mock.db.v2";
const SESSION_KEY = "nav.mock.session";

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

interface MockState {
  categories: AdminCategory[];
  links: AdminLink[];
  searchEngines: SearchEngine[];
  settings: SiteSettings;
}

function makeLink(
  categoryId: string,
  title: string,
  url: string,
  sort: number,
  visibility: "public" | "private" = "public",
  iconUrl: string | null = null,
  description: string | null = null,
): AdminLink {
  return {
    id: uid(),
    categoryId,
    title,
    url,
    iconUrl,
    description,
    sortOrder: sort,
    visibility,
    createdAt: now(),
    updatedAt: now(),
  };
}

function seed(): MockState {
  const cat = (
    name: string,
    sort: number,
    visibility: "public" | "private" = "public",
  ): AdminCategory => ({
    id: uid(),
    name,
    icon: null,
    sortOrder: sort,
    visibility,
    createdAt: now(),
    updatedAt: now(),
  });

  const dev = cat("开发", 0);
  const daily = cat("日常", 1);
  const reading = cat("阅读", 2);
  const selfhost = cat("自托管服务", 3, "private");

  const links: AdminLink[] = [
    makeLink(dev.id, "GitHub", "https://github.com", 0),
    makeLink(dev.id, "MDN Web Docs", "https://developer.mozilla.org", 1),
    makeLink(dev.id, "Stack Overflow", "https://stackoverflow.com", 2),
    makeLink(dev.id, "Cloudflare Docs", "https://developers.cloudflare.com", 3),
    makeLink(daily.id, "Gmail", "https://mail.google.com", 0),
    makeLink(daily.id, "Google Calendar", "https://calendar.google.com", 1),
    makeLink(daily.id, "Google Drive", "https://drive.google.com", 2),
    makeLink(daily.id, "YouTube", "https://www.youtube.com", 3),
    makeLink(reading.id, "Hacker News", "https://news.ycombinator.com", 0),
    makeLink(reading.id, "少数派", "https://sspai.com", 1),
    makeLink(reading.id, "知乎", "https://www.zhihu.com", 2),
    makeLink(
      selfhost.id,
      "示例私有服务 A",
      "https://svc-a.internal.example",
      0,
      "private",
    ),
    makeLink(
      selfhost.id,
      "示例私有服务 B",
      "https://svc-b.internal.example",
      1,
      "private",
    ),
    makeLink(
      selfhost.id,
      "示例私有服务 C",
      "https://svc-c.internal.example",
      2,
      "private",
    ),
  ];

  return {
    categories: [dev, daily, reading, selfhost],
    links,
    searchEngines: [
      {
        id: uid(),
        name: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
        icon: null,
        sortOrder: 0,
        isDefault: true,
      },
      {
        id: uid(),
        name: "Bing",
        urlTemplate: "https://www.bing.com/search?q={q}",
        icon: null,
        sortOrder: 1,
        isDefault: false,
      },
      {
        id: uid(),
        name: "DuckDuckGo",
        urlTemplate: "https://duckduckgo.com/?q={q}",
        icon: null,
        sortOrder: 2,
        isDefault: false,
      },
      {
        id: uid(),
        name: "GitHub",
        urlTemplate: "https://github.com/search?q={q}",
        icon: null,
        sortOrder: 3,
        isDefault: false,
      },
    ],
    settings: {
      siteTitle: "我的导航",
      backgroundUrl:
        "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2400&q=80",
      logoUrl: "",
      theme: "system",
      columns: 8,
    },
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* fall through to seed */
  }
  const s = seed();
  persist(s);
  return s;
}

function persist(state: MockState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }) =>
  a.sortOrder - b.sortOrder;

/** 组装站点数据：分类内嵌可见链接（公开端点只含公开，私有端点含全量） */
function toSiteData(state: MockState, includePrivate: boolean): PublicData {
  const categories = state.categories
    .filter((c) => includePrivate || c.visibility === "public")
    .sort(bySort)
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      sortOrder: c.sortOrder,
      links: state.links
        .filter(
          (l) =>
            l.categoryId === c.id &&
            (includePrivate || l.visibility === "public"),
        )
        .sort(bySort)
        .map((l) => ({
          id: l.id,
          categoryId: l.categoryId,
          title: l.title,
          url: l.url,
          iconUrl: l.iconUrl,
          description: l.description,
          sortOrder: l.sortOrder,
        })),
    }));
  return {
    categories,
    searchEngines: [...state.searchEngines].sort(bySort),
    settings: state.settings,
  };
}

export const mockDb = {
  isLoggedIn(): boolean {
    return localStorage.getItem(SESSION_KEY) === "1";
  },

  async loginPassword(input: {
    username: string;
    password: string;
  }): Promise<{ requires2fa: true; tempToken: string } | { ok: true }> {
    if (!input.username || !input.password)
      throw new Error("username and password required");
    // mock：固定口令 nav1234（仅联调用，真实实现走后端）
    if (input.password !== "nav1234") throw new Error("invalid credentials");
    // mock：模拟已启用 TOTP，进入第二步
    return { requires2fa: true, tempToken: "mock-temp-token" };
  },

  async verifyTotp(input: { tempToken: string; code: string }): Promise<void> {
    if (input.tempToken !== "mock-temp-token" || input.code !== "123456") {
      throw new Error("invalid verification code");
    }
    localStorage.setItem(SESSION_KEY, "1");
  },

  async loginPasskey(): Promise<void> {
    localStorage.setItem(SESSION_KEY, "1");
  },

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
  },

  async getPublic(): Promise<PublicData> {
    return toSiteData(load(), false);
  },

  async getPrivate(): Promise<PrivateData> {
    if (!this.isLoggedIn()) throw new Error("unauthorized");
    return toSiteData(load(), true);
  },

  async adminListAll() {
    const state = load();
    return {
      categories: [...state.categories].sort(bySort),
      links: [...state.links].sort(bySort),
      searchEngines: [...state.searchEngines].sort(bySort),
      settings: state.settings,
    };
  },

  async createCategory(input: {
    name: string;
    icon?: string | null;
    sortOrder?: number;
    visibility?: "public" | "private";
  }): Promise<AdminCategory> {
    const state = load();
    const item: AdminCategory = {
      id: uid(),
      name: input.name ?? "未命名分类",
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? state.categories.length,
      visibility: input.visibility ?? "public",
      createdAt: now(),
      updatedAt: now(),
    };
    state.categories.push(item);
    persist(state);
    return item;
  },

  async updateCategory(
    id: string,
    input: Partial<AdminCategory>,
  ): Promise<AdminCategory> {
    const state = load();
    const item = state.categories.find((c) => c.id === id);
    if (!item) throw new Error("category not found");
    Object.assign(item, input, { updatedAt: now() });
    persist(state);
    return item;
  },

  async deleteCategory(id: string): Promise<void> {
    const state = load();
    state.categories = state.categories.filter((c) => c.id !== id);
    state.links = state.links.filter((l) => l.categoryId !== id);
    persist(state);
  },

  async reorderCategories(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const c = state.categories.find((x) => x.id === id);
      if (c) {
        c.sortOrder = index;
        c.updatedAt = now();
      }
    });
    persist(state);
  },

  async createLink(input: {
    title: string;
    url: string;
    categoryId: string;
    iconUrl?: string | null;
    description?: string | null;
    sortOrder?: number;
    visibility?: "public" | "private";
  }): Promise<AdminLink> {
    const state = load();
    const item: AdminLink = {
      id: uid(),
      categoryId: input.categoryId ?? state.categories[0]?.id ?? "",
      title: input.title ?? "未命名链接",
      url: input.url ?? "https://",
      iconUrl: input.iconUrl ?? null,
      description: input.description ?? null,
      sortOrder:
        input.sortOrder ??
        state.links.filter((l) => l.categoryId === input.categoryId).length,
      visibility: input.visibility ?? "public",
      createdAt: now(),
      updatedAt: now(),
    };
    state.links.push(item);
    persist(state);
    return item;
  },

  async updateLink(id: string, input: Partial<AdminLink>): Promise<AdminLink> {
    const state = load();
    const item = state.links.find((l) => l.id === id);
    if (!item) throw new Error("link not found");
    Object.assign(item, input, { updatedAt: now() });
    persist(state);
    return item;
  },

  async deleteLink(id: string): Promise<void> {
    const state = load();
    state.links = state.links.filter((l) => l.id !== id);
    persist(state);
  },

  async reorderLinks(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const l = state.links.find((x) => x.id === id);
      if (l) {
        l.sortOrder = index;
        l.updatedAt = now();
      }
    });
    persist(state);
  },

  async createEngine(input: {
    name: string;
    urlTemplate: string;
    icon?: string | null;
    sortOrder?: number;
    isDefault?: boolean;
  }): Promise<SearchEngine> {
    const state = load();
    const item: SearchEngine = {
      id: uid(),
      name: input.name ?? "新引擎",
      urlTemplate: input.urlTemplate ?? "https://example.com/search?q={q}",
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? state.searchEngines.length,
      isDefault: input.isDefault ?? false,
    };
    if (item.isDefault)
      state.searchEngines.forEach((e) => {
        e.isDefault = false;
      });
    state.searchEngines.push(item);
    persist(state);
    return item;
  },

  async updateEngine(
    id: string,
    input: Partial<SearchEngine>,
  ): Promise<SearchEngine> {
    const state = load();
    const item = state.searchEngines.find((e) => e.id === id);
    if (!item) throw new Error("engine not found");
    Object.assign(item, input);
    if (item.isDefault)
      state.searchEngines.forEach((e) => {
        e.isDefault = e.id === id;
      });
    persist(state);
    return item;
  },

  async deleteEngine(id: string): Promise<void> {
    const state = load();
    state.searchEngines = state.searchEngines.filter((e) => e.id !== id);
    persist(state);
  },

  async reorderEngines(ids: string[]): Promise<void> {
    const state = load();
    ids.forEach((id, index) => {
      const e = state.searchEngines.find((x) => x.id === id);
      if (e) {
        e.sortOrder = index;
      }
    });
    persist(state);
  },

  async updateSettings(input: Partial<SiteSettings>): Promise<SiteSettings> {
    const state = load();
    state.settings = { ...state.settings, ...input };
    persist(state);
    return state.settings;
  },

  /**
   * 上传资源（mock）：**不做任何真实上传**，只回一个明确标注 `mock-` 的占位路径，
   * 让上传后的回填/预览交互在 vite dev 里可点。真实链路（校验、大小限制、R2 落盘）
   * 必须用 `pnpm build:web` + `wrangler dev`（R2 本地模拟）验证。
   */
  async uploadAsset(
    file: File,
    purpose: "background" | "logo" | "icon",
  ): Promise<{ path: string }> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    return { path: `/assets/mock-${purpose}/${uid()}.${ext}` };
  },

  /** 删除资源（mock）：无对象可删，仅回成功（真实删除走 worker + R2）。 */
  async deleteAsset(_key: string): Promise<void> {
    return;
  },

  async importCategories(
    categories: ImportCategory[],
  ): Promise<{ categoryCount: number; linkCount: number }> {
    const state = load();
    let linkCount = 0;
    for (const cat of categories) {
      const created: AdminCategory = {
        id: uid(),
        name: cat.name,
        icon: cat.icon ?? null,
        sortOrder: state.categories.length,
        visibility: cat.visibility ?? "public",
        createdAt: now(),
        updatedAt: now(),
      };
      state.categories.push(created);
      for (const link of cat.links) {
        state.links.push({
          id: uid(),
          categoryId: created.id,
          title: link.title,
          url: link.url,
          iconUrl: link.iconUrl ?? null,
          description: link.description ?? null,
          sortOrder: state.links.filter((l) => l.categoryId === created.id)
            .length,
          visibility: link.visibility ?? "public",
          createdAt: now(),
          updatedAt: now(),
        });
        linkCount++;
      }
    }
    persist(state);
    return { categoryCount: categories.length, linkCount };
  },

  async importEngines(engines: SearchEngine[]): Promise<void> {
    const state = load();
    for (const engine of engines) {
      state.searchEngines.push({
        id: uid(),
        name: engine.name,
        urlTemplate: engine.urlTemplate,
        icon: engine.icon,
        sortOrder: state.searchEngines.length,
        isDefault: engine.isDefault,
      });
    }
    persist(state);
  },
};
