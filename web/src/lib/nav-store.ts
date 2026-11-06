import { create } from "zustand";
import {
  getPrivate,
  getPublic,
  getSession,
  loginPasskey,
  loginPassword,
  logout as apiLogout,
  verifyTotp as apiVerifyTotp,
  adminListAll,
  adminReorderCategories,
  adminReorderEngines,
  adminReorderLinks,
  UnauthorizedError,
  ApiError,
  type AdminData,
  type LoginResult,
} from "@/lib/api";
import type {
  PrivateData,
  PublicData,
  SearchEngine,
  SiteSettings,
} from "@/lib/types";

/**
 * 登录态三态：
 * - `pending`：启动探活未回（未知）。此时既不能弹登录框，也不能渲染「未登录」UI。
 * - `authenticated`：`GET /api/auth/session` 通过，或本次已登录成功。
 * - `anonymous`：探活 401 / 会话失效 / 已登出。
 *
 * 唯一真源是后端会话（Cookie + sessions 表）：前端不持久化任何登录标志，
 * 刷新后靠探活恢复，禁止用 localStorage 冒充登录态。
 */
export type AuthStatus = "pending" | "authenticated" | "anonymous";

/** 探活与页面挂载可能同时触发 /api/private：同一个请求在飞时复用，不重复发。 */
let privateInFlight: Promise<void> | null = null;
/** 启动探活只做一次（StrictMode 双挂载 / 多次调用都复用同一个 Promise）。 */
let sessionProbe: Promise<void> | null = null;
/**
 * 站点设置的「本地写新」版本号：patchAdminSettings 每次 +1。两个作用 ——
 *  1. >0 时下一次 loadPublic 绕过 HTTP 缓存（后端 /api/public 是 `public, max-age=60`），
 *     否则「后台改完设置 → 返回公开页」会命中旧缓存，标题/背景图/主题又跳回旧值；
 *  2. >0 期间「写新之前发出、写新之后才回」的旧响应一律丢弃，不把新值盖回去。
 * 拉到服务端最新值后复归 0。
 */
let settingsRevision = 0;

/**
 * 回落未登录（anonymous）时一并清掉的会话期数据：私有区与后台数据都属于会话数据。
 * 进入 anonymous 的入口共 5 处，全部使用本常量，保证「anonymous ⇒ store 里没有任何会话数据」：
 * bootstrapSession 401 / bootstrapSession 网络错误降级 / loadPrivate 401 /
 * loadAdmin 401 / logout。新增入口时同样必须带上它（不得只清 privateData）。
 */
const NO_SESSION_DATA = { privateData: null, adminData: null } as const;

/**
 * 全局状态（Zustand）：登录态、公开数据、会话数据（私有区 + 后台数据）。
 * 会话数据仅在会话有效后进入 store；回落到 anonymous 时一律清空（见 NO_SESSION_DATA）。
 */
interface NavState {
  publicData: PublicData | null;
  privateData: PrivateData | null;
  authStatus: AuthStatus;
  loading: boolean;
  /** /api/private 返回 401 时置位，用于弹登录框 */
  loginPromptOpen: boolean;
  error: string | null;
  /** 后台数据（分类/链接/引擎/设置），登录后加载 */
  adminData: AdminData | null;

  /**
   * 乐观排序：按新 ids 立即重写本地 `sortOrder`（界面当场定住，不等网络），
   * 再发 reorder 请求；失败回滚到操作前顺序并抛出（由调用面板 toast）。
   * 成功后仍由调用方 `onChanged()` 整表重拉对账。
   */
  reorderCategories: (ids: string[]) => Promise<void>;
  reorderLinks: (ids: string[]) => Promise<void>;
  reorderEngines: (ids: string[]) => Promise<void>;

