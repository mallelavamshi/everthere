import { LIMITS } from '@everthere/shared';
import type { Env } from './env';
import { napster as makeNapster, type NapsterClient } from './napster/client';
import { advanceAvatar, type AvatarNapster, type AvatarRow } from './services/avatars';
import { resetDemoWorld } from './services/demo';
import { finalizeSession } from './services/finalize';
import type { SummaryDeps } from './services/summary';

export const CRON_SWEEP = '*/2 * * * *';
export const CRON_DAILY = '0 8 * * *';

/** Sessions ended longer ago than this without a summary are finalized by the sweep (the webhook normally wins). */
export const FINALIZE_AFTER_MS = 2 * 60_000;
/** ...and given up on after this long (e.g. Napster never reports a cost), so they can't crowd out newer ones. */
export const FINALIZE_GIVE_UP_MS = 24 * 60 * 60_000;
/** Live sessions older than this are past Napster's 10-minute cap and get closed. */
export const CAP_AFTER_MS = 11 * 60_000;
export const SWEEP_LIMIT = 20;
const CAP_LIMIT = 50;

export type CronNapster = AvatarNapster & Pick<NapsterClient, 'getSession' | 'deleteConnection'>;
export type CronDeps = SummaryDeps & {
  napster?: CronNapster;
  resetDemoWorld?: (env: Env) => Promise<void>;
};

/** (a) Finalize ended, unsummarized sessions (child and test). Each session is isolated. */
export async function finalizeEnded(env: Env, deps: CronDeps, napster: CronNapster, now: number): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT id FROM comfort_session
       WHERE summary IS NULL AND ended_at IS NOT NULL AND ended_at <= ? AND ended_at > ?
         AND napster_session_id IS NOT NULL AND status != 'failed'
       ORDER BY ended_at DESC LIMIT ${SWEEP_LIMIT}`,
    )
    .bind(now - FINALIZE_AFTER_MS, now - FINALIZE_GIVE_UP_MS)
    .all<{ id: string }>();
  let done = 0;
  for (const r of results) {
    try {
      if ((await finalizeSession(env, r.id, { ...deps, napster })) === 'done') done++;
    } catch (e) {
      console.error('cron: finalizeSession failed', r.id, e);
    }
  }
  return done;
}

/** (b) Close live sessions past the cap: drop the Napster connection (errors ignored), then mark ended_reason 'cap'. */
export async function capOverdue(env: Env, napster: CronNapster, now: number): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT id, napster_session_id FROM comfort_session
       WHERE status IN ('pending', 'started', 'active') AND ended_at IS NULL AND started_at < ?
       ORDER BY started_at LIMIT ${CAP_LIMIT}`,
    )
    .bind(now - CAP_AFTER_MS)
    .all<{ id: string; napster_session_id: string | null }>();
  const maxS = Math.round(LIMITS.sessionMaxMs / 1000);
  let closed = 0;
  for (const r of results) {
    if (r.napster_session_id) {
      await napster.deleteConnection(r.napster_session_id).catch((e) => console.warn('cron: deleteConnection failed', r.id, e));
    }
    const res = await env.DB
      .prepare(
        `UPDATE comfort_session
         SET status = 'closed', ended_at = ?, ended_reason = 'cap',
             duration_s = COALESCE(duration_s, MIN(?, MAX(0, CAST((? - started_at) / 1000 AS INTEGER))))
         WHERE id = ? AND ended_at IS NULL`,
      )
      .bind(now, maxS, now, r.id)
      .run();
    closed += res.meta.changes ?? 0;
  }
  return closed;
}

/** (c) Nudge avatars still generating (and time out stuck ones), like GET /avatars/:id does. */
export async function advanceCreating(env: Env, napster: CronNapster): Promise<number> {
  const { results } = await env.DB
    .prepare(`SELECT * FROM avatar WHERE status = 'creating' ORDER BY created_at LIMIT ${SWEEP_LIMIT}`)
    .all<AvatarRow>();
  for (const a of results) {
    try {
      await advanceAvatar(env, napster, a);
    } catch (e) {
      console.error('cron: advanceAvatar failed', a.id, e);
    }
  }
  return results.length;
}

/** (d) Clear expired Today notes. */
export async function clearExpiredNotes(env: Env, now: number): Promise<number> {
  const res = await env.DB
    .prepare(
      `UPDATE comfort_plan SET today_note = NULL, today_note_expires_at = NULL
       WHERE today_note_expires_at IS NOT NULL AND today_note_expires_at <= ?`,
    )
    .bind(now)
    .run();
  return res.meta.changes ?? 0;
}

async function isolated(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`cron: ${name} failed`, e);
  }
}

/** Runs the job for one cron expression. Every step is isolated: one failing never stops the others. */
export async function runCron(cron: string, env: Env, deps: CronDeps = {}): Promise<void> {
  if (cron === CRON_DAILY) {
    await isolated('resetDemoWorld', () => (deps.resetDemoWorld ?? resetDemoWorld)(env));
    return;
  }
  if (cron !== CRON_SWEEP) {
    console.warn('cron: unknown schedule', cron);
    return;
  }
  const napster = deps.napster ?? (makeNapster(env.NAPSTER_API_KEY) as CronNapster);
  const now = Date.now();
  await isolated('finalizeEnded', () => finalizeEnded(env, deps, napster, now));
  await isolated('capOverdue', () => capOverdue(env, napster, now));
  await isolated('advanceCreating', () => advanceCreating(env, napster));
  await isolated('clearExpiredNotes', () => clearExpiredNotes(env, now));
}

/** Workers `scheduled` handler: the work runs under ctx.waitUntil so the invocation stays alive until it's done. */
export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext, deps: CronDeps = {}): Promise<void> {
  ctx.waitUntil(runCron(controller.cron, env, deps));
}
