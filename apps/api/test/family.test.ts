import { describe, it, expect, vi } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';

const deleteSession = vi.fn(async (_id: string) => {});
const { env, request } = makeApp({ napsterDeleteSession: (id) => deleteSession(id) });
const NOW = Date.now();

function call(method: string, path: string, user: string, body?: unknown) {
  return request(path, {
    method,
    headers: { ...authAs(user), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;
const q = <T>(sql: string, ...b: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...b)
    .all<T>()
    .then((r) => r.results);
const users = (...ids: string[]) => seedRows(env, { user: ids.map((id) => ({ id, name: `N ${id}`, email: `${id}@x`, created_at: NOW })) });
const fam = async (user: string) => ((await (await call('POST', '/api/families', user)).json()) as { id: string }).id;
const pk = (familyId: string, n = 'a', ext = 'jpg') => `child/${familyId}/${n.padEnd(21, 'x')}.${ext}`;
const kid = { name: 'Mia', birthday: '2022-03-04', timezone: 'America/New_York' };

describe('families', () => {
  it('concurrent first calls create exactly one family and return the same id', async () => {
    await users('fr');
    const [a, b] = await Promise.all([call('POST', '/api/families', 'fr'), call('POST', '/api/families', 'fr')]);
    const ia = ((await a.json()) as { id: string }).id;
    const ib = ((await b.json()) as { id: string }).id;
    expect(ia).toBe(ib);
    expect(await q('SELECT 1 FROM family_member WHERE user_id = ?', 'fr')).toHaveLength(1);
    expect(await q('SELECT 1 FROM family WHERE id NOT IN (SELECT family_id FROM family_member)')).toHaveLength(0);
  });

  it('POST /api/families is idempotent', async () => {
    await users('f1');
    const a = (await (await call('POST', '/api/families', 'f1')).json()) as { id: string };
    const b = (await (await call('POST', '/api/families', 'f1')).json()) as { id: string };
    expect(a.id).toBeTruthy();
    expect(b.id).toBe(a.id);
    expect(await q('SELECT 1 FROM family_member WHERE user_id = ?', 'f1')).toHaveLength(1);
  });
});

describe('children', () => {
  it('parent creates (family auto-created) and lists only their own children', async () => {
    await users('c1', 'c2');
    const res = await call('POST', '/api/children', 'c1', kid);
    expect(res.status).toBe(201);
    await call('POST', '/api/children', 'c2', { ...kid, name: 'Other' });
    const list = (await (await call('GET', '/api/children', 'c1')).json()) as { children: { name: string; birthday?: string }[] };
    expect(list.children.map((x) => x.name)).toEqual(['Mia']);
    expect(list.children[0]!.birthday).toBe('2022-03-04');
  });

  it('validates body: bad timezone, bad birthday', async () => {
    await users('c3');
    expect(await errCode(await call('POST', '/api/children', 'c3', { ...kid, timezone: 'Mars/Base' }))).toBe('INVALID');
    expect(await errCode(await call('POST', '/api/children', 'c3', { ...kid, birthday: '2022-02-30' }))).toBe('INVALID');
    expect(await errCode(await call('POST', '/api/children', 'c3', { ...kid, birthday: 'yesterday' }))).toBe('INVALID');
  });

  it('parent can PATCH; non-parent PATCH/DELETE -> FORBIDDEN', async () => {
    await users('p1', 'np1');
    const { id } = (await (await call('POST', '/api/children', 'p1', kid)).json()) as { id: string };
    const ok = await call('PATCH', `/api/children/${id}`, 'p1', { name: 'Mia R' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { name: string }).name).toBe('Mia R');
    const bad = await call('PATCH', `/api/children/${id}`, 'np1', { name: 'Hax' });
    expect(bad.status).toBe(403);
    expect(await errCode(bad)).toBe('FORBIDDEN');
    expect((await call('DELETE', `/api/children/${id}`, 'np1')).status).toBe(403);
    expect((await q<{ name: string }>('SELECT name FROM child WHERE id = ?', id))[0]!.name).toBe('Mia R');
  });

  it('home caregiver can read (name + photo only) but not edit', async () => {
    await users('rp', 'rn');
    const rpKey = pk(await fam('rp'));
    const { id, familyId } = (await (await call('POST', '/api/children', 'rp', { ...kid, photoKey: rpKey })).json()) as {
      id: string;
      familyId: string;
    };
    await seedRows(env, { connection: [{ id: 'rconn', child_id: id, kind: 'home', caregiver_user_id: 'rn', transcript_access: 0 }] });
    const one = (await (await call('GET', `/api/children/${id}`, 'rn')).json()) as Record<string, unknown>;
    expect(one).toEqual({ id, name: 'Mia', photoUrl: expect.stringContaining('/m/') });
    expect(JSON.stringify(one)).not.toContain(rpKey);
    expect(one.birthday).toBeUndefined();
    const list = (await (await call('GET', '/api/children', 'rn')).json()) as { children: Record<string, unknown>[] };
    expect(list.children).toEqual([{ id, name: 'Mia', photoUrl: expect.stringContaining('/m/') }]);
    expect((await call('PATCH', `/api/children/${id}`, 'rn', { name: 'X' })).status).toBe(403);
    expect((await call('GET', `/api/children/${id}/caregivers`, 'rn')).status).toBe(403);
    // parent sees everything
    const p = (await (await call('GET', `/api/children/${id}`, 'rp')).json()) as Record<string, unknown>;
    expect(p.birthday).toBe('2022-03-04');
    expect(p.familyId).toBe(familyId);
    // a stranger gets nothing
    await users('rstranger');
    expect((await call('GET', `/api/children/${id}`, 'rstranger')).status).toBe(403);
  });
});

describe('photo keys', () => {
  it('rejects cross-family and arbitrary keys; accepts own-family key', async () => {
    await users('k1', 'k2');
    const f1 = await fam('k1');
    const f2 = await fam('k2');
    for (const bad of [pk(f2), 'child/' + f1 + '/short.jpg', 'kids/x.jpg', pk(f1, 'a', 'gif'), `child/${f1}/../${f2}/${'a'.repeat(21)}.jpg`]) {
      expect(await errCode(await call('POST', '/api/children', 'k1', { ...kid, photoKey: bad }))).toBe('INVALID');
    }
    const ok = await call('POST', '/api/children', 'k1', { ...kid, photoKey: pk(f1) });
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    expect(await errCode(await call('PATCH', `/api/children/${id}`, 'k1', { photoKey: pk(f2) }))).toBe('INVALID');
    expect((await call('PATCH', `/api/children/${id}`, 'k1', { photoKey: pk(f1, 'b', 'png') })).status).toBe(200);
  });

  it('PATCH replace deletes the old object; null clears and deletes; R2 failure does not fail', async () => {
    await users('k3');
    const f = await fam('k3');
    const k1 = pk(f, 'one');
    const k2 = pk(f, 'two', 'webp');
    const { id } = (await (await call('POST', '/api/children', 'k3', { ...kid, photoKey: k1 })).json()) as { id: string };
    await env.MEDIA.put(k1, 'x');
    await env.MEDIA.put(k2, 'y');
    const rep = await call('PATCH', `/api/children/${id}`, 'k3', { photoKey: k2 });
    expect(rep.status).toBe(200);
    expect(await env.MEDIA.get(k1)).toBeNull();
    expect(await env.MEDIA.get(k2)).not.toBeNull();
    const clr = await call('PATCH', `/api/children/${id}`, 'k3', { photoKey: null });
    expect(((await clr.json()) as { photoKey: string | null }).photoKey).toBeNull();
    expect(await env.MEDIA.get(k2)).toBeNull();
    // R2 failure must not fail the request
    await call('PATCH', `/api/children/${id}`, 'k3', { photoKey: k1 });
    const spy = vi.spyOn(env.MEDIA, 'delete').mockRejectedValue(new Error('r2 down'));
    try {
      expect((await call('PATCH', `/api/children/${id}`, 'k3', { photoKey: null })).status).toBe(200);
      expect((await call('DELETE', `/api/children/${id}`, 'k3')).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('delete cascade', () => {
  async function seedFull() {
    await users('d1', 'dt', 'dadm');
    const dKey = pk(await fam('d1'), 'd');
    const { id } = (await (await call('POST', '/api/children', 'd1', { ...kid, photoKey: dKey })).json()) as { id: string };
    await env.MEDIA.put(dKey, 'x');
    await seedRows(env, {
      org: [{ id: 'dorg', name: 'Sunny', timezone: 'UTC' }],
      classroom: [{ id: 'dcl', org_id: 'dorg', name: 'Bees' }],
      classroom_child: [{ classroom_id: 'dcl', child_id: id }],
      avatar: [{ id: 'dav', user_id: 'd1', status: 'approved' }],
      comfort_plan: [{ child_id: id, avatar_id: 'dav', parent_title: 'Mommy' }],
      connection: [{ id: 'dconn', child_id: id, kind: 'daycare', org_id: 'dorg', transcript_access: 0 }],
      enrollment: [{ id: 'denr', org_id: 'dorg', classroom_id: 'dcl', child_name: 'Mia', invite_code: 'DEN123', child_id: id, status: 'linked', created_at: NOW }],
      comfort_session: [
        { id: 'ds1', napster_session_id: 'nap-1', child_id: id, avatar_id: 'dav', caregiver_user_id: 'dt', started_at: NOW },
        { id: 'ds2', napster_session_id: null, child_id: id, avatar_id: 'dav', caregiver_user_id: 'dt', started_at: NOW },
      ],
      session_flag: [{ id: 'dfl', session_id: 'ds1', source: 'live', category: 'other', severity: 'low', created_at: NOW }],
      alert: [
        { id: 'dal1', user_id: 'd1', kind: 'summary', ref_id: 'ds1', title: 't', created_at: NOW },
        { id: 'dal2', user_id: 'd1', kind: 'flag', ref_id: 'dfl', title: 't', created_at: NOW },
        { id: 'dal3', user_id: 'd1', kind: 'invite', ref_id: 'unrelated', title: 't', created_at: NOW },
      ],
    });
    return id;
  }

  it('removes sessions, flags, alerts, plan, links, photo; calls Napster per session; keeps enrollment unlinked', async () => {
    deleteSession.mockClear();
    const id = await seedFull();
    const res = await call('DELETE', `/api/children/${id}`, 'd1');
    expect(res.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith('nap-1');
    for (const t of ['comfort_session', 'comfort_plan', 'connection', 'classroom_child']) {
      expect(await q(`SELECT 1 FROM ${t} WHERE child_id = ?`, id)).toHaveLength(0);
    }
    expect(await q('SELECT 1 FROM session_flag WHERE session_id = ?', 'ds1')).toHaveLength(0);
    expect((await q<{ id: string }>(`SELECT id FROM alert WHERE user_id = 'd1'`)).map((a) => a.id)).toEqual(['dal3']);
    expect(await q('SELECT 1 FROM child WHERE id = ?', id)).toHaveLength(0);
    expect(await env.MEDIA.get(pk(await fam('d1'), 'd'))).toBeNull();
    expect(await q('SELECT child_id, status FROM enrollment WHERE id = ?', 'denr')).toEqual([{ child_id: null, status: 'invited' }]);
  });

  it('Napster non-404 failure -> 502 INTERNAL and nothing deleted locally', async () => {
        await users('d2');
    const kidRes = (await (await call('POST', '/api/children', 'd2', kid)).json()) as { id: string };
    await seedRows(env, {
      avatar: [{ id: 'dav2', user_id: 'd2', status: 'approved' }],
      comfort_session: [{ id: 'ds9', napster_session_id: 'nap-fail', child_id: kidRes.id, avatar_id: 'dav2', caregiver_user_id: 'd2', started_at: NOW }],
    });
    deleteSession.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = await call('DELETE', `/api/children/${kidRes.id}`, 'd2');
    expect(res.status).toBe(502);
    expect(await errCode(res)).toBe('INTERNAL');
    expect(await q('SELECT 1 FROM comfort_session WHERE id = ?', 'ds9')).toHaveLength(1);
    expect(await q('SELECT 1 FROM child WHERE id = ?', kidRes.id)).toHaveLength(1);
  });
});

describe('caregivers', () => {
  async function seedCg(x: string) {
    await users(`${x}1`, `${x}nanny`, `${x}teach`, `${x}x`);
    const { id } = (await (await call('POST', '/api/children', `${x}1`, kid)).json()) as { id: string };
    await seedRows(env, {
      org: [{ id: `${x}org`, name: 'Tiny Tots', timezone: 'UTC' }],
      org_member: [{ org_id: `${x}org`, user_id: `${x}teach`, role: 'teacher' }],
      classroom: [{ id: `${x}cl`, org_id: `${x}org`, name: 'Ducks' }],
      classroom_child: [{ classroom_id: `${x}cl`, child_id: id }],
      classroom_staff: [{ classroom_id: `${x}cl`, user_id: `${x}teach` }],
      connection: [
        { id: `${x}dc`, child_id: id, kind: 'daycare', org_id: `${x}org`, transcript_access: 0 },
        { id: `${x}home`, child_id: id, kind: 'home', caregiver_user_id: `${x}nanny`, transcript_access: 0 },
      ],
    });
    return id;
  }

  it('lists daycare (org + teachers) and home caregivers; parent only', async () => {
    const x = 'ga';
    const id = await seedCg(x);
    const res = await call('GET', `/api/children/${id}/caregivers`, `${x}1`);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.daycare.org).toEqual({ id: `${x}org`, name: 'Tiny Tots' });
    expect(b.daycare.teachers).toEqual([{ userId: `${x}teach`, name: `N ${x}teach` }]);
    expect(b.daycare.transcriptAccess).toBe(false);
    expect(b.home).toEqual([{ connectionId: `${x}home`, userId: `${x}nanny`, name: `N ${x}nanny`, transcriptAccess: false }]);
    expect((await call('GET', `/api/children/${id}/caregivers`, `${x}x`)).status).toBe(403);
  });

  it('PATCH toggles transcriptAccess; DELETE removes the connection; other-child connection is NOT_FOUND', async () => {
    const x = 'gb';
    const id = await seedCg(x);
    expect((await call('PATCH', `/api/children/${id}/caregivers/${x}home`, `${x}x`, { transcriptAccess: true })).status).toBe(403);
    expect((await call('PATCH', `/api/children/${id}/caregivers/${x}home`, `${x}1`, { transcriptAccess: true })).status).toBe(200);
    expect((await q<{ transcript_access: number }>('SELECT transcript_access FROM connection WHERE id=?', `${x}home`))[0]!.transcript_access).toBe(1);
    expect(await errCode(await call('PATCH', `/api/children/${id}/caregivers/${x}home`, `${x}1`, { transcriptAccess: 'yes' }))).toBe('INVALID');

    await users(`${x}3`);
    const other = (await (await call('POST', '/api/children', `${x}3`, kid)).json()) as { id: string };
    await seedRows(env, { connection: [{ id: `${x}other`, child_id: other.id, kind: 'home', caregiver_user_id: `${x}nanny`, transcript_access: 0 }] });
    expect(await errCode(await call('DELETE', `/api/children/${id}/caregivers/${x}other`, `${x}1`))).toBe('NOT_FOUND');
    expect(await q('SELECT 1 FROM connection WHERE id = ?', `${x}other`)).toHaveLength(1);

    expect((await call('DELETE', `/api/children/${id}/caregivers/${x}home`, `${x}1`)).status).toBe(200);
    expect(await q('SELECT 1 FROM connection WHERE id = ?', `${x}home`)).toHaveLength(0);
    expect((await call('GET', `/api/children/${id}`, `${x}nanny`)).status).toBe(403);
  });
});

describe('GET /api/caregiver/children', () => {
  async function world(x: string) {
    await users(`${x}p`, `${x}nanny`, `${x}out`);
    await env.DB.prepare('UPDATE user SET name = ? WHERE id = ?').bind('Sarah Kim', `${x}p`).run();
    const { id } = (await (await call('POST', '/api/children', `${x}p`, { ...kid, name: 'Leo' })).json()) as { id: string };
    await seedRows(env, {
      connection: [{ id: `${x}home`, child_id: id, kind: 'home', caregiver_user_id: `${x}nanny`, transcript_access: 0 }],
      avatar: [
        { id: `${x}av1`, user_id: `${x}p`, status: 'approved' },
        { id: `${x}av2`, user_id: `${x}p`, status: 'ready' },
      ],
      comfort_plan: [{ child_id: id, avatar_id: `${x}av1`, parent_title: 'Mommy' }],
    });
    return id;
  }

  it('returns the nanny their children with ready avatars, the parent first name and a family label', async () => {
    const id = await world('cc');
    const res = await call('GET', '/api/caregiver/children', 'ccnanny');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { children: any[] };
    expect(body.children).toEqual([
      { id, name: 'Leo', readyAvatars: [{ avatarId: 'ccav1', parentTitle: 'Mommy', parentName: 'Sarah' }], familyLabel: 'Kim family' },
    ]);
  });

  it('is empty for someone who cares for no one, and a parent is not their own caregiver', async () => {
    await world('cd');
    expect(((await (await call('GET', '/api/caregiver/children', 'cdout')).json()) as any).children).toEqual([]);
    expect(((await (await call('GET', '/api/caregiver/children', 'cdp')).json()) as any).children).toEqual([]);
  });

  it('requires sign-in', async () => {
    expect((await request('/api/caregiver/children')).status).toBe(401);
  });
});
