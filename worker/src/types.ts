/**
 * Worker bindings. SESSION_SECRET / SETUP_SECRET are wrangler secrets (or local
 * env vars for `wrangler dev`) and are intentionally not declared in
 * wrangler.toml so they can never be committed.
 */
/**
 * Wrangler `vars` (non-secret). Declared in wrangler.toml.
 */
export interface Vars {
  TABLE_PREFIX: string;
}

export interface Env {
  DB: D1Database;
  /** Wrangler secret / local env var — never in wrangler.toml. */
  SESSION_SECRET: string;
  /** Wrangler secret / local env var — never in wrangler.toml. */
  SETUP_SECRET: string;
  ASSETS: Fetcher;
  /** Legacy-style table prefix kept for parity with eNotify/Zeta deployments. */
  TABLE_PREFIX: string;
}

export interface HonoEnv {
  Bindings: Env;
  Variables: {
    userId: string;
  };
}

// ─── Row types ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  password_hash: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PasskeyCredential {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
}

export interface Link {
  id: string;
  category_id: string;
  title: string;
  url: string;
  icon_url: string | null;
  description: string | null;
  sort_order: number;
  visibility: "public" | "private";
  /** Reserved per SPEC §5, not implemented in v1. */
  click_count: number;
  /** Reserved per SPEC §5, not implemented in v1. */
  status: string | null;
  /** Reserved per SPEC §5, not implemented in v1. */
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchEngine {
  id: string;
  name: string;
  url_template: string;
  icon: string | null;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

// ─── Frozen API DTOs (camelCase, contract ONE-168) ───────────────────────────

export interface PublicCategoryDto {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  links: PublicLinkDto[];
}

export interface PublicLinkDto {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  iconUrl: string | null;
  description: string | null;
  sortOrder: number;
}

export interface SearchEngineDto {
  id: string;
  name: string;
  urlTemplate: string;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
}

export interface SiteSettingsDto {
  siteTitle: string;
  backgroundUrl: string;
  theme: string;
  columns: number;
}

export interface SiteDataDto {
  categories: PublicCategoryDto[];
  searchEngines: SearchEngineDto[];
  settings: SiteSettingsDto;
}

export interface JWTPayload {
  typ: "access";
  sub: string;
  jti: string;
  sid: string;
  iat: number;
  exp: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getTablePrefix(env: Env): string {
  return env.TABLE_PREFIX || "";
}

export const VALID_VISIBILITY = ["public", "private"] as const;
export type Visibility = (typeof VALID_VISIBILITY)[number];

export function isVisibility(value: unknown): value is Visibility {
  return (
    typeof value === "string" &&
    (VALID_VISIBILITY as readonly string[]).includes(value)
  );
}
