import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { getTablePrefix, type HonoEnv } from "../types";
import { applyMigrations } from "../lib/migrate";
import {
  TablePrefixConflictError,
  type MigrationResult,
} from "../lib/migrations-runner";
import {
  generateId,
  generateToken,
  hashPassword,
  safeEqual,
  verifyJWT,
  verifyPassword,
} from "../core/auth";
import {
  countUsers,
  createOwner,
  deleteSession,
  findSession,
  findUserById,
  findUserByUsername,
} from "../db/queries/users";
import {
  clearFailures,
  isLockedOut,
  purgeOldAttempts,
  recordAttempt,
  recordFailure,
  LOCKOUT_SECONDS,
  MAX_FAILED_ATTEMPTS,
} from "../core/login-attempts";
import {
  deleteChallenge,
  getChallenge,
  putChallenge,
} from "../core/challenges";
import { getSetting } from "../db/queries/settings";
import { setSetupPageEnabled } from "../services/setup";
import { verifyTOTP } from "../core/totp";
import { SESSION_COOKIE, unauthorized } from "../middleware/auth";
import { issueSession, clientIp } from "../services/session";
import { nowIso } from "../db/sql";

export const authRoutes = new Hono<HonoEnv>();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,64}$/;
const PENDING_LOGIN_TTL = 300;

// ─── Setup ───────────────────────────────────────────────────────────────────

/**
 * GET  /api/auth/setup — reports whether owner setup is still open.
 * POST /api/auth/setup — creates the single owner account (X-Setup-Secret).
 * After the owner exists, setup is permanently closed (SPEC §4); there is no
 * registration endpoint anywhere in this service.
 */
authRoutes.get("/setup", async (c) => {
  const prefix = getTablePrefix(c.env);
  const users = await countUsers(c.env.DB, prefix);
  return c.json({ enabled: users === 0 });
});

authRoutes.post("/setup", async (c) => {
  // Resolve the effective prefix before initialization (SPEC v1.4); a
  // malformed custom prefix rejects setup outright.
  let prefix: string;
  try {
    prefix = getTablePrefix(c.env);
  } catch {
    return c.json({ error: "invalid TABLE_PREFIX configuration" }, 500);
  }

  // Apply the ledgered migrations (creates {prefix}* tables on first setup) and
  // report each migration's outcome in the response. This is the initialisation
  // path, so it also ensures the default search engines exist (ONE-446).
  let migrations: MigrationResult[];
  try {
    migrations = (await applyMigrations(c.env, { seedDefaults: true }))
      .migrations;
  } catch (err) {
    if (err instanceof TablePrefixConflictError) {
      return c.json(
        { error: "table prefix conflict", detail: err.message },
        409,
      );
    }
    throw err;
  }

  const users = await countUsers(c.env.DB, prefix);
  if (users > 0) return c.json({ error: "setup already completed" }, 403);

  const secret = c.req.header("X-Setup-Secret");
  const expected = c.env.SETUP_SECRET;
  if (!expected || expected.endsWith("_PLACEHOLDER")) {
    return c.json({ error: "server misconfigured" }, 500);
  }
  if (!secret || !(await safeEqual(secret, expected))) {
    return c.json({ error: "invalid setup secret" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!USERNAME_RE.test(username))
    return c.json({ error: "invalid username" }, 400);
  if (password.length < 8)
    return c.json({ error: "password must be at least 8 characters" }, 400);

  const passwordHash = await hashPassword(password);
  await createOwner(c.env.DB, prefix, {
    id: generateId(),
    username,
    password_hash: passwordHash,
  });

  const created = await findUserByUsername(c.env.DB, prefix, username);
  if (!created) return c.json({ error: "setup failed" }, 500);

  // SETUP-PAGE-SPEC §3.4: completion closes the setup page by default (nav is a
  // single-user site). Routine upgrades go through the admin button; the secret
  // endpoints themselves stay reachable regardless of this switch.
  await setSetupPageEnabled(c.env, false, prefix);

  await issueSession(c, created.id);
  return c.json(
    {
      success: true,
      user: { id: created.id, username: created.username },
      tablePrefix: prefix,
      migrations: migrations.map((migration) => ({
        name: migration.name,
        status: migration.status,
      })),
    },
    201,
  );
});

// ─── Password login (step 1; TOTP step 2 when enabled) ───────────────────────

authRoutes.post("/login", async (c) => {
  const prefix = getTablePrefix(c.env);
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => ({}));
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password)
    return c.json({ error: "username and password required" }, 400);

  if (await isLockedOut(c.env.DB, prefix, username, ip)) {
    return c.json(
      {
        error: "too many failed attempts, try again later",
        lockedForSeconds: LOCKOUT_SECONDS,
      },
      429,
    );
  }

  await purgeOldAttempts(c.env.DB, prefix);

  const user = await findUserByUsername(c.env.DB, prefix, username);
  // Constant-ish work on unknown usernames so response timing doesn't reveal
  // whether the account exists (same pattern as eNotify).
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(
        password,
        "0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
      );

  if (!user || !valid || !user.is_active) {
    const result = await recordFailure(c.env.DB, prefix, {
      id: generateId(),
      username,
      ip,
    });
    return c.json(
      {
        error: "invalid credentials",
        remainingAttempts: result.remaining,
        ...(result.locked ? { lockedForSeconds: LOCKOUT_SECONDS } : {}),
      },
      401,
    );
  }

  await recordAttempt(c.env.DB, prefix, {
    id: generateId(),
    username,
    ip,
    success: true,
    lockUntil: null,
  });
  await clearFailures(c.env.DB, prefix, username);

  const totpEnabled =
    (await getSetting(c.env.DB, prefix, "totp_enabled")) === "1";
  if (totpEnabled) {
    const pendingId = generateToken(24);
    await putChallenge(c.env.DB, prefix, {
      id: `pending:${pendingId}`,
      kind: "pending_login",
      user_id: user.id,
      value: "password",
      ttlSeconds: PENDING_LOGIN_TTL,
    });
    return c.json({ requires2fa: true, tempToken: pendingId });
  }

  await issueSession(c, user.id);
  return c.json({
    success: true,
    user: { id: user.id, username: user.username },
  });
});

