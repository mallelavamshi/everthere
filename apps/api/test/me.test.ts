import { describe, it, expect } from 'vitest';
import { createApp } from '../src/index';
import { makeApp, testVerify, testFetchProfile, authAs, seedRows } from './helpers';

type Me = {
  user: { id: string; name: string; email: string; isDemo: boolean };
  roles: {
    parent: boolean;
    adminOrgs: { id: string; name: string }[];
    teacherOrgs: { id: string; name: string }[];
    homeCaregiverFamilies: { id: string; label: string }[];
  };
};

describe('GET /api/me', () => {
  it('no token -> 401 UNAUTHENTICATED', async () => {
    const { request } = makeApp();
    const res = await request('/api/me');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('invalid token -> 401', async () => {
    const { request } = makeApp();
    const res = await request('/api/me', { headers: { Authorization: 'Bearer garbage' } });
    expect(res.status).toBe(401);
  });

  it('health stays unauthenticated', async () => {
    const { request } = makeApp();
    expect((await request('/api/health')).status).toBe(200);
  });

  it('new user -> row created, all roles false/empty', async () => {
    const { request, env } = makeApp();
    const res = await request('/api/me', { headers: authAs('new1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Me;
    expect(body.user.id).toBe('new1');
    expect(body.user.name).toBe('Test User new1');
    expect(body.user.email).toBe('new1@test.local');
    expect(body.user.isDemo).toBe(false);
    expect(body.roles).toEqual({ parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] });
    const row = await env.DB.prepare('SELECT id FROM user WHERE id = ?').bind('new1').first();
    expect(row).toEqual({ id: 'new1' });
  });

  it('family_member -> parent:true', async () => {
    const { request, env } = makeApp();
    await seedRows(env, {
      user: [{ id: 'p1', name: 'Sarah', email: 's@x.io', created_at: 1 }],
      family: [{ id: 'f1', created_at: 1 }],
      family_member: [{ family_id: 'f1', user_id: 'p1', role: 'parent' }],
    });
    const body = (await (await request('/api/me', { headers: authAs('p1') })).json()) as Me;
    expect(body.user.name).toBe('Sarah');
    expect(body.roles.parent).toBe(true);
  });

  it('org admin / teacher memberships', async () => {
    const { request, env } = makeApp();
    await seedRows(env, {
      user: [{ id: 'a1', name: 'Ann', email: 'a@x.io', created_at: 1 }],
      org: [
        { id: 'o1', name: 'Sunny Daycare' },
        { id: 'o2', name: 'Moon Daycare' },
      ],
      org_member: [
        { org_id: 'o1', user_id: 'a1', role: 'admin' },
        { org_id: 'o2', user_id: 'a1', role: 'teacher' },
      ],
    });
    const body = (await (await request('/api/me', { headers: authAs('a1') })).json()) as Me;
    expect(body.roles.adminOrgs).toEqual([{ id: 'o1', name: 'Sunny Daycare' }]);
    expect(body.roles.teacherOrgs).toEqual([{ id: 'o2', name: 'Moon Daycare' }]);
  });

  it('home caregiver families', async () => {
    const { request, env } = makeApp();
    await seedRows(env, {
      user: [
        { id: 'g1', name: 'Grandma', email: 'g@x.io', created_at: 1 },
        { id: 'kp', name: 'Jo Kim', email: 'k@x.io', created_at: 1 },
      ],
      family: [{ id: 'f9', created_at: 1 }],
      family_member: [{ family_id: 'f9', user_id: 'kp', role: 'parent' }],
      child: [{ id: 'c9', family_id: 'f9', name: 'Mia' }],
      connection: [{ id: 'cn9', child_id: 'c9', kind: 'home', caregiver_user_id: 'g1' }],
    });
    const body = (await (await request('/api/me', { headers: authAs('g1') })).json()) as Me;
    expect(body.roles.parent).toBe(false);
    expect(body.roles.homeCaregiverFamilies).toEqual([{ id: 'f9', label: 'Kim family' }]);
  });

  it('profile fetch failure -> placeholder name, row still created', async () => {
    const { env } = makeApp();
    const app = createApp({
      verify: testVerify,
      fetchProfile: async () => {
        throw new Error('clerk down');
      },
    });
    const res = await app.request('/api/me', { headers: authAs('flaky') }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Me).user.name).toBe('New user');
  });

  it('profile is fetched only on first insert', async () => {
    const { env } = makeApp();
    let calls = 0;
    const app = createApp({
      verify: testVerify,
      fetchProfile: async (id) => {
        calls++;
        return { name: `P ${id}`, email: `${id}@p.io` };
      },
    });
    await app.request('/api/me', { headers: authAs('once') }, env);
    await app.request('/api/me', { headers: authAs('once') }, env);
    expect(calls).toBe(1);
  });

  it('production app (default verifier) rejects test: tokens', async () => {
    const { env } = makeApp();
    const res = await createApp().request('/api/me', { headers: authAs('u1') }, env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('throwing verifier -> 401', async () => {
    const { env } = makeApp();
    const a = createApp({
      verify: async () => {
        throw new Error('boom');
      },
    });
    const res = await a.request('/api/me', { headers: authAs('u1') }, env);
    expect(res.status).toBe(401);
  });

  it('DB failure during upsert -> standard 500 JSON', async () => {
    const { env } = makeApp();
    const boom = () => {
      throw new Error('d1 down');
    };
    const broken = { ...env, DB: { prepare: boom, batch: boom } } as unknown as typeof env;
    const a = createApp({ verify: testVerify, fetchProfile: testFetchProfile });
    const res = await a.request('/api/me', { headers: authAs('x') }, broken);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('no email from claims or fetch -> unique placeholder email', async () => {
    const { env } = makeApp();
    const a = createApp({ verify: testVerify, fetchProfile: async () => ({ name: '', email: '' }) });
    const body = (await (await a.request('/api/me', { headers: authAs('noem') }, env)).json()) as Me;
    expect(body.user.email).toBe('noem@unknown.invalid');
    expect(body.user.name).toBe('New user');
  });

  it('stale placeholder row is healed later; failed retry leaves it unchanged', async () => {
    const { env } = makeApp();
    const down = createApp({
      verify: testVerify,
      fetchProfile: async () => {
        throw new Error('x');
      },
    });
    await down.request('/api/me', { headers: authAs('stale') }, env);
    const still = (await (await down.request('/api/me', { headers: authAs('stale') }, env)).json()) as Me;
    expect(still.user.name).toBe('New user');
    let calls = 0;
    const up = createApp({
      verify: testVerify,
      fetchProfile: async (id) => {
        calls++;
        return { name: `Real ${id}`, email: `${id}@real.io` };
      },
    });
    const healed = (await (await up.request('/api/me', { headers: authAs('stale') }, env)).json()) as Me;
    expect(healed.user).toMatchObject({ name: 'Real stale', email: 'stale@real.io' });
    await up.request('/api/me', { headers: authAs('stale') }, env);
    expect(calls).toBe(1);
  });
});
