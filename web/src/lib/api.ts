/**
 * 接口层：对接冻结契约 docs/api-contract.md（camelCase，端点 /api/auth/*、/api/admin/*）。
 *
 * 联调 mock 仅在开发环境动态加载（import.meta.env.DEV），生产构建时该分支被
 * 死代码消除，mockDb 及其占位数据（含示例私有域名）不会打入产物。
 */
import type {
  AdminCategory,
  AdminLink,
  AdminSystem,
  ImportCategory,
  PasskeyCredential,
  PrivateData,
  PublicData,
  SearchEngine,
  SetupOwnerResult,
  SetupResult,
  SetupState,
  SiteSettings,
  TotpSetup,
  TotpStatus,
} from "./types";

export const USE_MOCK = import.meta.env.DEV;

const API = {
  public: "/api/public",
  private: "/api/private",
  auth: "/api/auth",
  admin: "/api/admin",
  setup: "/api/setup",
  setupState: "/api/setup/state",
};

/** SETUP_SECRET 只走请求头（不进 URL、不进 localStorage、不打日志）。 */
const SETUP_SECRET_HEADER = "X-Setup-Secret";

/** 动态加载 dev mock（仅开发环境；生产构建死代码消除） */
async function devMock() {
  return import("./mockDb").then((m) => m.mockDb);
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** HTTP 失败：`status` 供调用方分支（403/409/429），`detail` 为后端原文（如前缀冲突说明）。 */
export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${path} failed: ${res.status}`;
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body?.error) message = body.error;
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, detail);
  }
  return (await res.json()) as T;
}

// ─── 站点数据 ────────────────────────────────────────────────────────────────

/** GET /api/public */
export async function getPublic(): Promise<PublicData> {
  if (USE_MOCK) return (await devMock()).getPublic();
  return request<PublicData>(API.public);
}

/** GET /api/private —— 未登录抛 UnauthorizedError（对应 401 JSON），响应 no-store */
export async function getPrivate(): Promise<PrivateData> {
  if (USE_MOCK) {
    const mock = await devMock();
    if (!mock.isLoggedIn()) throw new UnauthorizedError();
    return mock.getPrivate();
  }
  const res = await fetch(API.private, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let message = `${API.private} failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as PrivateData;
}

// ─── 鉴权（/api/auth/*）──────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true }
  | { requires2fa: true; tempToken: string };

/** GET /api/auth/session 的响应（契约 docs/api-contract.md） */
export interface SessionInfo {
  authenticated: true;
  userId: string;
}

/**
 * GET /api/auth/session —— 会话探活（刷新后恢复登录态的唯一入口）。
 *
 * 未登录 / Cookie 失效时后端返回 401 JSON，这里抛 UnauthorizedError，与 getPrivate
 * 的处理习惯一致；网络错误、超时与 5xx 抛 ApiError（status 0 表示请求未拿到响应），
 * 由调用方决定降级为未登录而不是把界面卡在加载态。
 */
