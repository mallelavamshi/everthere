import { describe, it, expect } from 'vitest';
import { LIMITS } from '@everthere/shared';
import { makeApp, authAs, seedRows } from './helpers';
import { setPin, signActingToken, ACTING_TTL_MS } from '../src/auth/acting';

// Probe routes stand in for the session routes (Task 13), which attribute to `actingUserId ?? userId`.
const { env, request } = makeApp({
  extraRoutes: (app) => {
    const who = (c: any) =>
      c.json({ userId: c.var.userId, actingUserId: c.var.actingUserId ?? null, actingOrgId: c.var.actingOrgId ?? null, attributedTo: c.var.actingUserId ?? c.var.userId });
    app.get('/api/orgs/:id/probe', who);
    app.get('/api/probe', who);
  },
});
const NOW = Date.now();

function call(method: string, path: string, user: string, body?: unknown, extra: Record<string, string> = {}) {
  return request(path, {
    method,
    headers: { ...authAs(user), 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T = any>(res: Response) => (await res.json()) as T;
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;
const q = <T>(sql: string, ...b: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...b)
    .all<T>()
    .then((r) => r.results);

/** Org `<p>org` with tablet account `<p>tab` (teacher), teachers `<p>t1`/`<p>t2` (PIN 1234 / 5678), and a registered device. */
async function world(p: string) {
  const org = `${p}org`;
  await seedRows(env, {
    user: [`${p}tab`, `${p}t1`, `${p}t2`, `${p}out`].map((id) => ({ id, name: `N ${id}`, email: `${id}@x`, created_at: NOW })),
    org: [{ id: org, name: 'Org', timezone: 'UTC' }],
    org_member: [
      { org_id: org, user_id: `${p}tab`, role: 'teacher' },
      { org_id: org, user_id: `${p}t1`, role: 'teacher' },
      { org_id: org, user_id: `${p}t2`, role: 'admin' },
    ],
  });
  await setPin(env, `${p}t1`, org, '1234');
  await setPin(env, `${p}t2`, org, '5678');
  const res = await call('POST', `/api/orgs/${org}/devices`, `${p}tab`);
  expect(res.status).toBe(200);
  const { deviceId } = await json<{ deviceId: string }>(res);
  return { org, tab: `${p}tab`, t1: `${p}t1`, t2: `${p}t2`, out: `${p}out`, deviceId };
}
const act = (user: string, org: string, body: Record<string, unknown>) => call('POST', `/api/orgs/${org}/acting`, user, body);
const probe = async (user: string, path: string, token?: string) =>
  json<{ userId: string; actingUserId: string | null; actingOrgId: string | null; attributedTo: string }>(
    await call('GET', path, user, undefined, token === undefined ? {} : { 'X-Acting-Token': token }),
  );

describe('own PIN', () => {
  it('the admin who created the org sets a PIN and then acts on a registered device', async () => {
    await seedRows(env, {
      user: [
        { id: 'acOadm', name: 'Adm', email: 'adm@x', created_at: NOW },
        { id: 'acOout', name: 'Out', email: 'out@x', created_at: NOW },
      ],
    });
    const { id: org } = await json<{ id: string }>(await call('POST', '/api/orgs', 'acOadm', { name: 'Oak', address: '', timezone: 'UTC' }));
    const staff = async () => (await json<{ staff: { userId: string; hasPin: boolean }[] }>(await call('GET', `/api/orgs/${org}/staff`, 'acOadm'))).staff;
    expect(await staff()).toMatchObject([{ userId: 'acOadm', hasPin: false }]);

    expect(await errCode(await call('PUT', `/api/orgs/${org}/pin`, 'acOadm', { pin: '12345' }))).toBe('INVALID');
    expect(await errCode(await call('PUT', `/api/orgs/${org}/pin`, 'acOadm', { pin: '12' }))).toBe('INVALID');
    expect(await errCode(await call('PUT', `/api/orgs/${org}/pin`, 'acOout', { pin: '1111' }))).toBe('FORBIDDEN');
    expect((await call('PUT', `/api/orgs/${org}/pin`, 'acOadm', { pin: '4321' })).status).toBe(200);
    expect((await staff())[0]!.hasPin).toBe(true);

    const { deviceId } = await json(await call('POST', `/api/orgs/${org}/devices`, 'acOadm'));
    const ok = await act('acOadm', org, { deviceId, teacherUserId: 'acOadm', pin: '4321' });
    expect(ok.status).toBe(200);
    const { actingToken } = await json(ok);
    expect((await probe('acOadm', `/api/orgs/${org}/probe`, actingToken)).actingUserId).toBe('acOadm');

    // Replacing the PIN: the old one stops working.
    expect((await call('PUT', `/api/orgs/${org}/pin`, 'acOadm', { pin: '9999' })).status).toBe(200);
    expect(await errCode(await act('acOadm', org, { deviceId, teacherUserId: 'acOadm', pin: '4321' }))).toBe('FORBIDDEN');
    expect((await act('acOadm', org, { deviceId, teacherUserId: 'acOadm', pin: '9999' })).status).toBe(200);
  });
});

describe('devices', () => {
  it('any org member registers a device; non-members cannot', async () => {
    const w = await world('acd');
    expect(await q('SELECT org_id, registered_by FROM device WHERE id = ?', w.deviceId)).toEqual([{ org_id: w.org, registered_by: w.tab }]);
    expect(await errCode(await call('POST', `/api/orgs/${w.org}/devices`, w.out))).toBe('FORBIDDEN');
  });
});

describe('acting', () => {
  it('correct PIN gives a token; requests with it are attributed to the acting teacher', async () => {
    const w = await world('ac1');
    const res = await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' });
    expect(res.status).toBe(200);
    const { actingToken, expiresAt } = await json<{ actingToken: string; expiresAt: number }>(res);
    expect(actingToken).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(ACTING_TTL_MS).toBe(12 * 3_600_000);
    expect(expiresAt).toBeGreaterThan(Date.now() + ACTING_TTL_MS - 60_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + ACTING_TTL_MS);

    expect(await probe(w.tab, `/api/orgs/${w.org}/probe`, actingToken)).toEqual({ userId: w.tab, actingUserId: w.t1, actingOrgId: w.org, attributedTo: w.t1 });
    // Non-org routes (e.g. POST /api/sessions in Task 13) also get actingUserId + actingOrgId; they re-check access themselves.
    expect(await probe(w.tab, '/api/probe', actingToken)).toMatchObject({ attributedTo: w.t1, actingOrgId: w.org });
    // No header -> the signed-in user, no acting org.
    expect(await probe(w.tab, '/api/probe')).toMatchObject({ attributedTo: w.tab, actingOrgId: null });
  });

  it('a tampered token is ignored (never an error)', async () => {
    const w = await world('ac2');
    const { actingToken } = await json(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }));
    const [payload, sig] = actingToken.split('.') as [string, string];
    const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    // Re-point the payload at another teacher but keep the old signature.
    const forged = btoa(`${w.deviceId}|${w.org}|${w.t2}|${Date.now() + 3_600_000}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const bad of [`${payload}.${flipped}`, `${forged}.${sig}`, 'garbage', `${payload}`, `.${sig}`, `${payload}.${sig}.x`]) {
      const res = await call('GET', `/api/orgs/${w.org}/probe`, w.tab, undefined, { 'X-Acting-Token': bad });
      expect(res.status).toBe(200);
      expect((await json(res)).actingUserId).toBeNull();
    }
  });

  it('expired token is ignored', async () => {
    const w = await world('ac3');
    const expired = await signActingToken(env, { deviceId: w.deviceId, orgId: w.org, teacherUserId: w.t1, exp: Date.now() - 1 });
    expect((await probe(w.tab, `/api/orgs/${w.org}/probe`, expired)).actingUserId).toBeNull();
    const live = await signActingToken(env, { deviceId: w.deviceId, orgId: w.org, teacherUserId: w.t1, exp: Date.now() + 60_000 });
    expect((await probe(w.tab, `/api/orgs/${w.org}/probe`, live)).actingUserId).toBe(w.t1);
  });

  it("token is ignored after the teacher's org_member row is deleted", async () => {
    const w = await world('ac4');
    const { actingToken } = await json(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }));
    expect((await probe(w.tab, '/api/probe', actingToken)).actingUserId).toBe(w.t1);
    await env.DB.prepare('DELETE FROM org_member WHERE org_id = ? AND user_id = ?').bind(w.org, w.t1).run();
    expect((await probe(w.tab, '/api/probe', actingToken)).actingUserId).toBeNull();
    expect((await probe(w.tab, `/api/orgs/${w.org}/probe`, actingToken)).actingUserId).toBeNull();
  });

  it('token is ignored for a signed-in user who is not a member, or when the device is gone', async () => {
    const w = await world('ac5');
    const { actingToken } = await json(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }));
    expect((await probe(w.out, '/api/probe', actingToken)).actingUserId).toBeNull();
    await env.DB.prepare('DELETE FROM device WHERE id = ?').bind(w.deviceId).run();
    expect((await probe(w.tab, '/api/probe', actingToken)).actingUserId).toBeNull();
  });

  it('an acting token from org A is ignored on org B', async () => {
    const a = await world('acA');
    await seedRows(env, {
      org: [{ id: 'acBorg', name: 'B', timezone: 'UTC' }],
      org_member: [
        { org_id: 'acBorg', user_id: a.tab, role: 'teacher' },
        { org_id: 'acBorg', user_id: a.t1, role: 'teacher' },
      ],
    });
    const { actingToken } = await json(await act(a.tab, a.org, { deviceId: a.deviceId, teacherUserId: a.t1, pin: '1234' }));
    expect((await probe(a.tab, `/api/orgs/${a.org}/probe`, actingToken)).actingUserId).toBe(a.t1);
    expect((await probe(a.tab, '/api/orgs/acBorg/probe', actingToken)).actingUserId).toBeNull();
    // A device of org A cannot be used to act in org B either.
    expect(await errCode(await act(a.tab, 'acBorg', { deviceId: a.deviceId, teacherUserId: a.t1, pin: '1234' }))).toBe('DEVICE_UNKNOWN');
  });

  it('roster follows the acting teacher on a shared tablet', async () => {
    const w = await world('ac7');
    await seedRows(env, {
      classroom: [
        { id: 'ac7A', org_id: w.org, name: 'A', emoji: '🌻' },
        { id: 'ac7B', org_id: w.org, name: 'B', emoji: '🌈' },
      ],
      classroom_staff: [
        { classroom_id: 'ac7A', user_id: w.t1 },
        { classroom_id: 'ac7B', user_id: w.tab },
      ],
      enrollment: [
        { id: 'ac7eA', org_id: w.org, classroom_id: 'ac7A', child_name: 'InA', invite_code: 'AC7AAA', status: 'invited', created_at: NOW },
        { id: 'ac7eB', org_id: w.org, classroom_id: 'ac7B', child_name: 'InB', invite_code: 'AC7BBB', status: 'invited', created_at: NOW },
      ],
    });
    const names = async (token?: string) =>
      (
        await json<{ tiles: { name: string }[] }>(
          await call('GET', `/api/orgs/${w.org}/roster`, w.tab, undefined, token ? { 'X-Acting-Token': token } : {}),
        )
      ).tiles.map((t) => t.name);
    expect(await names()).toEqual(['InB']);
    const { actingToken } = await json(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }));
    expect(await names(actingToken)).toEqual(['InA']);
  });

  it('acting route: caller must be an org member; PIN must be exactly 4 digits', async () => {
    const w = await world('ac6');
    expect(await errCode(await act(w.out, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }))).toBe('FORBIDDEN');
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '12345' }))).toBe('INVALID');
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '12a4' }))).toBe('INVALID');
    expect(await q('SELECT 1 FROM pin_attempt WHERE device_id = ?', w.deviceId)).toHaveLength(0);
  });
});

describe('PIN lockout', () => {
  it('the 6th wrong PIN -> PIN_LOCKED, without checking the PIN', async () => {
    const w = await world('acL');
    for (let i = 0; i < LIMITS.pinAttempts; i++) {
      expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' }))).toBe('FORBIDDEN');
    }
    const sixth = await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' });
    expect(sixth.status).toBe(429);
    expect(await errCode(sixth)).toBe('PIN_LOCKED');
    // Even the right PIN is refused while locked; another teacher on the same device too.
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t2, pin: '5678' }))).toBe('PIN_LOCKED');
    // Locked requests are not recorded as attempts.
    expect(await q('SELECT 1 FROM pin_attempt WHERE device_id = ?', w.deviceId)).toHaveLength(LIMITS.pinAttempts);

    // A different device is unaffected for another teacher, but t1 is now locked on every device.
    const { deviceId: d2 } = await json(await call('POST', `/api/orgs/${w.org}/devices`, w.tab));
    expect(await errCode(await act(w.tab, w.org, { deviceId: d2, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
    expect((await act(w.tab, w.org, { deviceId: d2, teacherUserId: w.t2, pin: '5678' })).status).toBe(200);
  });

  it('wrong PINs for one teacher spread over 3 devices lock that teacher on a 4th device', async () => {
    const w = await world('acS');
    const dev = async () => (await json<{ deviceId: string }>(await call('POST', `/api/orgs/${w.org}/devices`, w.tab))).deviceId;
    const [d1, d2, d3, d4] = [w.deviceId, await dev(), await dev(), await dev()];
    for (const d of [d1, d1, d2, d2, d3]) {
      expect(await errCode(await act(w.tab, w.org, { deviceId: d, teacherUserId: w.t1, pin: '0000' }))).toBe('FORBIDDEN');
    }
    expect(await errCode(await act(w.tab, w.org, { deviceId: d4, teacherUserId: w.t1, pin: '0000' }))).toBe('PIN_LOCKED');
    expect(await errCode(await act(w.tab, w.org, { deviceId: d4, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
    // Other teachers are not locked by t1's count (no device has 5 attempts).
    expect((await act(w.tab, w.org, { deviceId: d4, teacherUserId: w.t2, pin: '5678' })).status).toBe(200);
    // t2 signing in on d1 does not wipe the guesses made against t1 there.
    expect((await act(w.tab, w.org, { deviceId: d1, teacherUserId: w.t2, pin: '5678' })).status).toBe(200);
    expect(await errCode(await act(w.tab, w.org, { deviceId: d1, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
  });

  it("own correct PIN does not reset another teacher's lock counter", async () => {
    const w = await world('acR');
    for (let i = 0; i < 4; i++) await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' });
    expect((await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t2, pin: '5678' })).status).toBe(200);
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' }))).toBe('FORBIDDEN');
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
  });

  it('6 parallel wrong attempts: at most 5 PIN checks, at least 1 PIN_LOCKED', async () => {
    const w = await world('acP');
    const codes = await Promise.all(
      Array.from({ length: 6 }, async () => errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' }))),
    );
    expect(codes.filter((x) => x === 'PIN_LOCKED').length).toBeGreaterThanOrEqual(1);
    expect(codes.filter((x) => x === 'FORBIDDEN').length).toBeLessThanOrEqual(5);
    expect(codes.every((x) => x === 'PIN_LOCKED' || x === 'FORBIDDEN')).toBe(true);
    // Nothing after the 5th is checked: the right PIN is refused now.
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' }))).toBe('PIN_LOCKED');
    expect(await q('SELECT 1 FROM pin_attempt WHERE device_id = ?', w.deviceId)).toHaveLength(codes.filter((x) => x === 'FORBIDDEN').length);
  });

  it('attempts outside the window do not count; a correct PIN clears attempts; unknown teacher counts as wrong', async () => {
    const w = await world('acM');
    await seedRows(env, {
      pin_attempt: Array.from({ length: 10 }, () => ({ device_id: w.deviceId, at: Date.now() - LIMITS.pinWindowMs - 1000 })),
    });
    for (let i = 0; i < 3; i++) await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '9999' });
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.out, pin: '1234' }))).toBe('FORBIDDEN');
    expect((await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '1234' })).status).toBe(200);
    // t1's attempts are cleared; the wrong guess against `out` on this device is kept (it is not t1's).
    expect(await q('SELECT teacher_user_id FROM pin_attempt WHERE device_id = ? AND at > ?', w.deviceId, Date.now() - LIMITS.pinWindowMs)).toEqual([
      { teacher_user_id: w.out },
    ]);
    expect(await q('SELECT 1 FROM pin_attempt WHERE org_id = ? AND teacher_user_id = ?', w.org, w.t1)).toHaveLength(0);
  });

  it('a wrong attempt records its target teacher and org', async () => {
    const w = await world('acT');
    await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '0000' });
    expect(await q('SELECT device_id, org_id, teacher_user_id FROM pin_attempt WHERE device_id = ?', w.deviceId)).toEqual([
      { device_id: w.deviceId, org_id: w.org, teacher_user_id: w.t1 },
    ]);
  });
});

describe('device errors have their own code', () => {
  it('wrong PIN -> FORBIDDEN, unknown or foreign device -> DEVICE_UNKNOWN', async () => {
    const w = await world('acU');
    expect(await errCode(await act(w.tab, w.org, { deviceId: w.deviceId, teacherUserId: w.t1, pin: '9999' }))).toBe('FORBIDDEN');
    const res = await act(w.tab, w.org, { deviceId: 'no-such-device', teacherUserId: w.t1, pin: '1234' });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe('DEVICE_UNKNOWN');
  });
});
