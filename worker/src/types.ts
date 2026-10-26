/**
 * Worker bindings. SESSION_SECRET / SETUP_SECRET are wrangler secrets (or local
 * env vars for `wrangler dev`) and are intentionally not declared in
 * wrangler.toml so they can never be committed.
 */
/**
 * Wrangler `vars` (non-secret). TABLE_PREFIX is injected at deploy time by
 * scripts/materialize-secrets.mjs; no [vars] table is committed.
 */
export interface Vars {
  /**
   * Table prefix (SPEC v1.4). Absent when unconfigured so the Worker falls
   * back to DEFAULT_TABLE_PREFIX; "" means an explicit no-prefix.
   */
  TABLE_PREFIX?: string;
}

export interface Env {
  DB: D1Database;
  /** Wrangler secret / local env var — never in wrangler.toml. */
  SESSION_SECRET: string;
  /** Wrangler secret / local env var — never in wrangler.toml. */
  SETUP_SECRET: string;
  ASSETS: Fetcher;
  /**
   * R2 bucket `nav-assets` for uploaded images (binding name `R2` — `ASSETS`
   * is already taken by Workers Static Assets). Absent in environments
   * without the binding; handlers must degrade to 503/404 accordingly.
   */
  R2: R2Bucket;
  /**
   * Table prefix (SPEC v1.4). Injected at deploy time; absent when
   * unconfigured so the Worker defaults to DEFAULT_TABLE_PREFIX.
   */
  TABLE_PREFIX?: string;
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
  /** Local upload path (`/assets/…`) or an external URL; "" when unset. */
  logoUrl: string;
  theme: string;
  /** 0–12; 0 means "unconfigured" (the consumer applies its default). */
  columns: number;
}

export interface SiteDataDto {
  categories: PublicCategoryDto[];
  searchEngines: SearchEngineDto[];
  settings: SiteSettingsDto;
}

// ─── Setup DTOs (SETUP-PAGE-SPEC §3.1/§3.2/§3.5) ─────────────────────────────

/** `GET /api/setup/state` (and its legacy `status` alias) — no secrets/hashes. */
export interface SetupStateDto {
  enabled: boolean;
  ownerExists: boolean;
  tablePrefix: string;
}

export interface SetupMigrationDto {
  name: string;
  status: "applied" | "skipped" | "error";
}

/** `POST /api/setup` and `POST /api/admin/setup` (identical shape). */
export interface SetupResultDto {
  success: true;
  tablePrefix: string;
  migrations: SetupMigrationDto[];
  ownerExists: boolean;
}

/** `GET /api/admin/system`. */
export interface AdminSystemDto {
  tablePrefix: string;
  setupPageEnabled: boolean;
  ledger: string[];
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

// ─── Table prefix (SPEC v1.4) ────────────────────────────────────────────────

/** Project default table prefix — the only hard-coded prefix allowed. */
export const DEFAULT_TABLE_PREFIX = "nav_";

/** Lowercase letters / digits / underscore; a trailing "_" is recommended. */
const TABLE_PREFIX_RE = /^[a-z0-9_]*$/;

export function isValidTablePrefix(prefix: string): boolean {
  return TABLE_PREFIX_RE.test(prefix);
}

/**
 * Three-state table prefix resolution (SPEC v1.4):
 * - undefined → DEFAULT_TABLE_PREFIX ("nav_") — shared-DB zero-config isolation
 * - ""        → "" (explicit no-prefix; deployer accepts collision risk)
 * - otherwise → validated custom prefix (throws when malformed)
 */
export function getTablePrefix(env: Env): string {
  const raw = env.TABLE_PREFIX;
  if (raw === undefined) return DEFAULT_TABLE_PREFIX;
  if (raw === "") return "";
  if (!isValidTablePrefix(raw)) {
    throw new Error(`invalid TABLE_PREFIX "${raw}": must match /^[a-z0-9_]*$/`);
  }
  return raw;
}

export const VALID_VISIBILITY = ["public", "private"] as const;
export type Visibility = (typeof VALID_VISIBILITY)[number];

export function isVisibility(value: unknown): value is Visibility {
  return (
    typeof value === "string" &&
    (VALID_VISIBILITY as readonly string[]).includes(value)
  );
}