  /** 启动探活：刷新后恢复登录态（pending → authenticated/anonymous） */
  bootstrapSession: () => Promise<void>;
  loadPublic: () => Promise<void>;
  loadAdmin: () => Promise<void>;
  /** 设置保存成功后就地刷新 store 里所有存活的 settings 切片（三片原子更新） */
  patchAdminSettings: (settings: SiteSettings) => void;
  loadPrivate: () => Promise<void>;
  /** 密码登录第一步；返回 requires2fa 时由调用方进入 TOTP 第二步 */
  loginWithPassword: (
    username: string,
    password: string,
  ) => Promise<LoginResult>;
  verifyTotp: (tempToken: string, code: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
  setLoginPrompt: (open: boolean) => void;
  defaultEngine: () => SearchEngine | null;
}

/** store 里可排序的实体：都带 `id` 与 `sortOrder`。 */
type SortableRecord = { id: string; sortOrder: number };

/** 后台三类可排序实体在 `adminData` 里的切片名。 */
type AdminListKey = "categories" | "links" | "searchEngines";

const ADMIN_LIST_KEYS: AdminListKey[] = [
  "categories",
  "links",
  "searchEngines",
];

/**
 * 按新 ids 就地重写 `sortOrder`，并让数组本身也按新顺序排列。
 * 两个都要做：链接面板按 `sortOrder` 排序，分类 / 引擎面板直接按数组顺序渲染。
 * 调用方必须传**全量** ids（三个面板都是：分类 / 引擎是全量 entries，链接是重建后的
 * 全局 ids）；此时重写后各元素 sortOrder 互不相同，数组顺序即 ids 顺序。
 */
function applySortOrder<T extends SortableRecord>(
  list: T[],
  ids: string[],
): T[] {
  const orderById = new Map(ids.map((id, index) => [id, index]));
  return list
    .map((item) => {
      const next = orderById.get(item.id);
      return next === undefined ? item : { ...item, sortOrder: next };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 两个 id 序列是否完全一致。 */
function sameIdSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 失败回滚：只还原**顺序**，内容一律取当前值。
 *  - 本次排序涉及、当前仍存在的实体，按 `prev` 里的先后重新排列；
 *  - 其余实体（含对账期间新增的）保持当前顺序与内容；
 *  - 返回 null 表示当前顺序已不是本次写入的顺序（期间有更晚的排序改写了它），不回滚。
 * 只动顺序不动内容，才能让对账期间带回的新增 / 改名等变化不被旧快照撤销。
 */
function rollbackOrder<T extends SortableRecord>(
  current: T[],
  prev: T[],
  ids: string[],
): T[] | null {
  const idSet = new Set(ids);
  const currentIds = current
    .filter((item) => idSet.has(item.id))
    .map((item) => item.id);
  const existing = new Set(currentIds);
  // 本次写入的顺序就是 ids 顺序；期间被删掉的实体从两边一起消失
  if (
    !sameIdSequence(
      currentIds,
      ids.filter((id) => existing.has(id)),
    )
  ) {
    return null;
  }
  const prevIndex = new Map(prev.map((item, index) => [item.id, index]));
  const restored = current
    .filter((item) => idSet.has(item.id))
    .sort(
      (a, b) =>
        (prevIndex.get(a.id) ?? prev.length) -
        (prevIndex.get(b.id) ?? prev.length),
    );
  let cursor = 0;
  // 只替换本次涉及实体占用的位置：新增实体与其他实体原地不动
  const reordered = current.map((item) =>
    idSet.has(item.id) ? restored[cursor++] : item,
  );
  // 重编号 sortOrder，保持「数组顺序 = sortOrder」不变
  return reordered.map((item, index) => ({ ...item, sortOrder: index }));
}

/**
 * 在飞的乐观排序登记（按实体）。`loadAdmin` 是对账重拉，回来得可能比下一次拖拽晚：
 * 若它落地时整份覆盖，就会把「后一次」的乐观顺序盖回「前一次」——回弹只是被推迟。
 * 处理方式见 `reconcileAdminData`：对账落地时把「这份请求发出之后才 settle（或仍在飞）」
 * 的顺序重新套回新数据。请求失败会立即撤销登记。
 */
interface PendingOrder {
  ids: string[];
  /** settle 时刻的时钟值；null 表示请求仍在飞。 */
  settledAt: number | null;
}

/** 单调时钟：只用来比较「loadAdmin 发出」与「乐观排序 settle」的先后。 */
let adminClock = 0;

const pendingOrders: Record<AdminListKey, PendingOrder[]> = {
  categories: [],
  links: [],
  searchEngines: [],
};

/**
 * 把在飞的乐观排序叠加到对账数据上：
 *  - settle 早于本次请求发出的登记：服务端处理时已包含它，直接撤销；
 *  - 仍在飞 / 本请求发出后才 settle 的登记：响应是否包含它无法确定，一律保留并重新
 *    套上（即使已包含，重套同一顺序也无副作用）。
 * 这样对账只刷新与服务端同步的部分，不会把用户刚做的排序盖回旧顺序。
 */
function reconcileAdminData(data: AdminData, issuedAt: number): AdminData {
  for (const key of ADMIN_LIST_KEYS) {
    pendingOrders[key] = pendingOrders[key].filter(
      (pending) => pending.settledAt === null || pending.settledAt >= issuedAt,
    );
  }
  return {
    ...data,
    categories: pendingOrders.categories.reduce(
      (list, pending) => applySortOrder(list, pending.ids),
      data.categories,
    ),
    links: pendingOrders.links.reduce(
      (list, pending) => applySortOrder(list, pending.ids),
      data.links,
    ),
    searchEngines: pendingOrders.searchEngines.reduce(
      (list, pending) => applySortOrder(list, pending.ids),
      data.searchEngines,
    ),
  };
}

/**
 * 乐观排序的统一实现（分类 / 链接 / 引擎三者同构）：
 *  1. 同步写新顺序进 store（在首个 await 之前），面板立即重渲染；
 *  2. 发 reorder 请求；失败撤销登记、只把顺序还原到操作前并 rethrow，由面板 toast。
 * 不做重拉：成功后由面板 `onChanged()`（loadAdmin）对账，行为与现状一致。
 */
async function optimisticReorder<T extends SortableRecord>(
  key: AdminListKey,
  pick: (data: AdminData) => T[],
  put: (data: AdminData, list: T[]) => AdminData,
  request: (ids: string[]) => Promise<void>,
  ids: string[],
): Promise<void> {
  const data = useNavStore.getState().adminData;
  if (!data) {
    // 后台数据未加载：面板还没渲染（AdminPage 在 settings 就绪前只显示「加载中」），
    // 没有本地顺序可改，也没有可回滚的状态；按计划静默返回。
    return;
  }
  const entry: PendingOrder = { ids, settledAt: null };
  pendingOrders[key].push(entry);
  const prev = pick(data);
  const next = applySortOrder(prev, ids);
  useNavStore.setState({ adminData: put(data, next) });
  try {
    await request(ids);
    // 成功后登记仍保留：等「在这之后发出」的 loadAdmin 落地对账时才撤销；
    // 期间若有更早发出的对账数据回来，会用它把本次顺序重新套上（见 reconcileAdminData）。
    entry.settledAt = ++adminClock;
  } catch (e) {
    // 失败：撤销登记，并只把**顺序**还原到操作前；实体内容取当前值，
    // 对账期间带回的新增 / 改名等变化不会被旧快照撤销。
    const index = pendingOrders[key].indexOf(entry);
    // 登记按注册顺序排列：它后面还有登记，说明期间有更晚的排序，别去改它。
    const hasLater = index >= 0 && index < pendingOrders[key].length - 1;
    if (index >= 0) pendingOrders[key].splice(index, 1);
    const current = useNavStore.getState().adminData;
    if (!hasLater && current) {
      const rolledBack = rollbackOrder(pick(current), prev, ids);
      if (rolledBack) {
        useNavStore.setState({ adminData: put(current, rolledBack) });
      }
    }
    throw e;
  }
}

export const useNavStore = create<NavState>((set, get) => ({
  publicData: null,
  privateData: null,
  authStatus: "pending",
  loading: false,
  loginPromptOpen: false,
  error: null,
  adminData: null,

  bootstrapSession: () => {
    if (sessionProbe) return sessionProbe;
    sessionProbe = (async () => {
      try {
        await getSession();
        // 探活通过：直接进入已登录态，并拉取私有区
        set({ authStatus: "authenticated" });
        await get().loadPrivate();
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          // 无会话 / Cookie 失效：回落未登录（会话数据一并清掉）
          set({ authStatus: "anonymous", ...NO_SESSION_DATA });
          return;
        }
        // 网络错误 / 超时 / 5xx：降级为未登录，避免卡在 pending；
        // 此时不自动弹登录框（可能是后端暂时不可用），用户可手动点「登录」重试。
        set({
          authStatus: "anonymous",
          ...NO_SESSION_DATA,
          error: (e as Error).message,
        });
      }
    })();
    return sessionProbe;
  },

  loadPublic: async () => {
    set({ loading: true, error: null });
    // 快照当前版本：请求在飞时设置又被写新，这轮响应可能是旧值
    const revision = settingsRevision;
    try {
      const data = await getPublic(revision > 0 ? "no-store" : undefined);
      if (revision !== settingsRevision) {
        set({ loading: false });
        return;
      }
      settingsRevision = 0;
      set({ publicData: data, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  loadPrivate: () => {
    if (privateInFlight) return privateInFlight;
    const request = (async () => {
      try {
        const data = await getPrivate();
        set({
          privateData: data,
          authStatus: "authenticated",
          loginPromptOpen: false,
        });
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          // 会话失效：会话数据清空，回落未登录并弹登录
          set({
            ...NO_SESSION_DATA,
            authStatus: "anonymous",
            loginPromptOpen: true,
          });
          return;
        }
        set({ error: (e as Error).message });
      } finally {
        privateInFlight = null;
      }
    })();
    privateInFlight = request;
    return request;
  },

  loginWithPassword: async (username, password) => {
    const result = await loginPassword({ username, password });
    if ("ok" in result) {
      set({ authStatus: "authenticated", loginPromptOpen: false });
      await get().loadPrivate();
    }
    return result;
  },

  verifyTotp: async (tempToken, code) => {
    await apiVerifyTotp({ tempToken, code });
    set({ authStatus: "authenticated", loginPromptOpen: false });
    await get().loadPrivate();
  },

  loginWithPasskey: async () => {
    await loginPasskey();
    set({ authStatus: "authenticated", loginPromptOpen: false });
    await get().loadPrivate();
  },

  logout: async () => {
    await apiLogout();
    // 站内登出同样要清干净会话数据（私有区 + 后台数据），不能只清 privateData
    set({
      authStatus: "anonymous",
      ...NO_SESSION_DATA,
      loginPromptOpen: false,
    });
  },

  setLoginPrompt: (open) => set({ loginPromptOpen: open }),

  loadAdmin: async () => {
    // 发出时刻：对账响应可能比其后的一次排序更旧，落地时据此决定是否要把
    // 在飞的乐观顺序重新套上（见 reconcileAdminData）。
    const issuedAt = ++adminClock;
    try {
      const data = await adminListAll();
      set({ adminData: reconcileAdminData(data, issuedAt) });
    } catch (e) {
      // 会话失效（401）：后台页回落到未登录态，由 App 的 #admin 关口弹登录
      if (e instanceof ApiError && e.status === 401) {
        set({
          ...NO_SESSION_DATA,
          authStatus: "anonymous",
          loginPromptOpen: true,
        });
        return;
      }
      set({ error: (e as Error).message });
    }
  },

  defaultEngine: () => {
    const engines = get().publicData?.searchEngines ?? [];
    return engines.find((e) => e.isDefault) ?? engines[0] ?? null;
  },

  reorderCategories: (ids) =>
    optimisticReorder(
      "categories",
      (data) => data.categories,
      (data, categories) => ({ ...data, categories }),
      adminReorderCategories,
      ids,
    ),

  // ids 是**全局**链接顺序（契约 sort_order 全局）；面板负责重建全量 ids。
  reorderLinks: (ids) =>
    optimisticReorder(
      "links",
      (data) => data.links,
      (data, links) => ({ ...data, links }),
      adminReorderLinks,
      ids,
    ),

  reorderEngines: (ids) =>
    optimisticReorder(
      "searchEngines",
      (data) => data.searchEngines,
      (data, searchEngines) => ({ ...data, searchEngines }),
      adminReorderEngines,
      ids,
    ),

  // 后端 PUT /api/admin/settings 返回保存后的完整设置（权威响应）：原子刷新 store 里
  // **所有存活**的 settings 切片，而不是只刷 adminData：
  //  - publicData / privateData 是公开页真正消费的数据，只刷 adminData 会让「后台改站点
  //    标题/背景图 → 返回公开页」仍是旧值，必须刷新才生效；
  //  - 壁纸/标题等设置也从这两片读，登出 / 401 失效会清空 adminData 与 privateData，
  //    只刷 adminData 会让公开页回到旧值。（主题不在 settings 里，只跟本机偏好走。）
  // 未加载的切片保持原样（不凭空造数据）。新增 settings 写入口时同样必须走这里。
  patchAdminSettings: (settings) => {
    settingsRevision += 1;
    set((s) => ({
      ...(s.adminData ? { adminData: { ...s.adminData, settings } } : {}),
      ...(s.publicData ? { publicData: { ...s.publicData, settings } } : {}),
      ...(s.privateData ? { privateData: { ...s.privateData, settings } } : {}),
    }));
  },
}));

/** 组件里判「已登录」请用这个（单一真源 authStatus，避免出现与三态不一致的布尔字段）。 */
export function useAuthenticated(): boolean {
  return useNavStore((s) => s.authStatus === "authenticated");
}