// ─── TOTP second factor (step 2) ─────────────────────────────────────────────

authRoutes.post("/2fa/verify", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  const tempToken = typeof body.tempToken === "string" ? body.tempToken : "";
  const code = typeof body.code === "string" ? body.code : "";

  if (!tempToken || !code)
    return c.json({ error: "tempToken and code required" }, 400);

  const pending = await getChallenge(
    c.env.DB,
    prefix,
    `pending:${tempToken}`,
    "pending_login",
  );
  if (!pending?.user_id)
    return c.json({ error: "invalid or expired session" }, 401);

  const secret = await getSetting(c.env.DB, prefix, "totp_secret");
  if (!secret) {
    await deleteChallenge(c.env.DB, prefix, `pending:${tempToken}`);
    return c.json({ error: "2fa not configured" }, 400);
  }

  const valid = await verifyTOTP(secret, code);
  if (!valid) {
    const failKey = `pending_fail:${tempToken}`;
    const failRow = await getChallenge(c.env.DB, prefix, failKey);
    const fails = Number(failRow?.value ?? "0") + 1;
    if (fails >= MAX_FAILED_ATTEMPTS) {
      await deleteChallenge(c.env.DB, prefix, `pending:${tempToken}`);
      await deleteChallenge(c.env.DB, prefix, failKey);
      return c.json({ error: "too many failed attempts" }, 429);
    }
    await putChallenge(c.env.DB, prefix, {
      id: failKey,
      kind: "pending_fail",
      value: String(fails),
      ttlSeconds: PENDING_LOGIN_TTL,
    });
    return c.json(
      {
        error: "invalid verification code",
        remainingAttempts: MAX_FAILED_ATTEMPTS - fails,
      },
      401,
    );
  }

  await deleteChallenge(c.env.DB, prefix, `pending:${tempToken}`);
  await deleteChallenge(c.env.DB, prefix, `pending_fail:${tempToken}`);

  const user = await findUserById(c.env.DB, prefix, pending.user_id);
  if (!user?.is_active) return c.json({ error: "user not found" }, 404);

  await issueSession(c, user.id);
  return c.json({
    success: true,
    user: { id: user.id, username: user.username },
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

authRoutes.post("/logout", async (c) => {
  const prefix = getTablePrefix(c.env);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const payload = await verifyJWT(token, c.env.SESSION_SECRET);
    if (payload) await deleteSession(c.env.DB, prefix, payload.sid);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ success: true });
});

// ─── Session probe (also the recovery entry point) ───────────────────────────

authRoutes.get("/session", async (c) => {
  const prefix = getTablePrefix(c.env);
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return unauthorized();

  const payload = await verifyJWT(token, c.env.SESSION_SECRET);
  if (!payload) return unauthorized();

  const session = await findSession(c.env.DB, prefix, payload.sid);
  if (!session || session.expires_at < nowIso()) return unauthorized();

  return c.json({ authenticated: true, userId: session.user_id });
});
