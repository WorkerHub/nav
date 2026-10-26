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

  /** 启动探活：刷新后恢复登录态（pending → authenticated/anonymous） */
  bootstrapSession: () => Promise<void>;
  loadPublic: () => Promise<void>;
  loadAdmin: () => Promise<void>;
  /** 设置保存成功后就地替换 adminData.settings（主题等站点级设置保存即生效） */
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
    try {
      const data = await getPublic();
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
    try {
      const data = await adminListAll();
      set({ adminData: data });
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

  // 后端 PUT /api/admin/settings 返回保存后的完整设置：直接落进 store，
  // 让主题这类站点级设置「保存即生效」，不必等整轮 loadAdmin 重拉（重拉仍会兜底）。
  patchAdminSettings: (settings) =>
    set((s) => (s.adminData ? { adminData: { ...s.adminData, settings } } : s)),
}));

/** 组件里判「已登录」请用这个（单一真源 authStatus，避免出现与三态不一致的布尔字段）。 */
export function useAuthenticated(): boolean {
  return useNavStore((s) => s.authStatus === "authenticated");
}
