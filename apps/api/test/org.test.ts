import { describe, it, expect } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';
import { signActingToken } from '../src/auth/acting';
import { caregiverChildIds } from '../src/auth/access';
import { orgDayStart, orgMonthStart } from '../src/lib/orgTime';

const { env, request } = makeApp();
const NOW = Date.now();

function call(method: string, path: string, user: string, body?: unknown) {
  return request(path, {
    method,
    headers: { ...authAs(user), 'content-type': 'application/json' },
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
const users = (...ids: string[]) => seedRows(env, { user: ids.map((id) => ({ id, name: `N ${id}`, email: `${id}@x`, created_at: NOW })) });

const ORG = { name: 'Little Oaks', address: '1 Oak St', timezone: 'UTC' };

async function newOrg(admin: string, over: Partial<typeof ORG> = {}): Promise<string> {
  const res = await call('POST', '/api/orgs', admin, { ...ORG, ...over });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}
async function newClassroom(admin: string, orgId: string, name = 'Sunflowers'): Promise<string> {
  const res = await call('POST', `/api/orgs/${orgId}/classrooms`, admin, { name, emoji: '🌻' });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}
/** Adds `teacher` to the org via a real staff invite redemption (PIN 1234), then staffs `classroomIds`. */
async function addTeacher(admin: string, orgId: string, teacher: string, classroomIds: string[]) {
  const inv = await json<{ code: string }>(await call('POST', `/api/orgs/${orgId}/invites/staff`, admin));
  expect((await call('POST', '/api/invites/redeem', teacher, { code: inv.code, pin: '1234' })).status).toBe(200);
  for (const cl of classroomIds) {
    const current = await q<{ user_id: string }>('SELECT user_id FROM classroom_staff WHERE classroom_id = ?', cl);
    const res = await call('PUT', `/api/classrooms/${cl}/staff`, admin, { userIds: [...current.map((r) => r.user_id), teacher] });
    expect(res.status).toBe(200);
  }
}
async function enroll(admin: string, orgId: string, classroomId: string, childName: string) {
  const res = await call('POST', `/api/orgs/${orgId}/enrollments`, admin, { childName, classroomId });
  expect(res.status).toBe(201);
  return json<{ enrollment: { id: string; status: string; childId: string | null }; code: string }>(res);
}
type Tile = { enrollmentId: string; childId?: string; name: string; status: string; readyAvatars: { avatarId: string; parentTitle: string }[] };
const roster = async (user: string, orgId: string, qs = '') => (await json<{ tiles: Tile[] }>(await call('GET', `/api/orgs/${orgId}/roster${qs}`, user))).tiles;

describe('orgs', () => {
  it('creator becomes admin; GET for members only; PATCH admin only', async () => {
    await users('ogA', 'ogX', 'ogT');
    const orgId = await newOrg('ogA');
    expect(await q('SELECT role FROM org_member WHERE org_id = ? AND user_id = ?', orgId, 'ogA')).toEqual([{ role: 'admin' }]);
    const got = await json(await call('GET', `/api/orgs/${orgId}`, 'ogA'));
    expect(got).toMatchObject({ id: orgId, name: 'Little Oaks', address: '1 Oak St', timezone: 'UTC', role: 'admin' });
    expect(await errCode(await call('GET', `/api/orgs/${orgId}`, 'ogX'))).toBe('FORBIDDEN');

    await addTeacher('ogA', orgId, 'ogT', []);
    expect((await json(await call('GET', `/api/orgs/${orgId}`, 'ogT'))).role).toBe('teacher');
    expect(await errCode(await call('PATCH', `/api/orgs/${orgId}`, 'ogT', { name: 'Hijack' }))).toBe('FORBIDDEN');

    const patched = await call('PATCH', `/api/orgs/${orgId}`, 'ogA', { name: 'Big Oaks', timezone: 'America/Chicago' });
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ name: 'Big Oaks', timezone: 'America/Chicago', address: '1 Oak St' });
  });

  it('validates body: bad timezone, foreign logo key', async () => {
    await users('ogV');
    expect(await errCode(await call('POST', '/api/orgs', 'ogV', { ...ORG, timezone: 'Mars/Base' }))).toBe('INVALID');
    // logoKey is not accepted on create (set with PATCH after upload).
    expect(await errCode(await call('POST', '/api/orgs', 'ogV', { ...ORG, logoKey: `logo/x/${'a'.repeat(21)}.png` }))).toBe('INVALID');
    expect(await q('SELECT 1 FROM org_member WHERE user_id = ?', 'ogV')).toHaveLength(0);
    const orgId = await newOrg('ogV');
    const good = `logo/${orgId}/${'a'.repeat(21)}.png`;
    expect((await call('PATCH', `/api/orgs/${orgId}`, 'ogV', { logoKey: good })).status).toBe(200);
    expect(await errCode(await call('PATCH', `/api/orgs/${orgId}`, 'ogV', { logoKey: `logo/other/${'a'.repeat(21)}.png` }))).toBe('INVALID');
    expect(await errCode(await call('PATCH', `/api/orgs/${orgId}`, 'ogV', { logoKey: `logo/${orgId}/${'a'.repeat(21)}xpng` }))).toBe('INVALID');
  });
});

describe('org logo url', () => {
  it('GET and PATCH return a signed logoUrl (1h) when a logo is set, null otherwise', async () => {
    await users('ogLogo');
    const orgId = await newOrg('ogLogo');
    expect(await json(await call('GET', `/api/orgs/${orgId}`, 'ogLogo'))).toMatchObject({ logoKey: null, logoUrl: null });
    const key = `logo/${orgId}/${'b'.repeat(21)}.png`;
    const patched = await json(await call('PATCH', `/api/orgs/${orgId}`, 'ogLogo', { logoKey: key }));
    expect(patched.logoKey).toBe(key);
    expect(patched.logoUrl).toContain(`/m/${encodeURIComponent(key)}?exp=`);
    const got = await json(await call('GET', `/api/orgs/${orgId}`, 'ogLogo'));
    expect(got.logoUrl).toContain(`/m/${encodeURIComponent(key)}?exp=`);
    const exp = Number(/exp=(\d+)/.exec(got.logoUrl)![1]);
    // At least the 1 h TTL, rounded up to the next whole hour (so refetches give the same URL): under 2 h away.
    expect(exp).toBeGreaterThanOrEqual(Date.now() + 3_600_000 - 5_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000);
    expect(exp % 3_600_000).toBe(0);
    const cleared = await json(await call('PATCH', `/api/orgs/${orgId}`, 'ogLogo', { logoKey: null }));
    expect(cleared).toMatchObject({ logoKey: null, logoUrl: null });
  });
});

describe('classrooms + staff', () => {
  it('admin creates and lists classrooms; non-admin cannot create', async () => {
    await users('ogC', 'ogCT', 'ogCX');
    const orgId = await newOrg('ogC');
    const a = await newClassroom('ogC', orgId, 'Sunflowers');
    const b = await call('POST', `/api/orgs/${orgId}/classrooms`, 'ogC', { name: 'Rainbows', assetKey: 'classroom.rainbows' });
    expect(b.status).toBe(201);
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/classrooms`, 'ogC', { name: 'Both', emoji: '🌈', assetKey: 'x' }))).toBe('INVALID');
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/classrooms`, 'ogC', { name: 'Neither' }))).toBe('INVALID');

    await addTeacher('ogC', orgId, 'ogCT', [a]);
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/classrooms`, 'ogCT', { name: 'Mine', emoji: '🐝' }))).toBe('FORBIDDEN');
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/classrooms`, 'ogCX', { name: 'Mine', emoji: '🐝' }))).toBe('FORBIDDEN');

    const list = await json<{ classrooms: { id: string; name: string; emoji: string | null; assetKey: string | null; staffUserIds: string[] }[] }>(
      await call('GET', `/api/orgs/${orgId}/classrooms`, 'ogC'),
    );
    expect(list.classrooms.map((x) => x.name)).toEqual(['Rainbows', 'Sunflowers']);
    expect(list.classrooms[0]).toMatchObject({ emoji: null, assetKey: 'classroom.rainbows', staffUserIds: [] });
    expect(list.classrooms[1]).toMatchObject({ id: a, emoji: '🌻', assetKey: null, staffUserIds: ['ogCT'] });
  });

  it('PUT staff: admin of the classroom org only; every user must be an org member; replaces the set', async () => {
    await users('ogP', 'ogPT', 'ogPT2', 'ogPX', 'ogQ');
    const orgId = await newOrg('ogP');
    const other = await newOrg('ogQ');
    const cl = await newClassroom('ogP', orgId);
    await addTeacher('ogP', orgId, 'ogPT', [cl]);
    await addTeacher('ogP', orgId, 'ogPT2', []);
    expect(await errCode(await call('PUT', `/api/classrooms/${cl}/staff`, 'ogP', { userIds: ['ogPX'] }))).toBe('INVALID');
    expect(await errCode(await call('PUT', `/api/classrooms/${cl}/staff`, 'ogQ', { userIds: [] }))).toBe('FORBIDDEN');
    expect(await errCode(await call('PUT', `/api/classrooms/${cl}/staff`, 'ogPT', { userIds: ['ogPT'] }))).toBe('FORBIDDEN');
    expect(await errCode(await call('PUT', `/api/classrooms/nope/staff`, 'ogP', { userIds: [] }))).toBe('NOT_FOUND');
    // Another org's admin is not a member of this org.
    expect(await errCode(await call('PUT', `/api/classrooms/${cl}/staff`, 'ogP', { userIds: ['ogQ'] }))).toBe('INVALID');
    expect(other).toBeTruthy();

    expect((await call('PUT', `/api/classrooms/${cl}/staff`, 'ogP', { userIds: ['ogPT2', 'ogP'] })).status).toBe(200);
    expect((await q<{ user_id: string }>('SELECT user_id FROM classroom_staff WHERE classroom_id = ? ORDER BY user_id', cl)).map((r) => r.user_id)).toEqual([
      'ogP',
      'ogPT2',
    ]);
  });

  it('GET staff lists members with hasPin; non-admin forbidden', async () => {
    await users('ogS', 'ogST');
    const orgId = await newOrg('ogS');
    const cl = await newClassroom('ogS', orgId);
    await addTeacher('ogS', orgId, 'ogST', [cl]);
    const res = await json<{ staff: { userId: string; name: string; role: string; hasPin: boolean; classroomIds: string[] }[] }>(
      await call('GET', `/api/orgs/${orgId}/staff`, 'ogS'),
    );
    expect(res.staff).toEqual([
      { userId: 'ogS', name: 'N ogS', email: 'ogS@x', role: 'admin', hasPin: false, classroomIds: [] },
      { userId: 'ogST', name: 'N ogST', email: 'ogST@x', role: 'teacher', hasPin: true, classroomIds: [cl] },
    ]);
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/staff`, 'ogST'))).toBe('FORBIDDEN');
  });

  it('staff invite returns code + expiry and is admin only', async () => {
    await users('ogI', 'ogIX');
    const orgId = await newOrg('ogI');
    const res = await json<{ code: string; expiresAt: number }>(await call('POST', `/api/orgs/${orgId}/invites/staff`, 'ogI'));
    expect(res.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(res.expiresAt).toBeGreaterThan(NOW);
    const [row] = await q<{ type: string; payload: string }>('SELECT type, payload FROM invite_code WHERE code = ?', res.code);
    expect(row).toEqual({ type: 'staff', payload: JSON.stringify({ orgId }) });
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/invites/staff`, 'ogIX'))).toBe('FORBIDDEN');
  });

  it('removing staff deletes member, classroom staff, PIN and clears access', async () => {
    await users('ogR', 'ogRT', 'ogRP');
    const orgId = await newOrg('ogR');
    const cl = await newClassroom('ogR', orgId);
    await addTeacher('ogR', orgId, 'ogRT', [cl]);
    const e = await enroll('ogR', orgId, cl, 'Ava');
    expect((await call('POST', '/api/invites/redeem', 'ogRP', { code: e.code })).status).toBe(200);
    expect(await roster('ogRT', orgId)).toHaveLength(1);
    expect(await caregiverChildIds(env, 'ogRT')).toHaveLength(1);

    expect(await errCode(await call('DELETE', `/api/orgs/${orgId}/staff/ogRT`, 'ogRT'))).toBe('FORBIDDEN');
    expect((await call('DELETE', `/api/orgs/${orgId}/staff/ogRT`, 'ogR')).status).toBe(200);
    expect(await q('SELECT 1 FROM org_member WHERE user_id = ?', 'ogRT')).toHaveLength(0);
    expect(await q('SELECT 1 FROM classroom_staff WHERE user_id = ?', 'ogRT')).toHaveLength(0);
    expect(await q('SELECT 1 FROM staff_pin WHERE user_id = ?', 'ogRT')).toHaveLength(0);
    expect(await caregiverChildIds(env, 'ogRT')).toEqual([]);
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/roster`, 'ogRT'))).toBe('FORBIDDEN');
    expect(await errCode(await call('DELETE', `/api/orgs/${orgId}/staff/ogRT`, 'ogR'))).toBe('NOT_FOUND');
  });

  it('cannot remove the last admin', async () => {
    await users('ogL', 'ogL2');
    const orgId = await newOrg('ogL');
    expect(await errCode(await call('DELETE', `/api/orgs/${orgId}/staff/ogL`, 'ogL'))).toBe('INVALID');
    expect(await q('SELECT 1 FROM org_member WHERE org_id = ? AND user_id = ?', orgId, 'ogL')).toHaveLength(1);
    await seedRows(env, { org_member: [{ org_id: orgId, user_id: 'ogL2', role: 'admin' }] });
    expect((await call('DELETE', `/api/orgs/${orgId}/staff/ogL`, 'ogL2')).status).toBe(200);
    expect(await errCode(await call('DELETE', `/api/orgs/${orgId}/staff/ogL2`, 'ogL2'))).toBe('INVALID');
  });
});

describe('classroom edit', () => {
  it('PATCH renames and re-badges a classroom; admin of the org only; emoji xor assetKey', async () => {
    await users('ogCe', 'ogCx');
    const orgId = await newOrg('ogCe');
    const cl = await newClassroom('ogCe', orgId, 'Sunflowers');
    await users('ogCt');
    await addTeacher('ogCe', orgId, 'ogCt', [cl]);

    const res = await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { name: 'Owls', assetKey: 'classroom.owls' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: cl, name: 'Owls', emoji: null, assetKey: 'classroom.owls', staffUserIds: ['ogCt'] });
    const listed = await json<{ classrooms: { id: string; name: string; assetKey: string | null }[] }>(await call('GET', `/api/orgs/${orgId}/classrooms`, 'ogCe'));
    expect(listed.classrooms.find((c) => c.id === cl)).toMatchObject({ name: 'Owls', assetKey: 'classroom.owls' });

    // Name only keeps the badge; switching back to an emoji clears the asset.
    expect(await json(await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { name: 'Night Owls' }))).toMatchObject({ name: 'Night Owls', assetKey: 'classroom.owls' });
    expect(await json(await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { emoji: '🌻' }))).toMatchObject({ emoji: '🌻', assetKey: null });

    expect(await errCode(await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { emoji: '🌻', assetKey: 'classroom.owls' }))).toBe('INVALID');
    expect(await errCode(await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { name: '  ' }))).toBe('INVALID');
    expect(await errCode(await call('PATCH', `/api/classrooms/${cl}`, 'ogCe', { emoji: 'asset:classroom.owls' }))).toBe('INVALID');
    expect(await errCode(await call('PATCH', `/api/classrooms/${cl}`, 'ogCt', { name: 'Hijack' }))).toBe('FORBIDDEN');
    expect(await errCode(await call('PATCH', `/api/classrooms/${cl}`, 'ogCx', { name: 'Hijack' }))).toBe('FORBIDDEN');
    expect(await errCode(await call('PATCH', '/api/classrooms/nope', 'ogCe', { name: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('enrollments', () => {
  it('admin creates enrollment + parent invite in one flow; lists them', async () => {
    await users('ogE');
    const orgId = await newOrg('ogE');
    const cl = await newClassroom('ogE', orgId);
    const e = await enroll('ogE', orgId, cl, 'Ben');
    expect(e.enrollment).toMatchObject({ orgId, classroomId: cl, childName: 'Ben', status: 'invited', childId: null, inviteCode: e.code });
    const [inv] = await q<{ type: string; payload: string }>('SELECT type, payload FROM invite_code WHERE code = ?', e.code);
    expect(inv!.type).toBe('parent_enrollment');
    expect(JSON.parse(inv!.payload)).toEqual({ orgId, enrollmentId: e.enrollment.id });
    const list = await json<{ enrollments: { id: string; childName: string }[] }>(await call('GET', `/api/orgs/${orgId}/enrollments`, 'ogE'));
    expect(list.enrollments.map((x) => x.id)).toEqual([e.enrollment.id]);
  });

  it('non-admin cannot create or list enrollments', async () => {
    await users('ogN', 'ogNT');
    const orgId = await newOrg('ogN');
    const cl = await newClassroom('ogN', orgId);
    await addTeacher('ogN', orgId, 'ogNT', [cl]);
    expect(await errCode(await call('POST', `/api/orgs/${orgId}/enrollments`, 'ogNT', { childName: 'X', classroomId: cl }))).toBe('FORBIDDEN');
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/enrollments`, 'ogNT'))).toBe('FORBIDDEN');
    expect(await q('SELECT 1 FROM enrollment WHERE org_id = ?', orgId)).toHaveLength(0);
  });

  it("a classroom from another org is rejected", async () => {
    await users('ogF', 'ogG');
    const orgId = await newOrg('ogF');
    const otherOrg = await newOrg('ogG');
    const foreign = await newClassroom('ogG', otherOrg);
    const res = await call('POST', `/api/orgs/${orgId}/enrollments`, 'ogF', { childName: 'X', classroomId: foreign });
    expect(await errCode(res)).toBe('INVALID');
    expect(await q('SELECT 1 FROM enrollment WHERE org_id = ?', orgId)).toHaveLength(0);
    expect(await q("SELECT 1 FROM invite_code WHERE type = 'parent_enrollment' AND created_by = ?", 'ogF')).toHaveLength(0);
  });
});

