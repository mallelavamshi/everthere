import { LIMITS } from '@everthere/shared';
import type { Env } from '../env';
import { apiError } from '../http';

type E = Pick<Env, 'DB'>;

const DAY_MS = 86_400_000;

/** Start of the current UTC day, in ms. */
export const utcDayStart = (now = Date.now()): number => Math.floor(now / DAY_MS) * DAY_MS;

/**
 * SQL predicate (bind: caregiverUserId, dayStart) matching the child sessions that count toward the daily limit:
 * kind 'child', started since UTC midnight, by that caregiver. Failed starts (Napster refused, nothing spent) don't count.
 */
export const DAILY_COUNT_SQL = `SELECT COUNT(*) AS n FROM comfort_session
  WHERE caregiver_user_id = ? AND kind = 'child' AND started_at >= ? AND status != 'failed'`;

const resting = () => apiError('RESTING', 'The avatars are resting right now. Please try again later.');

async function overSpend(env: E): Promise<boolean> {
  const row = await env.DB.prepare('SELECT cap_usd, spent_usd FROM credit_guard WHERE id = 1').first<{ cap_usd: number; spent_usd: number }>();
  const cap = row?.cap_usd ?? LIMITS.creditCapUsd;
  return (row?.spent_usd ?? 0) >= cap;
}

export async function dailyCount(env: E, userId: string, now = Date.now()): Promise<number> {
  const row = await env.DB.prepare(DAILY_COUNT_SQL).bind(userId, utcDayStart(now)).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Child sessions `userId` may start per UTC day: LIMITS.demoSessionsPerUserPerDay for demo accounts (shared by many
 * judges; the spend cap still guards money), else LIMITS.sessionsPerUserPerDay.
 */
export async function dailyLimitFor(env: E, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT is_demo FROM user WHERE id = ?').bind(userId).first<{ is_demo: number }>();
  return row?.is_demo === 1 ? LIMITS.demoSessionsPerUserPerDay : LIMITS.sessionsPerUserPerDay;
}

/**
 * Throws RESTING when the global spend cap is reached, or (child sessions only) when `userId` has already started
 * their daily limit of child sessions (see dailyLimitFor) in the current UTC day. Test sessions check spend only.
 */
export async function check(env: E, userId: string, opts: { kind?: 'child' | 'test' } = {}): Promise<void> {
  if (await overSpend(env)) throw resting();
  if ((opts.kind ?? 'child') === 'child' && (await dailyCount(env, userId)) >= (await dailyLimitFor(env, userId))) throw resting();
}

/** Adds a session's cost to the running total, atomically. Non-positive or non-finite costs are ignored. */
export async function record(env: E, costUsd: number): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  await env.DB.prepare('UPDATE credit_guard SET spent_usd = spent_usd + ? WHERE id = 1').bind(costUsd).run();
}

/**
 * A statement that adds `costUsd` to the running total only when the statement run just before it in the same
 * `db.batch` changed exactly one row (SQLite `changes()`): idempotent cost recording guarded by a conditional
 * UPDATE. Null for non-positive or non-finite costs (nothing to record).
 */
export function recordIfChangedStmt(env: E, costUsd: number): D1PreparedStatement | null {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
  return env.DB.prepare('UPDATE credit_guard SET spent_usd = spent_usd + ? WHERE id = 1 AND changes() = 1').bind(costUsd);
}
