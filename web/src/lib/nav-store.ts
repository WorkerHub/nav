import { create } from "zustand";
import {
  getPrivate,
  getPublic,
  loginPasskey,
  loginPassword,
  logout as apiLogout,
  verifyTotp as apiVerifyTotp,
  adminListAll,
  UnauthorizedError,
  type AdminData,
  type LoginResult,
} from "@/lib/api";
import type { PrivateData, PublicData, SearchEngine } from "@/lib/types";

/**
 * 全局状态（Zustand）：登录态、公开数据、私有数据。
 * 私有数据仅在登录成功后进入 store；未登录时 store 里没有私有区。
 */
interface NavState {
  publicData: PublicData | null;
  privateData: PrivateData | null;
  authenticated: boolean;
  loading: boolean;
  /** /api/private 返回 401 时置位，用于弹登录框 */
  loginPromptOpen: boolean;
  error: string | null;
  /** 后台数据（分类/链接/引擎/设置），登录后加载 */
  adminData: AdminData | null;

  loadPublic: () => Promise<void>;
  loadAdmin: () => Promise<void>;
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
  authenticated: false,
  loading: false,
  loginPromptOpen: false,
  error: null,
  adminData: null,

  loadPublic: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getPublic();
      set({ publicData: data, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  loadPrivate: async () => {
    try {
      const data = await getPrivate();
      set({ privateData: data, authenticated: true, loginPromptOpen: false });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        // 未登录：私有数据清空，弹登录
        set({ privateData: null, authenticated: false, loginPromptOpen: true });
        return;
      }
      set({ error: (e as Error).message });
    }
  },

  loginWithPassword: async (username, password) => {
    const result = await loginPassword({ username, password });
    if ("ok" in result) {
      set({ authenticated: true, loginPromptOpen: false });
      await get().loadPrivate();
    }
    return result;
  },

  verifyTotp: async (tempToken, code) => {
    await apiVerifyTotp({ tempToken, code });
    set({ authenticated: true, loginPromptOpen: false });
    await get().loadPrivate();
  },

  loginWithPasskey: async () => {
    await loginPasskey();
    set({ authenticated: true, loginPromptOpen: false });
    await get().loadPrivate();
  },

  logout: async () => {
    await apiLogout();
    set({ authenticated: false, privateData: null });
  },

  setLoginPrompt: (open) => set({ loginPromptOpen: open }),

  loadAdmin: async () => {
    try {
      const data = await adminListAll();
      set({ adminData: data });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  defaultEngine: () => {
    const engines = get().publicData?.searchEngines ?? [];
    return engines.find((e) => e.isDefault) ?? engines[0] ?? null;
  },
}));
