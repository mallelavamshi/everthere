import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { LIMITS } from '@everthere/shared';
import { createApp } from '../src/index';
import type { Env } from '../src/env';
import * as creditGuard from '../src/services/creditGuard';
import { testVerify, testFetchProfile, authAs, seedRows } from './helpers';

const DAY = 86_400_000;
const NOW = Date.now();
const dayStart = Math.floor(NOW / DAY) * DAY;

const setSpent = (spent: number, cap = 120) => env.DB.prepare('UPDATE credit_guard SET spent_usd = ?, cap_usd = ? WHERE id = 1').bind(spent, cap).run();
const spent = async () => (await env.DB.prepare('SELECT spent_usd FROM credit_guard WHERE id = 1').first<{ spent_usd: number }>())!.spent_usd;

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const res = (e as { res?: Response }).res;
    return res ? ((await res.json()) as { error: { code: string } }).error.code : String(e);
  }
}

function sessions(user: string, tag: string, n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cg_${user}_${tag}${i}`, child_id: 'cg_child', avatar_id: 'cg_av', caregiver_user_id: user,
    started_at: dayStart + 1 + i, ended_at: dayStart + 2 + i, status: 'closed', kind: 'child', ...over,
  }));
}

afterEach(async () => {
  await setSpent(0, 120);
});

describe('creditGuard.check', () => {
  it('passes under both limits; the seeded cap is 120', async () => {
    expect(LIMITS.creditCapUsd).toBe(120);
    expect(await env.DB.prepare('SELECT cap_usd, spent_usd FROM credit_guard WHERE id = 1').first()).toEqual({ cap_usd: 120, spent_usd: 0 });
    expect(await codeOf(creditGuard.check(env, 'cg_u0'))).toBeNull();
  });

  it('spent >= cap -> RESTING (equal and over); just under passes', async () => {
    await setSpent(119.99);
    expect(await codeOf(creditGuard.check(env, 'cg_u0'))).toBeNull();
    await setSpent(120);
    expect(await codeOf(creditGuard.check(env, 'cg_u0'))).toBe('RESTING');
    await setSpent(130);
    expect(await codeOf(creditGuard.check(env, 'cg_u0'))).toBe('RESTING');
    await setSpent(10, 5); // lowered cap is honored
    expect(await codeOf(creditGuard.check(env, 'cg_u0'))).toBe('RESTING');
  });

  it('20 child sessions today -> RESTING; 19 passes; test/failed/yesterday/other users do not count', async () => {
    await seedRows(env, {
      comfort_session: [
        ...sessions('cg_u1', 'a', 19),
        ...sessions('cg_u1', 't', 5, { kind: 'test', child_id: null }),
        ...sessions('cg_u1', 'f', 5, { status: 'failed' }),
        ...sessions('cg_u1', 'y', 5, { started_at: dayStart - 1000 }),
        ...sessions('cg_other', 'a', 20),
      ],
    });
    expect(await codeOf(creditGuard.check(env, 'cg_u1'))).toBeNull();
    await seedRows(env, { comfort_session: sessions('cg_u1', 'b', 1) });
    expect(await codeOf(creditGuard.check(env, 'cg_u1'))).toBe('RESTING');
    expect(await codeOf(creditGuard.check(env, 'cg_other'))).toBe('RESTING');
  });

  it('demo users (is_demo) get the demo limit of 200 a day; normal users stay at 20', async () => {
    expect(LIMITS.sessionsPerUserPerDay).toBe(20);
    expect(LIMITS.demoSessionsPerUserPerDay).toBe(200);
    await seedRows(env, {
      user: [
        { id: 'cg_demo', name: 'Demo', email: 'demo@x', created_at: NOW, is_demo: 1 },
        { id: 'cg_real', name: 'Real', email: 'real@x', created_at: NOW, is_demo: 0 },
      ],
      comfort_session: [...sessions('cg_demo', 'a', 20), ...sessions('cg_real', 'a', 20)],
    });
    expect(await creditGuard.dailyLimitFor(env, 'cg_demo')).toBe(200);
    expect(await creditGuard.dailyLimitFor(env, 'cg_real')).toBe(20);
    expect(await creditGuard.dailyLimitFor(env, 'cg_unknown')).toBe(20);
    expect(await codeOf(creditGuard.check(env, 'cg_demo'))).toBeNull();
    expect(await codeOf(creditGuard.check(env, 'cg_real'))).toBe('RESTING');
    await seedRows(env, { comfort_session: sessions('cg_demo', 'b', 179) });
    expect(await codeOf(creditGuard.check(env, 'cg_demo'))).toBeNull(); // 199
    await seedRows(env, { comfort_session: sessions('cg_demo', 'c', 1) });
    expect(await codeOf(creditGuard.check(env, 'cg_demo'))).toBe('RESTING'); // 200
    await setSpent(120); // the money cap still guards demo users
    await env.DB.prepare("DELETE FROM comfort_session WHERE caregiver_user_id = 'cg_demo'").run();
    expect(await codeOf(creditGuard.check(env, 'cg_demo'))).toBe('RESTING');
  });

  it("test-session checks apply the spend cap only, not the daily count", async () => {
    await seedRows(env, { comfort_session: sessions('cg_u2', 'a', 25) });
    expect(await codeOf(creditGuard.check(env, 'cg_u2'))).toBe('RESTING');
    expect(await codeOf(creditGuard.check(env, 'cg_u2', { kind: 'test' }))).toBeNull();
    await setSpent(120);
    expect(await codeOf(creditGuard.check(env, 'cg_u2', { kind: 'test' }))).toBe('RESTING');
  });
});

describe('creditGuard.record', () => {
  it('adds to spent_usd atomically', async () => {
    await Promise.all([creditGuard.record(env, 1.25), creditGuard.record(env, 2.5), creditGuard.record(env, 0.25)]);
    expect(await spent()).toBeCloseTo(4, 6);
  });
  it('ignores non-positive and non-finite costs', async () => {
    await creditGuard.record(env, 0);
    await creditGuard.record(env, -5);
    await creditGuard.record(env, Number.NaN);
    expect(await spent()).toBe(0);
  });
});

describe('test-session route honors the spend cap', () => {
  it('spent >= cap -> RESTING, no Napster call, no row', async () => {
    const createConnection = vi.fn(async () => ({ token: 't', connectionId: 'c' }));
    const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: { createConnection } as never });
    await seedRows(env, {
      user: [{ id: 'cg_owner', name: 'Owner', email: 'o@x', created_at: NOW }],
      avatar: [{ id: 'cg_tav', user_id: 'cg_owner', status: 'approved', napster_agent_id: 'agT', parent_title: 'Mommy', created_at: NOW }],
    });
    await setSpent(120);
    const res = await app.request('/api/avatars/cg_tav/test-session', { method: 'POST', headers: authAs('cg_owner') }, env as Env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RESTING');
    expect(createConnection).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM comfort_session WHERE avatar_id = 'cg_tav'").first()).toEqual({ n: 0 });
    await setSpent(0);
    const ok = await app.request('/api/avatars/cg_tav/test-session', { method: 'POST', headers: authAs('cg_owner') }, env as Env);
    expect(ok.status).toBe(200);
  });
});