describe('roster', () => {
  it('status: invite_sent -> setup_pending after redeem -> ready after approve', async () => {
    await users('ogW', 'ogWP', 'ogWP2');
    const orgId = await newOrg('ogW');
    const cl = await newClassroom('ogW', orgId);
    const e = await enroll('ogW', orgId, cl, 'Cora');

    let tiles = await roster('ogW', orgId);
    expect(tiles).toEqual([{ enrollmentId: e.enrollment.id, name: 'Cora', status: 'invite_sent', readyAvatars: [] }]);

    expect((await call('POST', '/api/invites/redeem', 'ogWP', { code: e.code })).status).toBe(200);
    tiles = await roster('ogW', orgId);
    const childId = tiles[0]!.childId!;
    expect(childId).toBeTruthy();
    expect(tiles[0]).toMatchObject({ status: 'setup_pending', readyAvatars: [] });

    // An avatar that is merely 'ready' (not approved) does not count.
    await seedRows(env, { avatar: [{ id: 'ogWav1', user_id: 'ogWP', status: 'ready' }] });
    expect((await roster('ogW', orgId))[0]!.status).toBe('setup_pending');

    await env.DB.prepare(`UPDATE avatar SET status = 'approved', approved_at = ? WHERE id = 'ogWav1'`).bind(NOW).run();
    tiles = await roster('ogW', orgId);
    expect(tiles[0]).toMatchObject({ status: 'ready', readyAvatars: [{ avatarId: 'ogWav1', parentTitle: 'Mom' }] });

    // Co-parent's approved avatar with a plan title; outsider's approved avatar never shows.
    const [fm] = await q<{ family_id: string }>('SELECT family_id FROM family_member WHERE user_id = ?', 'ogWP');
    await seedRows(env, {
      family_member: [{ family_id: fm!.family_id, user_id: 'ogWP2' }],
      avatar: [
        { id: 'ogWav2', user_id: 'ogWP2', status: 'approved' },
        { id: 'ogWav3', user_id: 'ogW', status: 'approved' },
      ],
      comfort_plan: [{ child_id: childId, avatar_id: 'ogWav2', parent_title: 'Papa' }],
    });
    tiles = await roster('ogW', orgId);
    expect(tiles[0]!.readyAvatars).toEqual([
      { avatarId: 'ogWav1', parentTitle: 'Mom', parentName: 'N' },
      { avatarId: 'ogWav2', parentTitle: 'Papa', parentName: 'N' },
    ]);
  });

  it("a teacher's roster excludes other classrooms", async () => {
    await users('ogK', 'ogKT', 'ogKP1', 'ogKP2', 'ogKX');
    const orgId = await newOrg('ogK');
    const a = await newClassroom('ogK', orgId, 'A');
    const b = await newClassroom('ogK', orgId, 'B');
    await addTeacher('ogK', orgId, 'ogKT', [a]);
    const ea = await enroll('ogK', orgId, a, 'InA');
    const eb = await enroll('ogK', orgId, b, 'InB');
    const ea2 = await enroll('ogK', orgId, a, 'InA-pending');
    const eb2 = await enroll('ogK', orgId, b, 'InB-pending');
    await call('POST', '/api/invites/redeem', 'ogKP1', { code: ea.code });
    await call('POST', '/api/invites/redeem', 'ogKP2', { code: eb.code });

    const t = await roster('ogKT', orgId);
    expect(t.map((x) => x.enrollmentId).sort()).toEqual([ea.enrollment.id, ea2.enrollment.id].sort());
    expect(await roster('ogKT', orgId, `?classroomId=${b}`)).toEqual([]);
    expect((await roster('ogKT', orgId, `?classroomId=${a}`)).map((x) => x.name).sort()).toEqual(['InA', 'InA-pending']);

    const all = await roster('ogK', orgId);
    expect(all.map((x) => x.enrollmentId).sort()).toEqual([ea, eb, ea2, eb2].map((x) => x.enrollment.id).sort());
    expect((await roster('ogK', orgId, `?classroomId=${b}`)).map((x) => x.name).sort()).toEqual(['InB', 'InB-pending']);
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/roster`, 'ogKX'))).toBe('FORBIDDEN');
  });
});

describe('dashboard + flags', () => {
  it('counts only this org; ack removes an open flag; admin only', async () => {
    await users('ogD', 'ogDP', 'ogDP2', 'ogDT', 'ogZ', 'ogZP');
    const orgId = await newOrg('ogD');
    const otherOrg = await newOrg('ogZ');
    const cl = await newClassroom('ogD', orgId);
    const ocl = await newClassroom('ogZ', otherOrg);
    await addTeacher('ogD', orgId, 'ogDT', [cl]);
    const e = await enroll('ogD', orgId, cl, 'Dina');
    await call('POST', '/api/invites/redeem', 'ogDP', { code: e.code });
    const e2 = await enroll('ogD', orgId, cl, 'Eli'); // linked, no avatar
    await call('POST', '/api/invites/redeem', 'ogDP2', { code: e2.code });
    const oe = await enroll('ogZ', otherOrg, ocl, 'Other');
    await call('POST', '/api/invites/redeem', 'ogZP', { code: oe.code });
    const kid = (await q<{ child_id: string }>('SELECT child_id FROM enrollment WHERE id = ?', e.enrollment.id))[0]!.child_id;
    const okid = (await q<{ child_id: string }>('SELECT child_id FROM enrollment WHERE id = ?', oe.enrollment.id))[0]!.child_id;
    await seedRows(env, {
      avatar: [
        { id: 'ogDav', user_id: 'ogDP', status: 'approved' },
        { id: 'ogZav', user_id: 'ogZP', status: 'approved' },
      ],
    });

    const now = Date.now();
    const d = new Date(now);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const sess = (id: string, org: string, child: string, av: string, at: number, cost: number) => ({
      id, child_id: child, avatar_id: av, caregiver_user_id: 'ogDT', org_id: org, started_at: at, cost_usd: cost, status: 'ended',
    });
    const yesterday = dayStart - 60_000;
    await seedRows(env, {
      comfort_session: [
        sess('ogDs1', orgId, kid, 'ogDav', now - 1000, 0.5),
        sess('ogDs2', orgId, kid, 'ogDav', dayStart + 1, 0.25),
        sess('ogDs3', orgId, kid, 'ogDav', yesterday, 1),
        sess('ogDs4', orgId, kid, 'ogDav', monthStart - 60_000, 7), // last month
        sess('ogZs1', otherOrg, okid, 'ogZav', now - 1000, 9),
        // Neither a failed start nor a test call is a comfort session: they never count.
        { ...sess('ogDsF', orgId, kid, 'ogDav', now - 2000, 0), status: 'failed' },
        { ...sess('ogDsT', orgId, kid, 'ogDav', now - 3000, 0), kind: 'test', child_id: null },
      ],
      session_flag: [
        { id: 'ogDf1', session_id: 'ogDs1', source: 'live', category: 'injury', quote: 'my knee', severity: 'medium', created_at: now - 500 },
        { id: 'ogDf2', session_id: 'ogDs2', source: 'post', category: 'other', quote: null, severity: 'low', created_at: now - 900, acknowledged_by: 'ogD', acknowledged_at: now },
        { id: 'ogZf1', session_id: 'ogZs1', source: 'live', category: 'unsafe', quote: 'x', severity: 'high', created_at: now - 100 },
      ],
    });

    const yesterdayInMonth = yesterday >= monthStart;
    const dash = await json(await call('GET', `/api/orgs/${orgId}/dashboard`, 'ogD'));
    expect(dash).toEqual({
      readyCount: 1,
      todaySessions: 2,
      openFlags: [{ id: 'ogDf1', sessionId: 'ogDs1', childName: 'Dina', category: 'injury', quote: 'my knee', severity: 'medium', createdAt: now - 500 }],
      monthSessions: yesterdayInMonth ? 3 : 2,
      monthCostUsd: yesterdayInMonth ? 1.75 : 0.75,
    });
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/dashboard`, 'ogDT'))).toBe('FORBIDDEN');

    // Ack: admin of the flag's session org only.
    expect(await errCode(await call('POST', '/api/flags/ogDf1/ack', 'ogZ'))).toBe('FORBIDDEN');
    expect(await errCode(await call('POST', '/api/flags/ogDf1/ack', 'ogDT'))).toBe('FORBIDDEN');
    expect(await errCode(await call('POST', '/api/flags/nope/ack', 'ogD'))).toBe('NOT_FOUND');
    expect((await call('POST', '/api/flags/ogDf1/ack', 'ogD')).status).toBe(200);
    expect(await q('SELECT acknowledged_by FROM session_flag WHERE id = ?', 'ogDf1')).toEqual([{ acknowledged_by: 'ogD' }]);
    expect((await json(await call('GET', `/api/orgs/${orgId}/dashboard`, 'ogD'))).openFlags).toEqual([]);
    // Idempotent: a second ack keeps the first acknowledger.
    expect((await call('POST', '/api/flags/ogDf1/ack', 'ogD')).status).toBe(200);
  });
});

