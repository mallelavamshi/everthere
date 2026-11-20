import { describe, it, expect, beforeAll } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';
import { readyAvatarsByChild } from '../src/lib/readyAvatars';

// Task 30: each parent's own face on the "Mommy or Daddy?" picker (caregivers) and on the family avatar cards (parents).
const { env, request } = makeApp();
const NOW = Date.now();
const local = (url: string) => url.replace('http://localhost:8787', '');
const get = (path: string, user: string) => request(path, { headers: authAs(user) });
const json = async <T = any>(res: Response) => (await res.json()) as T;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MOM_KEY = `avatar/pfMom/${'m'.repeat(21)}.png`;
const DAD_KEY = `avatar/pfDad/${'d'.repeat(21)}.png`;

beforeAll(async () => {
  await env.MEDIA.put(MOM_KEY, PNG, { httpMetadata: { contentType: 'image/png' } });
  await env.MEDIA.put(DAD_KEY, PNG, { httpMetadata: { contentType: 'image/png' } });
  await seedRows(env, {
    user: ['pfMom', 'pfDad', 'pfGran', 'pfNanny', 'pfOut', 'pfAdm', 'pfTeach', 'pfOtherTeach'].map((id) => ({
      id, name: `${id.slice(2)} Lee`, email: `${id}@x`, created_at: NOW,
    })),
    family: [{ id: 'pfF', created_at: NOW }],
    family_member: [
      { family_id: 'pfF', user_id: 'pfMom' },
      { family_id: 'pfF', user_id: 'pfDad' },
      { family_id: 'pfF', user_id: 'pfGran' },
    ],
    child: [{ id: 'pfC', family_id: 'pfF', name: 'Mia', timezone: 'UTC' }],
    avatar: [
      { id: 'pfAvMom', user_id: 'pfMom', status: 'approved', parent_title: 'Mommy', photo_key: MOM_KEY, created_at: NOW },
      { id: 'pfAvDad', user_id: 'pfDad', status: 'approved', parent_title: 'Daddy', photo_key: DAD_KEY, created_at: NOW },
      // Approved but no photo: no photoUrl, never an empty one.
      { id: 'pfAvGran', user_id: 'pfGran', status: 'approved', parent_title: 'Nana', photo_key: null, created_at: NOW },
    ],
    connection: [
      { id: 'pfHome', child_id: 'pfC', kind: 'home', caregiver_user_id: 'pfNanny', transcript_access: 0 },
      { id: 'pfDay', child_id: 'pfC', kind: 'daycare', org_id: 'pfO', transcript_access: 0 },
    ],
    org: [{ id: 'pfO', name: 'Oaks', address: 'a', timezone: 'UTC' }],
    org_member: [
      { org_id: 'pfO', user_id: 'pfAdm', role: 'admin' },
      { org_id: 'pfO', user_id: 'pfTeach', role: 'teacher' },
      { org_id: 'pfO', user_id: 'pfOtherTeach', role: 'teacher' },
    ],
    classroom: [
      { id: 'pfRoom', org_id: 'pfO', name: 'Room', emoji: 'x' },
      { id: 'pfRoom2', org_id: 'pfO', name: 'Other room', emoji: 'x' },
    ],
    classroom_child: [{ classroom_id: 'pfRoom', child_id: 'pfC' }],
    classroom_staff: [
      { classroom_id: 'pfRoom', user_id: 'pfTeach' },
      { classroom_id: 'pfRoom2', user_id: 'pfOtherTeach' },
    ],
    enrollment: [{ id: 'pfE', org_id: 'pfO', classroom_id: 'pfRoom', child_name: 'Mia', child_id: 'pfC', invite_code: 'PFCODE', status: 'linked', created_at: NOW }],
  });
});

const byId = (list: any[]) => Object.fromEntries(list.map((a) => [a.avatarId, a]));

async function expectLoads(url: string): Promise<void> {
  expect(url).toMatch(/\/m\/avatar%2F.+\?exp=\d+&sig=[0-9a-f]+$/);
  const res = await request(local(url));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
}

describe('parent faces: familyAvatars (parents)', () => {
  it('GET /children and /children/:id give each family avatar a signed photoUrl, omitted without a photo, never a raw key', async () => {
    const list = (await json<{ children: any[] }>(await get('/api/children', 'pfMom'))).children;
    const fam = byId(list.find((c) => c.id === 'pfC').familyAvatars);
    await expectLoads(fam.pfAvMom.photoUrl);
    await expectLoads(fam.pfAvDad.photoUrl);
    expect('photoUrl' in fam.pfAvGran).toBe(false);
    expect(JSON.stringify(fam)).not.toContain('avatar/pf');

    const one = await json(await get('/api/children/pfC', 'pfDad'));
    const fam2 = byId(one.familyAvatars);
    await expectLoads(fam2.pfAvMom.photoUrl);
    expect(fam2.pfAvMom.isMine).toBe(false);
    expect(fam2.pfAvDad.isMine).toBe(true);
  });
});

describe('parent faces: readyAvatars (caregivers who can call the child)', () => {
  it('readyAvatarsByChild adds the signed photoUrl of each parent avatar', async () => {
    const got = byId((await readyAvatarsByChild(env, ['pfC'])).get('pfC')!);
    await expectLoads(got.pfAvMom.photoUrl);
    await expectLoads(got.pfAvDad.photoUrl);
    expect(got.pfAvGran).toEqual({ avatarId: 'pfAvGran', parentTitle: 'Nana', parentName: 'Gran' });
  });

  it('the home caregiver (nanny) sees the faces on GET /caregiver/children', async () => {
    const kids = (await json<{ children: any[] }>(await get('/api/caregiver/children', 'pfNanny'))).children;
    const ready = byId(kids[0].readyAvatars);
    await expectLoads(ready.pfAvDad.photoUrl);
    expect(JSON.stringify(kids)).not.toContain('avatar/pf');
  });

  it("the child's teacher and the admin see them on the roster; access is not widened", async () => {
    for (const who of ['pfTeach', 'pfAdm']) {
      const tiles = (await json<{ tiles: any[] }>(await get('/api/orgs/pfO/roster', who))).tiles;
      const ready = byId(tiles.find((t) => t.childId === 'pfC').readyAvatars);
      await expectLoads(ready.pfAvMom.photoUrl);
      expect(JSON.stringify(tiles)).not.toContain('avatar/pf');
    }
    // A teacher of another classroom does not get the child's tile, so no parent faces either.
    const other = await get('/api/orgs/pfO/roster', 'pfOtherTeach');
    const otherTiles = other.status === 200 ? (await json<{ tiles: any[] }>(other)).tiles : [];
    expect(otherTiles.some((t) => t.childId === 'pfC')).toBe(false);
    // Outsiders: no caregiver children, no roster.
    expect((await json<{ children: any[] }>(await get('/api/caregiver/children', 'pfOut'))).children).toEqual([]);
    expect((await get('/api/orgs/pfO/roster', 'pfOut')).status).toBe(403);
  });
});
