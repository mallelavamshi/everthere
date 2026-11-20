import { env } from 'cloudflare:workers';
import { createApp } from '../src/index';
import type { Env } from '../src/env';

/** Verifier that accepts only `test:<userId>` tokens. Never used by the production app. */
export async function testVerify(token: string): Promise<{ sub: string }> {
  if (!token.startsWith('test:') || token.length <= 5) throw new Error('bad test token');
  return { sub: token.slice(5) };
}

export async function testFetchProfile(id: string): Promise<{ name: string; email: string }> {
  return { name: `Test User ${id}`, email: `${id}@test.local` };
}

export function makeApp(extra: Omit<NonNullable<Parameters<typeof createApp>[0]>, 'verify' | 'fetchProfile'> = {}) {
  const testEnv: Env = env;
  const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, ...extra });
  return {
    env: testEnv,
    request: (path: string, init?: RequestInit) => app.request(path, init, testEnv),
  };
}

/** Headers accepted by the test verifier added in Task 3. */
export function authAs(userId: string): Record<string, string> {
  return { Authorization: `Bearer test:${userId}` };
}

/** Insert rows into named tables: `{ user: [{id: 'u1', ...}], family: [...] }` (snake_case columns). */
export async function seedRows(e: Env, rows: Record<string, Record<string, unknown>[]>) {
  const stmts: D1PreparedStatement[] = [];
  for (const [table, list] of Object.entries(rows)) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`bad table name ${table}`);
    for (const row of list) {
      const cols = Object.keys(row);
      for (const c of cols) if (!/^[a-z_0-9]+$/.test(c)) throw new Error(`bad column ${c}`);
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      stmts.push(e.DB.prepare(sql).bind(...cols.map((c) => row[c] ?? null)));
    }
  }
  if (stmts.length) await e.DB.batch(stmts);
}
