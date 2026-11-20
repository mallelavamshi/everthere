import { describe, it, expect, beforeAll } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';

const { env, request } = makeApp();
const NOW = Date.now();
const local = (url: string) => url.replace('http://localhost:8787', '');

const get = (path: string, user: string) => request(path, { headers: authAs(user) });
const json = async <T = any>(res: Response) => (await res.json()) as T;
const KEY = (fam: string, c: string) => `child/${fam}/${c.repeat(21)}.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

async function world() {
  const key = KEY('cpF', 'a');
  await env.MEDIA.put(key, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
  await seedRows(env, {
    user: ['cpMom', 'cpDad', 'cpOut', 'cpHome', 'cpAdm'].map((id) => ({ id, name: id === 'cpDad' ? 'Dad Dee' : `N ${id}`, email: `${id}@x`, created_at: NOW })),
    family: [{ id: 'cpF', created_at: NOW }, { id: 'cpG', created_at: NOW }],
    family_member: [
      { family_id: 'cpF', user_id: 'cpMom' },
      { family_id: 'cpF', user_id: 'cpDad' },
      { family_id: 'cpG', user_id: 'cpOut' },
    ],
    child: [
      { id: 'cpC1', family_id: 'cpF', name: 'Pia', photo_key: key, timezone: 'UTC' },
      { id: 'cpC2', family_id: 'cpF', name: 'Nopic', photo_key: null, timezone: 'UTC' },
      { id: 'cpC3', family_id: 'cpG', name: 'Other', photo_key: KEY('cpG', 'b'), timezone: 'UTC' },
    ],
    avatar: [
      { id: 'cpAv1', user_id: 'cpMom', status: 'approved', parent_title: 'Mom' },
      { id: 'cpAv2', user_id: 'cpDad', status: 'creating', parent_title: 'Papa' },
      { id: 'cpAv3', user_id: 'cpOut', status: 'approved', parent_title: 'Mum' },
    ],
    connection: [{ id: 'cpCn1', child_id: 'cpC1', kind: 'home', caregiver_user_id: 'cpHome', transcript_access: 0 }],
  });
  return key;
}

beforeAll(() => world());

describe('child photoUrl + familyAvatars', () => {
  it('parent: signed photoUrl verifies, omitted without a photo; familyAvatars mark isMine on both sides', async () => {

    const mom = (await json<{ children: any[] }>(await get('/api/children', 'cpMom'))).children;
    const pia = mom.find((c) => c.id === 'cpC1');
    expect(pia.photoUrl).toContain('/m/');
    expect((await request(local(pia.photoUrl))).status).toBe(200);
    expect(pia.photoKey).toBeTruthy();
    expect(mom.find((c) => c.id === 'cpC2').photoUrl).toBeUndefined();
    const sorted = (a: any[]) => [...a].sort((x, y) => x.avatarId.localeCompare(y.avatarId));
    expect(sorted(pia.familyAvatars)).toEqual([
      { avatarId: 'cpAv1', ownerUserId: 'cpMom', ownerName: 'N cpMom', parentTitle: 'Mom', status: 'approved', isMine: true },
      { avatarId: 'cpAv2', ownerUserId: 'cpDad', ownerName: 'Dad Dee', parentTitle: 'Papa', status: 'creating', isMine: false },
    ]);
    const dad = await json(await get('/api/children/cpC1', 'cpDad'));
    expect(sorted(dad.familyAvatars).map((a: any) => [a.avatarId, a.isMine])).toEqual([['cpAv1', false], ['cpAv2', true]]);
    expect(dad.photoUrl).toContain('/m/');
    expect(mom.find((c) => c.id === 'cpC1').familyAvatars.some((a: any) => a.avatarId === 'cpAv3')).toBe(false);
  });

  it('caregiver: {id,name,photoUrl} only, no keys or familyAvatars', async () => {

    const list = (await json<{ children: any[] }>(await get('/api/children', 'cpHome'))).children;
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'name', 'photoUrl']);
    expect((await request(local(list[0].photoUrl))).status).toBe(200);
    const one = await json(await get('/api/children/cpC1', 'cpHome'));
    expect(Object.keys(one).sort()).toEqual(['id', 'name', 'photoUrl']);
  });
});

describe('roster photoUrl', () => {
  it('linked tiles carry a signed photoUrl; unlinked tiles none', async () => {

    await seedRows(env, {
      user: [{ id: 'cpRA', name: 'Admin', email: 'cpRA@x', created_at: NOW }],
      org: [{ id: 'cpO', name: 'Oaks', address: 'a', timezone: 'UTC' }],
      org_member: [{ org_id: 'cpO', user_id: 'cpRA', role: 'admin' }],
      classroom: [{ id: 'cpCl', org_id: 'cpO', name: 'Room', emoji: 'x' }],
      connection: [{ id: 'cpCn2', child_id: 'cpC1', kind: 'daycare', org_id: 'cpO', transcript_access: 0 }],
      classroom_child: [{ classroom_id: 'cpCl', child_id: 'cpC1' }],
      enrollment: [
        { id: 'cpE1', org_id: 'cpO', classroom_id: 'cpCl', child_name: 'Pia', child_id: 'cpC1', invite_code: 'cpCODE1', status: 'active', created_at: NOW },
        { id: 'cpE2', org_id: 'cpO', classroom_id: 'cpCl', child_name: 'Pending', child_id: null, invite_code: 'cpCODE2', status: 'invited', created_at: NOW + 1 },
      ],
    });
    const tiles = (await json<{ tiles: any[] }>(await get('/api/orgs/cpO/roster', 'cpRA'))).tiles;
    const linked = tiles.find((t) => t.childId === 'cpC1');
    expect((await request(local(linked.photoUrl))).status).toBe(200);
    expect(JSON.stringify(tiles)).not.toContain('child/cpF');
    expect(tiles.find((t) => t.name === 'Pending').photoUrl).toBeUndefined();
  });
});
