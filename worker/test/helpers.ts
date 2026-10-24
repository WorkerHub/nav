import { DatabaseSync } from "node:sqlite";
import type { Env } from "../src/types";

/**
 * Minimal D1 stand-in backed by a real in-memory SQLite database (node:sqlite).
 * Keeps real column defaults/constraints so schema + query behaviour can be
 * verified against actual SQL semantics.
 */
export class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");
  queries: string[] = [];

  prepare(sql: string): any {
    const db = this.db;
    this.queries.push(sql);
    const statement = () => db.prepare(sql);

    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() =>
          (statement().get(...(args as any[])) ?? null) as T | null,
        all: async <T>() => ({
          results: statement().all(...(args as any[])) as T[],
        }),
        run: async () => {
          statement().run(...(args as any[]));
          return { success: true };
        },
      }),
      first: async <T>() => (statement().get() ?? null) as T | null,
      all: async <T>() => ({ results: statement().all() as T[] }),
      run: async () => {
        statement().run();
        return { success: true };
      },
    };
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: new SqliteD1() as unknown as D1Database,
    SESSION_SECRET: "test-jwt-secret-0123456789abcdef",
    SETUP_SECRET: "test-setup-secret",
    TABLE_PREFIX: "",
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 }),
    } as unknown as Fetcher,
    ...overrides,
  };
}

export function setTablePrefix(env: Env, prefix: string): Env {
  return { ...env, TABLE_PREFIX: prefix };
}

export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export function jsonRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
