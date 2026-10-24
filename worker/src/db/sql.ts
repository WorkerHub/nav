// Shared SQL helpers.

export function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runScript(db: D1Database, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) {
    await db.prepare(stmt).run();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
