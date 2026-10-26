import { recordAttempt } from "./login-attempts";
import { generateId } from "./auth";

/**
 * Setup-secret throttle (§3.2): at most 3 `POST /api/setup` attempts per source
 * IP per 10 minutes → 429.
 *
 * Reuses the existing `{prefix}login_attempts` store instead of adding a table
 * or a framework: rows are keyed by a reserved pseudo-username namespace, so
 * they can never collide with a real account (`USERNAME_RE` forbids `:` and
 * caps length at 64) and never affect login lockout counters.
 *
 * An uninitialised database has no `login_attempts` table yet, so the limiter
 * falls back to a per-isolate in-memory window — brute force stays throttled
 * before the first migration has ever run.
 */
export const SETUP_RATE_LIMIT_MAX = 3;
export const SETUP_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

const WINDOW_MS = SETUP_RATE_LIMIT_WINDOW_SECONDS * 1000;
const SETUP_ATTEMPT_KEY_PREFIX = "__setup_rate__:";
const MEMORY_MAX_IPS = 500;

/** ip → attempt timestamps (ms), used only while the schema does not exist yet. */
const memoryAttempts = new Map<string, number[]>();

function attemptKey(ip: string): string {
  return `${SETUP_ATTEMPT_KEY_PREFIX}${ip}`;
}

function recentMemoryAttempts(ip: string, now: number): number[] {
  const recent = (memoryAttempts.get(ip) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  );
  if (recent.length > 0) memoryAttempts.set(ip, recent);
  else memoryAttempts.delete(ip);
  return recent;
}

function pruneMemory(now: number): void {
  if (memoryAttempts.size <= MEMORY_MAX_IPS) return;
  for (const ip of [...memoryAttempts.keys()]) {
    if (recentMemoryAttempts(ip, now).length === 0) {
      memoryAttempts.delete(ip);
    }
  }
}

/** True when this IP already spent its attempt budget for the window. */
export async function isSetupRateLimited(
  db: D1Database,
  prefix: string,
  ip: string,
): Promise<boolean> {
  const now = Date.now();
  try {
    const since = new Date(now - WINDOW_MS).toISOString();
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${prefix}login_attempts
         WHERE username = ? AND created_at > ?`,
      )
      .bind(attemptKey(ip), since)
      .first<{ n: number }>();
    return (row?.n ?? 0) >= SETUP_RATE_LIMIT_MAX;
  } catch {
    return recentMemoryAttempts(ip, now).length >= SETUP_RATE_LIMIT_MAX;
  }
}

/** Counts one attempt against the IP's budget (best-effort, never throws). */
export async function recordSetupAttempt(
  db: D1Database,
  prefix: string,
  ip: string,
): Promise<void> {
  const now = Date.now();
  try {
    await recordAttempt(db, prefix, {
      id: generateId(),
      username: attemptKey(ip),
      ip,
      success: true,
      lockUntil: null,
    });
  } catch {
    // Uninitialised database: keep the window in memory for this isolate.
    memoryAttempts.set(ip, [...recentMemoryAttempts(ip, now), now]);
    pruneMemory(now);
  }
}
