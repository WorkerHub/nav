-- nav database schema
-- All table names use {prefix} placeholder, replaced at runtime.
-- Idempotent: every statement is IF NOT EXISTS / OR IGNORE so the migration
-- can be re-run safely on an empty or already-initialized database.

CREATE TABLE IF NOT EXISTS {prefix}users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}passkey_credentials (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}passkey_credentials_user_id
  ON {prefix}passkey_credentials(user_id);

CREATE TABLE IF NOT EXISTS {prefix}sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES {prefix}users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_{prefix}sessions_user_id
  ON {prefix}sessions(user_id);

CREATE TABLE IF NOT EXISTS {prefix}login_attempts (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  ip           TEXT NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_{prefix}login_attempts_created_at
  ON {prefix}login_attempts(created_at);

CREATE TABLE IF NOT EXISTS {prefix}challenges (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  user_id    TEXT,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}challenges_expires_at
  ON {prefix}challenges(expires_at);

CREATE TABLE IF NOT EXISTS {prefix}categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}links (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES {prefix}categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  icon_url    TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  -- Reserved per SPEC §5, not implemented in v1: click counting and
  -- private-service health status.
  click_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT,
  last_checked_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_{prefix}links_category_id
  ON {prefix}links(category_id);

CREATE TABLE IF NOT EXISTS {prefix}search_engines (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  url_template TEXT NOT NULL,
  icon         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {prefix}settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO {prefix}settings (key, value, updated_at)
VALUES ('setup_completed', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
