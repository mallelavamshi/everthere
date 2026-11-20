import { describe, it, expect } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';
import { todayNoteExpiry } from '@everthere/shared';

const { env, request } = makeApp();
const NOW = Date.now();
const j = (user: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { ...authAs(user), 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;

async function world(p: string, tz = 'America/Los_Angeles') {
  await seedRows(env, {
    user: [`${p}m`, `${p}d`, `${p}x`].map((id) => ({ id, name: id, email: `${id}@x`, created_at: NOW })),
    family: [{ id: `${p}f`, created_at: NOW }, { id: `${p}f2`, created_at: NOW }],
    family_member: [
      { family_id: `${p}f`, user_id: `${p}m`, role: 'parent' },
      { family_id: `${p}f`, user_id: `${p}d`, role: 'parent' },
      { family_id: `${p}f2`, user_id: `${p}x`, role: 'parent' },
    ],
    child: [{ id: `${p}c`, family_id: `${p}f`, name: 'Kid', timezone: tz }],
    avatar: [
      { id: `${p}av`, user_id: `${p}m`, status: 'approved', parent_title: 'Mama', created_at: NOW },
      { id: `${p}avx`, user_id: `${p}x`, status: 'approved', parent_title: 'Mom', created_at: NOW },
    ],
  });
}
const url = (p: string, av = 'av') => `/api/children/${p}c/plans/${p}${av}`;

describe('comfort plans', () => {
  it('GET with no row returns defaults from the avatar', async () => {
    await world('p1');
    const res = await request(url('p1'), { headers: authAs('p1m') });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      childId: 'p1c', avatarId: 'p1av', parentTitle: 'Mama', tone: 'playful',
      nicknames: [], favorites: [], phrases: [], neverTopics: [], todayNote: null, todayNoteExpiresAt: null,
    });
  });

  it('PUT upserts; either parent of the family can read it back', async () => {
    await world('p2');
    const put = await request(url('p2'), j('p2m', 'PUT', { tone: 'calm', nicknames: ['Bug'], favorites: ['trains'], songTitle: 'Twinkle' }));
    expect(put.status).toBe(200);
    const put2 = await request(url('p2'), j('p2m', 'PUT', { tone: 'soothing', nicknames: ['Bug', 'Bee'] }));
    expect(put2.status).toBe(200);
    const got = (await (await request(url('p2'), { headers: authAs('p2d') })).json()) as Record<string, unknown>;
    expect(got).toMatchObject({ tone: 'soothing', nicknames: ['Bug', 'Bee'], favorites: [], songTitle: null, parentTitle: 'Mama' });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM comfort_plan WHERE child_id=?').bind('p2c').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('a plan saved at 23:30 LA time expires at the next LA midnight', async () => {
    await world('p3');
    const real = Date.now;
    const at = Date.UTC(2026, 2, 11, 6, 30); // 2026-03-10 23:30 PDT
    Date.now = () => at;
    try {
      const res = await request(url('p3'), j('p3m', 'PUT', { tone: 'calm', todayNote: 'Big day' }));
      expect(res.status).toBe(200);
    } finally {
      Date.now = real;
    }
    const r = await env.DB.prepare('SELECT today_note_expires_at AS e FROM comfort_plan WHERE child_id=?').bind('p3c').first<{ e: number }>();
    expect(r!.e).toBe(Date.UTC(2026, 2, 11, 7, 0)); // 2026-03-11 00:00 PDT
    expect(r!.e).toBe(todayNoteExpiry('America/Los_Angeles', at));
  });

  it('empty todayNote clears note and expiry', async () => {
    await world('p4');
    await request(url('p4'), j('p4m', 'PUT', { tone: 'calm', todayNote: 'x' }));
    await request(url('p4'), j('p4m', 'PUT', { tone: 'calm', todayNote: '' }));
    const r = await env.DB.prepare('SELECT today_note AS t, today_note_expires_at AS e FROM comfort_plan WHERE child_id=?').bind('p4c').first<Record<string, unknown>>();
    expect(r!.e).toBeNull();
    expect(r!.t).toBeNull();
  });

  it("another parent (other family) can't GET or PUT your plan", async () => {
    await world('p5');
    await request(url('p5'), j('p5m', 'PUT', { tone: 'calm' }));
    for (const [m, b] of [['GET', undefined], ['PUT', { tone: 'calm' }]] as const) {
      const res = await request(url('p5'), j('p5x', m, b));
      expect(res.status).toBe(404);
      expect(await errCode(res)).toBe('NOT_FOUND');
    }
  });

  it("avatar owned by someone outside the child's family -> NOT_FOUND", async () => {
    await world('p6');
    const res = await request(url('p6', 'avx'), j('p6m', 'GET'));
    expect(res.status).toBe(404);
    expect(await errCode(res)).toBe('NOT_FOUND');
  });

  it('PUT parentTitle sets what this child calls the parent; omitting it keeps the stored one', async () => {
    await world('p8');
    const put = await request(url('p8'), j('p8m', 'PUT', { tone: 'calm', parentTitle: '  Mommy ' }));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ parentTitle: 'Mommy' });
    // a later save that does not mention it (e.g. the Today note) leaves it alone
    const again = await request(url('p8'), j('p8m', 'PUT', { tone: 'calm', todayNote: 'Pajama day!' }));
    expect(await again.json()).toMatchObject({ parentTitle: 'Mommy', todayNote: 'Pajama day!' });
    expect((await request(url('p8'), j('p8m', 'PUT', { tone: 'calm', parentTitle: 'x'.repeat(21) }))).status).toBe(400);
    expect((await request(url('p8'), j('p8m', 'PUT', { tone: 'calm', parentTitle: '   ' }))).status).toBe(400);
  });

  it('PUT validates bounds', async () => {
    await world('p7');
    const bad = [
      { tone: 'angry' },
      { tone: 'calm', nicknames: Array(13).fill('a') },
      { tone: 'calm', favorites: ['x'.repeat(41)] },
      { tone: 'calm', songLyrics: 'x'.repeat(1501) },
      { tone: 'calm', todayNote: 'x'.repeat(121) },
    ];
    for (const b of bad) expect((await request(url('p7'), j('p7m', 'PUT', b))).status).toBe(400);
  });
});