describe('org time boundaries', () => {
  it('day and month start in a DST zone', () => {
    // 2026-03-08 is the US spring-forward day (23h long) in America/New_York.
    const ny = 'America/New_York';
    const t = Date.UTC(2026, 2, 9, 4, 30); // 2026-03-09 00:30 EDT (UTC-4)
    expect(orgDayStart(ny, t)).toBe(Date.UTC(2026, 2, 9, 4, 0));
    expect(orgDayStart(ny, Date.UTC(2026, 2, 8, 12))).toBe(Date.UTC(2026, 2, 8, 5, 0)); // midnight EST
    expect(orgMonthStart(ny, t)).toBe(Date.UTC(2026, 2, 1, 5, 0));
    // 2026-11-01 fall-back day (25h): 23:30 local is 04:30Z next day.
    expect(orgDayStart(ny, Date.UTC(2026, 10, 2, 4, 30))).toBe(Date.UTC(2026, 10, 1, 4, 0));
    expect(orgMonthStart('UTC', Date.UTC(2026, 0, 1, 0, 0))).toBe(Date.UTC(2026, 0, 1));
    expect(orgMonthStart('Pacific/Kiritimati', Date.UTC(2026, 4, 31, 11))).toBe(Date.UTC(2026, 4, 31, 10)); // June 1 local
  });
});