export async function getSession(timeoutMs = 8000): Promise<SessionInfo> {
  if (USE_MOCK) {
    const mock = await devMock();
    if (!mock.isLoggedIn()) throw new UnauthorizedError();
    return { authenticated: true, userId: "mock-user" };
  }
  let res: Response;
  try {
    res = await fetch(`${API.auth}/session`, {
      credentials: "include",
      // GET 无请求体：只声明期望的响应类型（nit：不必带 Content-Type）
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ApiError(`session probe failed: ${(e as Error).message}`, 0);
  }
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let message = `${API.auth}/session failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as SessionInfo;
}

/** POST /api/auth/login —— 第一步：username + password；启用 TOTP 时返回 requires2fa */
export async function loginPassword(input: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  if (USE_MOCK) return (await devMock()).loginPassword(input);
  const res = await request<{
    success?: boolean;
    user?: unknown;
    requires2fa?: boolean;
    tempToken?: string;
  }>(`${API.auth}/login`, { method: "POST", body: JSON.stringify(input) });
  if (res.requires2fa && res.tempToken) {
    return { requires2fa: true, tempToken: res.tempToken };
  }
  return { ok: true };
}

/** POST /api/auth/2fa/verify —— 第二步：TOTP 校验（成功后下发会话） */
export async function verifyTotp(input: {
  tempToken: string;
  code: string;
}): Promise<void> {
  if (USE_MOCK) return (await devMock()).verifyTotp(input);
  await request(`${API.auth}/2fa/verify`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /api/auth/logout */
export async function logout(): Promise<void> {
  if (USE_MOCK) return (await devMock()).logout();
  await request(`${API.auth}/logout`, { method: "POST" });
}

// ─── Passkey（WebAuthn，/api/auth/passkey/*）──────────────────────────────────

interface AuthenticateOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: { id: string; type: "public-key" }[];
  userVerification?: string;
  timeout?: number;
  username?: string;
}

function b64urlToBuffer(input: string): ArrayBuffer {
  const pad = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Passkey 登录：options → navigator.credentials.get → verify */
export async function loginPasskey(username?: string): Promise<void> {
  if (USE_MOCK) return (await devMock()).loginPasskey();
  const options = await request<AuthenticateOptions>(
    `${API.auth}/passkey/authenticate/options`,
    { method: "POST", body: JSON.stringify(username ? { username } : {}) },
  );
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: b64urlToBuffer(options.challenge),
    rpId: options.rpId,
    allowCredentials: options.allowCredentials?.map((c) => ({
      id: b64urlToBuffer(c.id),
      type: "public-key" as const,
    })),
    userVerification: options.userVerification as
      | UserVerificationRequirement
      | undefined,
    timeout: options.timeout,
  };
  const credential = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("passkey cancelled");

  const assertion = credential.response as AuthenticatorAssertionResponse;
  await request(`${API.auth}/passkey/authenticate/verify`, {
    method: "POST",
    body: JSON.stringify({
      id: credential.id,
      rawId: bufferToB64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToB64url(assertion.clientDataJSON),
        authenticatorData: bufferToB64url(assertion.authenticatorData),
        signature: bufferToB64url(assertion.signature),
        userHandle: assertion.userHandle
          ? bufferToB64url(assertion.userHandle)
          : null,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    }),
  });
}

// ─── 两步验证管理（同属 /api/auth/passkey/*，需登录会话）──────────────────────
//
// 这一组刻意没有 dev mock（与 setup 三件套同口径）：TOTP secret 与 Passkey 凭据
// 是真实安全物，mock 出来的「已启用 / 已注册」只会在联调时骗人。开发时需连真实
// worker；未连时管理面显示错误态而非假数据。

export interface RegistrationOptionsJSON {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: { id: string; type: "public-key" }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

/**
 * Passkey 注册：POST register/options → navigator.credentials.create → register/verify。
 * WebAuthn 的 JSON ↔ 二进制转换沿用 loginPasskey 的现行手写模式（b64url ↔ ArrayBuffer），
 * 不额外引入 @simplewebauthn/browser。
 */
export async function registerPasskey(): Promise<{ credentialId: string }> {
  const options = await request<RegistrationOptionsJSON>(
    `${API.auth}/passkey/register/options`,
    { method: "POST", body: JSON.stringify({}) },
  );

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: b64urlToBuffer(options.challenge),
    rp: { id: options.rp.id, name: options.rp.name },
    user: {
      id: b64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    excludeCredentials: options.excludeCredentials?.map((c) => ({
      id: b64urlToBuffer(c.id),
      type: "public-key" as const,
    })),
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation,
  };

  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("passkey cancelled");

  const attestation = credential.response as AuthenticatorAttestationResponse;
  const transports = attestation.getTransports?.() ?? [];

  return request<{ credentialId: string }>(
    `${API.auth}/passkey/register/verify`,
    {
      method: "POST",
      body: JSON.stringify({
        id: credential.id,
        rawId: bufferToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToB64url(attestation.clientDataJSON),
          attestationObject: bufferToB64url(attestation.attestationObject),
          ...(transports.length > 0 ? { transports } : {}),
        },
        clientExtensionResults: credential.getClientExtensionResults(),
        ...(credential.authenticatorAttachment
          ? { authenticatorAttachment: credential.authenticatorAttachment }
          : {}),
      }),
    },
  );
}

/** GET /api/auth/passkey/credentials —— 当前账号的 Passkey 凭据列表 */
export async function listCredentials(): Promise<PasskeyCredential[]> {
  const res = await request<{ credentials: PasskeyCredential[] }>(
    `${API.auth}/passkey/credentials`,
    { cache: "no-store" },
  );
  return res.credentials;
}

/**
 * DELETE /api/auth/passkey/credentials ——
 * 后端（worker/src/routes/passkey.ts）实现是「清除该账号全部 Passkey」，没有按 id
 * 删除的端点，所以前端也没有单条删除入口（契约缺口已提在 ONE-447 评论）。
 */
export async function deleteCredentials(): Promise<void> {
  await request(`${API.auth}/passkey/credentials`, { method: "DELETE" });
}

/** GET /api/auth/passkey/totp —— 只读启用态 */
export async function getTotpStatus(): Promise<TotpStatus> {
  return request<TotpStatus>(`${API.auth}/passkey/totp`, {
    cache: "no-store",
  });
}

/**
 * POST /api/auth/passkey/totp/setup —— 取待确认的一次性 secret + otpauth URI。
 * 返回值只在本次设置流程的内存/组件状态里用，不写 localStorage、不打日志。
 */
export async function totpSetup(): Promise<TotpSetup> {
  return request<TotpSetup>(`${API.auth}/passkey/totp/setup`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** POST /api/auth/passkey/totp/enable —— 校验 6 位验证码并落地 secret */
export async function totpEnable(code: string): Promise<void> {
  await request(`${API.auth}/passkey/totp/enable`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/** POST /api/auth/passkey/totp/disable —— 需再输一次账号密码（后端校验 403） */
export async function totpDisable(password: string): Promise<void> {
  await request(`${API.auth}/passkey/totp/disable`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

// ─── 后台（/api/admin/*，各实体独立 CRUD）──────────────────────────────────────

export interface AdminData {
  categories: AdminCategory[];
  links: AdminLink[];
  searchEngines: SearchEngine[];
  settings: SiteSettings;
}

/** 各实体独立 GET（契约无 /api/admin/all） */
export async function adminListAll(): Promise<AdminData> {
  if (USE_MOCK) return (await devMock()).adminListAll();
  const [categories, links, searchEngines, settings] = await Promise.all([
    request<{ categories: AdminCategory[] }>(`${API.admin}/categories`),
    request<{ links: AdminLink[] }>(`${API.admin}/links`),
    request<{ searchEngines: SearchEngine[] }>(`${API.admin}/search-engines`),
    request<SiteSettings>(`${API.admin}/settings`),
  ]);
  return {
    categories: categories.categories,
    links: links.links,
    searchEngines: searchEngines.searchEngines,
    settings,
  };
}

// 分类
export async function adminCreateCategory(input: {
  name: string;
  icon?: string | null;
  sortOrder?: number;
  visibility?: "public" | "private";
}): Promise<AdminCategory> {
  if (USE_MOCK) return (await devMock()).createCategory(input);
  return request<AdminCategory>(`${API.admin}/categories`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function adminUpdateCategory(
  id: string,
  input: Partial<AdminCategory>,
): Promise<AdminCategory> {
  if (USE_MOCK) return (await devMock()).updateCategory(id, input);
  return request<AdminCategory>(`${API.admin}/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function adminDeleteCategory(id: string): Promise<void> {
  if (USE_MOCK) return (await devMock()).deleteCategory(id);
  await request(`${API.admin}/categories/${id}`, { method: "DELETE" });
}

export async function adminReorderCategories(ids: string[]): Promise<void> {
  if (USE_MOCK) return (await devMock()).reorderCategories(ids);
  await request(`${API.admin}/categories/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// 链接
export async function adminCreateLink(input: {
  title: string;
  url: string;
  categoryId: string;
  iconUrl?: string | null;
  description?: string | null;
  sortOrder?: number;
  visibility?: "public" | "private";
}): Promise<AdminLink> {
  if (USE_MOCK) return (await devMock()).createLink(input);
  return request<AdminLink>(`${API.admin}/links`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function adminUpdateLink(
  id: string,
  input: Partial<AdminLink>,
): Promise<AdminLink> {
  if (USE_MOCK) return (await devMock()).updateLink(id, input);
  return request<AdminLink>(`${API.admin}/links/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function adminDeleteLink(id: string): Promise<void> {
  if (USE_MOCK) return (await devMock()).deleteLink(id);
  await request(`${API.admin}/links/${id}`, { method: "DELETE" });
}

export async function adminReorderLinks(ids: string[]): Promise<void> {
  if (USE_MOCK) return (await devMock()).reorderLinks(ids);
  await request(`${API.admin}/links/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// 搜索引擎
export async function adminCreateEngine(input: {
  name: string;
  urlTemplate: string;
  icon?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
}): Promise<SearchEngine> {
  if (USE_MOCK) return (await devMock()).createEngine(input);
  return request<SearchEngine>(`${API.admin}/search-engines`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function adminUpdateEngine(
  id: string,
  input: Partial<SearchEngine>,
): Promise<SearchEngine> {
  if (USE_MOCK) return (await devMock()).updateEngine(id, input);
  return request<SearchEngine>(`${API.admin}/search-engines/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function adminDeleteEngine(id: string): Promise<void> {
  if (USE_MOCK) return (await devMock()).deleteEngine(id);
  await request(`${API.admin}/search-engines/${id}`, { method: "DELETE" });
}

export async function adminReorderEngines(ids: string[]): Promise<void> {
  if (USE_MOCK) return (await devMock()).reorderEngines(ids);
  await request(`${API.admin}/search-engines/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// 站点设置
export async function adminUpdateSettings(
  input: Partial<SiteSettings>,
): Promise<SiteSettings> {
  if (USE_MOCK) return (await devMock()).updateSettings(input);
  return request<SiteSettings>(`${API.admin}/settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ─── Setup 三件套（/api/setup/*、/api/auth/setup、/api/admin/system*）─────────
//
// 这里刻意没有 dev mock：setup 走真实数据库迁移与密钥校验，mock 出来只会掩盖
// 契约问题。开发时页面与系统管理区需连真实 worker（未连时显示错误态）。

/** GET /api/setup/state —— 页面形态状态机入口（无鉴权、no-store） */
export async function getSetupState(): Promise<SetupState> {
  return request<SetupState>(API.setupState, { cache: "no-store" });
}

/** POST /api/setup —— 密钥升级（只跑账本迁移，不建号/不改密码/不删表） */
export async function runSetupUpgrade(secret: string): Promise<SetupResult> {
  return request<SetupResult>(API.setup, {
    method: "POST",
    headers: { [SETUP_SECRET_HEADER]: secret },
    body: JSON.stringify({}),
  });
}

/** POST /api/auth/setup —— 未初始化形态：迁移 + 建唯一所有者 + 签发会话 */
export async function runOwnerSetup(input: {
  secret: string;
  username: string;
  password: string;
}): Promise<SetupOwnerResult> {
  return request<SetupOwnerResult>(`${API.auth}/setup`, {
    method: "POST",
    headers: { [SETUP_SECRET_HEADER]: input.secret },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
    }),
  });
}

/** POST /api/admin/setup —— 管理面免密钥升级（需会话） */
export async function adminRunSetup(): Promise<SetupResult> {
  return request<SetupResult>(`${API.admin}/setup`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** GET /api/admin/system —— 生效前缀 + setup 页面开关 + 账本已记录迁移 */
export async function adminGetSystem(): Promise<AdminSystem> {
  return request<AdminSystem>(`${API.admin}/system`, { cache: "no-store" });
}

/** PUT /api/admin/system/setup-page —— 开关只门控页面，不门控密钥接口 */
export async function adminSetSetupPage(
  enabled: boolean,
): Promise<{ setupPageEnabled: boolean }> {
  return request<{ setupPageEnabled: boolean }>(
    `${API.admin}/system/setup-page`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
}

// ─── 导入（前端解析 → 逐条经 admin CRUD 落库，契约无批量导入端点）──────────────

export async function adminImportCategories(
  categories: ImportCategory[],
): Promise<{ categoryCount: number; linkCount: number }> {
  if (USE_MOCK) return (await devMock()).importCategories(categories);
  let categoryCount = 0;
  let linkCount = 0;
  for (const cat of categories) {
    const created = await adminCreateCategory({
      name: cat.name,
      icon: cat.icon ?? null,
      visibility: cat.visibility ?? "public",
    });
    categoryCount++;
    for (const link of cat.links) {
      await adminCreateLink({
        title: link.title,
        url: link.url,
        categoryId: created.id,
        iconUrl: link.iconUrl ?? null,
        description: link.description ?? null,
        visibility: link.visibility ?? "public",
      });
      linkCount++;
    }
  }
  return { categoryCount, linkCount };
}

export async function adminImportEngines(
  engines: SearchEngine[],
): Promise<void> {
  if (USE_MOCK) return (await devMock()).importEngines(engines);
  for (const engine of engines) {
    await adminCreateEngine({
      name: engine.name,
      urlTemplate: engine.urlTemplate,
      icon: engine.icon,
      isDefault: engine.isDefault,
    });
  }
}
