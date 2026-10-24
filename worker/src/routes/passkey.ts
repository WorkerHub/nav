import { Hono } from "hono";
import { getTablePrefix, type HonoEnv } from "../types";
import { generateId, verifyPassword } from "../core/auth";
import {
  deletePasskeys,
  findPasskey,
  findUserById,
  insertPasskey,
  listPasskeys,
  updatePasskeyCounter,
} from "../db/queries/users";
import {
  deleteChallenge,
  getChallenge,
  putChallenge,
} from "../core/challenges";
import {
  clearFailures,
  isLockedOut,
  recordAttempt,
  recordFailure,
  LOCKOUT_SECONDS,
} from "../core/login-attempts";
import { generateTOTPSecret, verifyTOTP } from "../core/totp";
import { getSetting, setSetting } from "../db/queries/settings";
import { authMiddleware } from "../middleware/auth";
import { issueSession, clientIp } from "../services/session";

export const webauthnRoutes = new Hono<HonoEnv>();

const CHALLENGE_TTL = 300;
const CHALLENGE_PREFIX = "webauthn_auth";

function rpId(c: { req: { url: string } }): string {
  return new URL(c.req.url).hostname;
}

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const binary = atob(pad ? padded + "=".repeat(4 - pad) : padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function ownerUsername(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT username FROM ${prefix}users WHERE id = ?`)
    .bind(userId)
    .first<{ username: string }>();
  return row?.username ?? "";
}

// ─── Registration options (login required) ───────────────────────────────────

webauthnRoutes.post("/register/options", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const userId = c.get("userId");
  const user = await findUserById(c.env.DB, prefix, userId);
  if (!user) return c.json({ error: "user not found" }, 404);

  const { generateRegistrationOptions } = await import(
    "@simplewebauthn/server"
  );
  const existing = await listPasskeys(c.env.DB, prefix, userId);

  const options = await generateRegistrationOptions({
    rpName: "nav",
    rpID: rpId(c),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    excludeCredentials: existing.map((cred) => ({
      id: cred.id,
      type: "public-key" as const,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await putChallenge(c.env.DB, prefix, {
    id: `webauthn_reg:${userId}`,
    kind: "webauthn_reg",
    user_id: userId,
    value: options.challenge,
    ttlSeconds: CHALLENGE_TTL,
  });

  return c.json(options);
});

// ─── Registration verify (login required) ────────────────────────────────────

webauthnRoutes.post("/register/verify", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));

  const challenge = await getChallenge(
    c.env.DB,
    prefix,
    `webauthn_reg:${userId}`,
    "webauthn_reg",
  );
  if (!challenge) return c.json({ error: "no pending challenge" }, 400);

  const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
  const verification = await verifyRegistrationResponse({
    response: body as never,
    expectedChallenge: challenge.value,
    expectedOrigin: origin(c),
    expectedRPID: rpId(c),
  });

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "verification failed" }, 400);
  }

  const { credential } = verification.registrationInfo;
  await insertPasskey(c.env.DB, prefix, {
    id: credential.id,
    user_id: userId,
    public_key: toBase64Url(credential.publicKey),
    counter: credential.counter,
  });

  await deleteChallenge(c.env.DB, prefix, `webauthn_reg:${userId}`);
  return c.json({ success: true, credentialId: credential.id });
});

// ─── Authentication options (login, no session required) ─────────────────────

webauthnRoutes.post("/authenticate/options", async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  const username =
    typeof body.username === "string" ? body.username.trim() : "";

  // Single-owner system: resolve the one account, by username when given.
  let userId: string | null = null;
  if (username) {
    const { findUserByUsername } = await import("../db/queries/users");
    const user = await findUserByUsername(c.env.DB, prefix, username);
    userId = user?.id ?? null;
  } else {
    const row = await c.env.DB.prepare(
      `SELECT id FROM ${prefix}users LIMIT 1`,
    ).first<{ id: string }>();
    userId = row?.id ?? null;
  }
  if (!userId) return c.json({ error: "no passkeys registered" }, 400);

  const creds = await listPasskeys(c.env.DB, prefix, userId);
  if (creds.length === 0)
    return c.json({ error: "no passkeys registered" }, 400);

  const { generateAuthenticationOptions } = await import(
    "@simplewebauthn/server"
  );
  const options = await generateAuthenticationOptions({
    rpID: rpId(c),
    allowCredentials: creds.map((cred) => ({
      id: cred.id,
      type: "public-key" as const,
    })),
    userVerification: "preferred",
  });

  await putChallenge(c.env.DB, prefix, {
    id: `${CHALLENGE_PREFIX}:${userId}`,
    kind: CHALLENGE_PREFIX,
    user_id: userId,
    value: options.challenge,
    ttlSeconds: CHALLENGE_TTL,
  });

  return c.json({ ...options, username: username || undefined });
});

// ─── Authentication verify (login, no session required) ──────────────────────

webauthnRoutes.post("/authenticate/verify", async (c) => {
  const prefix = getTablePrefix(c.env);
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => ({}));

  const credentialId = typeof body.id === "string" ? body.id : "";
  if (!credentialId) return c.json({ error: "credential id required" }, 400);

  const stored = await findPasskey(c.env.DB, prefix, credentialId);
  if (!stored) return c.json({ error: "unknown credential" }, 401);

  const username = await ownerUsername(c.env.DB, prefix, stored.user_id);
  if (await isLockedOut(c.env.DB, prefix, username, ip)) {
    return c.json(
      {
        error: "too many failed attempts, try again later",
        lockedForSeconds: LOCKOUT_SECONDS,
      },
      429,
    );
  }

  const challenge = await getChallenge(
    c.env.DB,
    prefix,
    `${CHALLENGE_PREFIX}:${stored.user_id}`,
    CHALLENGE_PREFIX,
  );
  if (!challenge) return c.json({ error: "no pending challenge" }, 400);

  const { verifyAuthenticationResponse } = await import(
    "@simplewebauthn/server"
  );
  const verification = await verifyAuthenticationResponse({
    response: body as never,
    expectedChallenge: challenge.value,
    expectedOrigin: origin(c),
    expectedRPID: rpId(c),
    credential: {
      id: stored.id,
      publicKey: fromBase64Url(
        stored.public_key,
      ) as unknown as Uint8Array<ArrayBuffer>,
      counter: stored.counter,
    },
  });

  await deleteChallenge(
    c.env.DB,
    prefix,
    `${CHALLENGE_PREFIX}:${stored.user_id}`,
  );

  if (!verification.verified) {
    const result = await recordFailure(c.env.DB, prefix, {
      id: generateId(),
      username,
      ip,
    });
    return c.json(
      {
        error: "verification failed",
        remainingAttempts: result.remaining,
        ...(result.locked ? { lockedForSeconds: LOCKOUT_SECONDS } : {}),
      },
      401,
    );
  }

  await updatePasskeyCounter(
    c.env.DB,
    prefix,
    stored.id,
    verification.authenticationInfo.newCounter,
  );
  await recordAttempt(c.env.DB, prefix, {
    id: generateId(),
    username,
    ip,
    success: true,
    lockUntil: null,
  });
  // Clear stale failure counters so old failures can't contribute to a lockout.
  await clearFailures(c.env.DB, prefix, username);

  const user = await findUserById(c.env.DB, prefix, stored.user_id);
  if (!user?.is_active) return c.json({ error: "account disabled" }, 403);

  await issueSession(c, user.id);
  return c.json({
    success: true,
    user: { id: user.id, username: user.username },
  });
});

// ─── Passkey management (login required) ─────────────────────────────────────

webauthnRoutes.get("/credentials", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const creds = await listPasskeys(c.env.DB, prefix, c.get("userId"));
  return c.json({
    credentials: creds.map((cred) => ({
      id: cred.id,
      counter: cred.counter,
      createdAt: cred.created_at,
    })),
  });
});

webauthnRoutes.delete("/credentials", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  await deletePasskeys(c.env.DB, prefix, c.get("userId"));
  return c.json({ success: true });
});

// ─── TOTP management (login required) ────────────────────────────────────────

webauthnRoutes.get("/totp", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const enabled = (await getSetting(c.env.DB, prefix, "totp_enabled")) === "1";
  return c.json({ enabled });
});

webauthnRoutes.post("/totp/setup", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const userId = c.get("userId");
  const { secret, uri } = generateTOTPSecret();

  await putChallenge(c.env.DB, prefix, {
    id: `totp_setup:${userId}`,
    kind: "totp_setup",
    user_id: userId,
    value: secret,
    ttlSeconds: 600,
  });

  return c.json({ secret, uri });
});

webauthnRoutes.post("/totp/enable", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return c.json({ error: "code required" }, 400);

  const setup = await getChallenge(
    c.env.DB,
    prefix,
    `totp_setup:${userId}`,
    "totp_setup",
  );
  if (!setup) return c.json({ error: "no pending totp setup" }, 400);

  const valid = await verifyTOTP(setup.value, code);
  if (!valid) return c.json({ error: "invalid code" }, 400);

  await setSetting(c.env.DB, prefix, "totp_secret", setup.value);
  await setSetting(c.env.DB, prefix, "totp_enabled", "1");
  await deleteChallenge(c.env.DB, prefix, `totp_setup:${userId}`);

  return c.json({ success: true });
});

webauthnRoutes.post("/totp/disable", authMiddleware, async (c) => {
  const prefix = getTablePrefix(c.env);
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const userId = c.get("userId");
  const user = await findUserById(c.env.DB, prefix, userId);
  if (!user) return c.json({ error: "user not found" }, 404);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: "password is incorrect" }, 403);

  await setSetting(c.env.DB, prefix, "totp_enabled", "0");
  await setSetting(c.env.DB, prefix, "totp_secret", "");
  return c.json({ success: true });
});