describe('my-classrooms and staff/switch', () => {
  it("a teacher gets only their staffed classrooms; an admin gets all; an outsider is refused", async () => {
    await users('mcA', 'mcT', 'mcX');
    const orgId = await newOrg('mcA');
    const a = await newClassroom('mcA', orgId, 'Ants');
    const b = await newClassroom('mcA', orgId, 'Bees');
    await addTeacher('mcA', orgId, 'mcT', [b]);
    const mine = await json<{ classrooms: { id: string; name: string; emoji: string | null; assetKey: string | null }[] }>(await call('GET', `/api/orgs/${orgId}/my-classrooms`, 'mcT'));
    expect(mine.classrooms.map((c) => c.id)).toEqual([b]);
    expect(mine.classrooms[0]).toMatchObject({ name: 'Bees', emoji: '🌻', assetKey: null });
    const all = await json<{ classrooms: { id: string }[] }>(await call('GET', `/api/orgs/${orgId}/my-classrooms`, 'mcA'));
    expect(all.classrooms.map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/my-classrooms`, 'mcX'))).toBe('FORBIDDEN');
  });

  it('staff/switch lists names + hasPin only, for any member on a registered device', async () => {
    await users('swA', 'swT', 'swX');
    const orgId = await newOrg('swA');
    await addTeacher('swA', orgId, 'swT', []);
    const { deviceId } = await json<{ deviceId: string }>(await call('POST', `/api/orgs/${orgId}/devices`, 'swT'));
    const res = await call('GET', `/api/orgs/${orgId}/staff/switch?deviceId=${deviceId}`, 'swT');
    expect(res.status).toBe(200);
    const { staff } = await json<{ staff: Record<string, unknown>[] }>(res);
    expect(staff.map((s) => Object.keys(s).sort())).toEqual(staff.map(() => ['hasPin', 'name', 'userId']));
    expect(staff.find((s) => s.userId === 'swT')).toMatchObject({ hasPin: true });
    expect(staff.find((s) => s.userId === 'swA')).toMatchObject({ hasPin: false });
    // not a member, no device, or a device of another org
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/staff/switch?deviceId=${deviceId}`, 'swX'))).toBe('FORBIDDEN');
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/staff/switch`, 'swT'))).toBe('DEVICE_UNKNOWN');
    expect(await errCode(await call('GET', `/api/orgs/${orgId}/staff/switch?deviceId=nope`, 'swT'))).toBe('DEVICE_UNKNOWN');
  });
});

describe('acting scope (X-Acting-Token)', () => {
  /** Tablet account `tab` (member of org A only), teacher `T` of A who is ALSO a home caregiver of another family's child. */
  let built: ReturnType<typeof build> | undefined;
  const world = () => (built ??= build());
  async function build() {
    await users('xtab', 'xT', 'xP1', 'xP2', 'xBadm');
    const kid = { name: 'Kid', birthday: '2022-03-04', timezone: 'America/New_York' };
    const c1 = (await json<{ id: string }>(await call('POST', '/api/children', 'xP1', { ...kid, name: 'DayKid' }))).id;
    const c2 = (await json<{ id: string }>(await call('POST', '/api/children', 'xP2', { ...kid, name: 'HomeKid' }))).id;
    await seedRows(env, {
      org: [
        { id: 'xorgA', name: 'A', timezone: 'UTC' },
        { id: 'xorgB', name: 'B', timezone: 'UTC' },
      ],
      org_member: [
        { org_id: 'xorgA', user_id: 'xtab', role: 'teacher' },
        { org_id: 'xorgA', user_id: 'xT', role: 'teacher' },
        { org_id: 'xorgB', user_id: 'xBadm', role: 'admin' },
      ],
      classroom: [
        { id: 'xclA1', org_id: 'xorgA', name: 'Ants' },
        { id: 'xclA2', org_id: 'xorgA', name: 'Bees' },
        { id: 'xclB1', org_id: 'xorgB', name: 'Owls' },
      ],
      classroom_staff: [{ classroom_id: 'xclA1', user_id: 'xT' }],
      classroom_child: [{ classroom_id: 'xclA1', child_id: c1 }],
      connection: [
        { id: 'xdc', child_id: c1, kind: 'daycare', org_id: 'xorgA', transcript_access: 0 },
        { id: 'xhome', child_id: c2, kind: 'home', caregiver_user_id: 'xT', transcript_access: 0 },
      ],
      device: [
        { id: 'xdevA', org_id: 'xorgA', registered_by: 'xtab', created_at: NOW },
        { id: 'xdevB', org_id: 'xorgB', registered_by: 'xBadm', created_at: NOW },
      ],
    });
    const token = await signActingToken(env, { deviceId: 'xdevA', orgId: 'xorgA', teacherUserId: 'xT', exp: NOW + 3_600_000 });
    const asTablet = (path: string, tok?: string) =>
      request(path, { headers: { ...authAs('xtab'), ...(tok ? { 'X-Acting-Token': tok } : {}) } });
    return { c1, c2, token, asTablet };
  }

  it('/caregiver/children: an acting tablet sees only the org children of the teacher, not their home-caregiver child', async () => {
    const { c1, c2, token, asTablet } = await world();
    const acting = await json<{ children: { id: string }[] }>(await asTablet('/api/caregiver/children', token));
    expect(acting.children.map((c) => c.id)).toEqual([c1]);
    // the same teacher signed in on their own phone does see both
    const own = await json<{ children: { id: string }[] }>(await call('GET', '/api/caregiver/children', 'xT'));
    expect(own.children.map((c) => c.id).sort()).toEqual([c1, c2].sort());
    // the tablet account alone reaches neither
    expect((await json<{ children: unknown[] }>(await asTablet('/api/caregiver/children'))).children).toEqual([]);
  });

  it('my-classrooms: an acting teacher lists only their own classrooms, and an org-A token cannot list org B', async () => {
    const { token, asTablet } = await world();
    const mine = await json<{ classrooms: { id: string }[] }>(await asTablet('/api/orgs/xorgA/my-classrooms', token));
    expect(mine.classrooms.map((c) => c.id)).toEqual(['xclA1']);
    const plain = await json<{ classrooms: { id: string }[] }>(await asTablet('/api/orgs/xorgA/my-classrooms'));
    expect(plain.classrooms).toEqual([]);
    const res = await asTablet('/api/orgs/xorgB/my-classrooms', token);
    expect(await errCode(res)).toBe('FORBIDDEN');
  });

  it('staff/switch refuses a real device that is registered to a different org', async () => {
    const { token, asTablet } = await world();
    expect(await errCode(await asTablet('/api/orgs/xorgA/staff/switch?deviceId=xdevB', token))).toBe('DEVICE_UNKNOWN');
    expect((await asTablet('/api/orgs/xorgA/staff/switch?deviceId=xdevA')).status).toBe(200);
  });
});
