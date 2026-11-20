import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import type { Env } from '../src/env';
import { runCron, scheduled, type CronDeps } from '../src/cron';
import { seedRows } from './helpers';
import { GOOD_SUMMARY, MIN, NOW, all, fakeMeta, fakeNapster, sessionRow, world } from './finalizeWorld';

const EVERY_2 = '*/2 * * * *';
const DAILY_8 = '0 8 * * *';

afterEach(async () => {
  await env.DB.prepare('UPDATE credit_guard SET spent_usd = 0 WHERE id = 1').run();
});

const deps = (over: Partial<CronDeps> = {}): CronDeps => ({ napster: fakeNapster() as never, meta: fakeMeta(), ai: null, ...over });

/** env whose DB throws when preparing SQL that contains `match`. */
function envThrowingOn(match: string): Env {
  const real = env.DB;
  const DB = new Proxy(real, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => {
        if (sql.includes(match)) throw new Error(`boom: ${match}`);
        return t.prepare(sql);
      };
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { ...(env as Env), DB } as Env;
}

async function seedCronWorld(p: string) {
  const { id } = await world(p, {
    s: { started_at: NOW - 12 * MIN, status: 'started' }, // over the cap: must be ended
    st: { started_at: NOW - 30 * MIN, ended_at: NOW - 3 * MIN, status: 'closed' }, // ended 3 min ago, no summary
  });
  await seedRows(env as Env, {
    comfort_session: [
      // Fresh live session: untouched.
      { id: id('fresh'), napster_session_id: id('fconn'), child_id: id('C'), avatar_id: id('av'), caregiver_user_id: id('T'), started_at: NOW - 5 * MIN, status: 'started', kind: 'child' },
      // Ended 1 minute ago: too early for the sweep (the webhook should get it).
      { id: id('recent'), napster_session_id: id('rconn'), child_id: id('C'), avatar_id: id('av'), caregiver_user_id: id('T'), started_at: NOW - 6 * MIN, ended_at: NOW - 1 * MIN, status: 'closed', kind: 'child' },
    ],
    avatar: [{ id: id('avc'), user_id: id('P'), status: 'creating', napster_companion_id: id('comp'), created_at: NOW }],
    comfort_plan: [
      { child_id: id('C'), avatar_id: id('av'), parent_title: 'Mommy', today_note: 'old', today_note_expires_at: NOW - 1000 },
      { child_id: id('C'), avatar_id: id('avc'), parent_title: 'Mommy', today_note: 'still valid', today_note_expires_at: NOW + 3_600_000 },
    ],
  });
  return { id };
}

const plan = (childId: string, avatarId: string) =>
  env.DB.prepare('SELECT today_note, today_note_expires_at FROM comfort_plan WHERE child_id = ? AND avatar_id = ?').bind(childId, avatarId).first();

describe('cron */2', () => {
  it('ends a 12-minute-old session and calls deleteConnection (Review Focus 2)', async () => {
    const { id } = await seedCronWorld('c2');
    const d = deps();
    await runCron(EVERY_2, env as Env, d);
    expect(d.napster!.deleteConnection).toHaveBeenCalledWith(id('conn'));
    const s = (await sessionRow(id('s')))!;
    expect(s.status).toBe('closed');
    expect(s.ended_reason).toBe('cap');
    expect(s.ended_at).toBeGreaterThanOrEqual(NOW);
    const fresh = (await sessionRow(id('fresh')))!;
    expect(fresh.status).toBe('started');
    expect(fresh.ended_at).toBeNull();
    expect(d.napster!.deleteConnection).not.toHaveBeenCalledWith(id('fconn'));
  });

  it('still ends the session when deleteConnection fails', async () => {
    const { id } = await seedCronWorld('cd');
    const n = fakeNapster();
    n.deleteConnection.mockRejectedValue(new Error('gone'));
    await runCron(EVERY_2, env as Env, deps({ napster: n as never }));
    expect((await sessionRow(id('s')))!.ended_reason).toBe('cap');
  });

  it('clears an expired today note and keeps a valid one', async () => {
    const { id } = await seedCronWorld('cn');
    await runCron(EVERY_2, env as Env, deps());
    expect(await plan(id('C'), id('av'))).toEqual({ today_note: null, today_note_expires_at: null });
    expect((await plan(id('C'), id('avc')))!.today_note).toBe('still valid');
  });

  it('finalizes sessions ended more than 2 minutes ago without a summary, not recent ones', async () => {
    const { id } = await seedCronWorld('cf');
    const d = deps();
    await runCron(EVERY_2, env as Env, d);
    expect((await sessionRow(id('st')))!.summary).toBe(GOOD_SUMMARY.summary);
    expect((await sessionRow(id('recent')))!.summary).toBeNull();
    expect(d.napster!.getSession).not.toHaveBeenCalledWith(id('rconn'));
  });

  it('advances avatars stuck in creating', async () => {
    const { id } = await seedCronWorld('ca');
    const d = deps();
    await runCron(EVERY_2, env as Env, d);
    expect(d.napster!.getCompanion).toHaveBeenCalledWith(id('comp'));
  });

  it('each step is isolated: a failing finalize sweep does not stop the others', async () => {
    const { id } = await seedCronWorld('ci');
    const d = deps();
    await runCron(EVERY_2, envThrowingOn('summary IS NULL'), d);
    expect((await sessionRow(id('s')))!.ended_reason).toBe('cap');
    expect(d.napster!.getCompanion).toHaveBeenCalledWith(id('comp'));
    expect((await plan(id('C'), id('av')))!.today_note).toBeNull();
  });

  it('each step is isolated: a failing cap sweep does not stop the others', async () => {
    const { id } = await seedCronWorld('cj');
    const d = deps();
    await runCron(EVERY_2, envThrowingOn("ended_reason = 'cap'"), d);
    expect((await sessionRow(id('s')))!.ended_at).toBeNull();
    expect((await sessionRow(id('st')))!.summary).toBe(GOOD_SUMMARY.summary);
    expect(d.napster!.getCompanion).toHaveBeenCalledWith(id('comp'));
    expect((await plan(id('C'), id('av')))!.today_note).toBeNull();
  });

  it('does not run the demo reset', async () => {
    const resetDemoWorld = vi.fn(async () => {});
    await runCron(EVERY_2, env as Env, deps({ resetDemoWorld }));
    expect(resetDemoWorld).not.toHaveBeenCalled();
  });
});

describe('cron 0 8 * * *', () => {
  it('runs resetDemoWorld only', async () => {
    const { id } = await seedCronWorld('c8');
    const resetDemoWorld = vi.fn(async () => {});
    const d = deps({ resetDemoWorld });
    await runCron(DAILY_8, env as Env, d);
    expect(resetDemoWorld).toHaveBeenCalledTimes(1);
    expect(d.napster!.deleteConnection).not.toHaveBeenCalled();
    expect((await sessionRow(id('s')))!.ended_at).toBeNull();
  });
});

describe('scheduled()', () => {
  it('runs the sweep under ctx.waitUntil', async () => {
    const { id } = await seedCronWorld('cs');
    const ctx = createExecutionContext();
    await scheduled(createScheduledController({ cron: EVERY_2, scheduledTime: NOW }), env as Env, ctx, deps());
    await waitOnExecutionContext(ctx);
    expect((await sessionRow(id('s')))!.ended_reason).toBe('cap');
  });
});

describe('alert rows from the cron finalize', () => {
  it('test session finalized by the cron alerts the owner only', async () => {
    const { id } = await seedCronWorld('co');
    await runCron(EVERY_2, env as Env, deps());
    expect((await all('SELECT user_id, title FROM alert WHERE ref_id = ?', id('st')))).toEqual([
      { user_id: id('P'), title: 'Your test call is ready to review' },
    ]);
  });
});
