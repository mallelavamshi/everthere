import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { todayNoteExpiry, type DemoFixtureInput } from '@everthere/shared';
import { createApp } from '../src/index';
import type { Env } from '../src/env';
import { resetDemoWorld } from '../src/services/demo';
import { setPin, verifyPin } from '../src/auth/acting';
import { clerkSignInToken } from '../src/auth/demo';
import { rateLimitIpKey } from '../src/routes/demo';
import { testVerify, testFetchProfile, authAs, seedRows } from './helpers';

const ADMIN = 'test-admin-token-0123456789';
const DAY = 86_400_000;
const MIN = 60_000;
const NOW = Date.now();

const U = { sarah: 'dm_sarah', marcus: 'dm_marcus', david: 'dm_david', rosa: 'dm_rosa', jess: 'dm_jess', tanya: 'dm_tanya' };
const ORG = 'demo.org.acorns';
const ROOM = 'demo.room.butterflies';
const FAM_J = 'demo.fam.johnson';
const FAM_K = 'demo.fam.kim';
const MIA = 'demo.child.mia';
const LEO = 'demo.child.leo';
const AV_S = 'demo.av.sarah';
const AV_D = 'demo.av.david';

/** A compact demo world; `seededAt` anchors every timestamp. */
function fixture(seededAt = NOW - MIN): DemoFixtureInput {
  const iso = (ms: number) => new Date(ms).toISOString();
  const s1 = seededAt - DAY;
  return {
    version: 1,
    seededAt,
    personas: { parent: U.sarah, teacher: U.jess },
    users: [
      { id: U.sarah, name: 'Sarah Johnson', email: 'sarah.johnson.demo@everthere.app' },
      { id: U.marcus, name: 'Marcus Johnson', email: 'marcus.johnson.demo@everthere.app' },
      { id: U.david, name: 'David Kim', email: 'david.kim.demo@everthere.app' },
      { id: U.rosa, name: 'Rosa Alvarez', email: 'rosa.alvarez.demo@everthere.app' },
      { id: U.jess, name: 'Jess Parker', email: 'jess.parker.demo@everthere.app' },
      { id: U.tanya, name: 'Tanya Brooks', email: 'tanya.brooks.demo@everthere.app' },
    ],
    orgs: [{ id: ORG, name: 'Little Acorns Daycare', address: '12 Oak St', timezone: 'America/Chicago' }],
    orgMembers: [
      { orgId: ORG, userId: U.tanya, role: 'admin' },
      { orgId: ORG, userId: U.jess, role: 'teacher' },
    ],
    families: [{ id: FAM_J }, { id: FAM_K }],
    familyMembers: [
      { familyId: FAM_J, userId: U.sarah },
      { familyId: FAM_J, userId: U.marcus },
      { familyId: FAM_K, userId: U.david },
    ],
    children: [
      { id: MIA, familyId: FAM_J, name: 'Mia', birthday: '2022-03-14', timezone: 'America/Chicago', photoKey: 'child/demo.fam.johnson/aaaaaaaaaaaaaaaaaaaaa.png' },
      { id: LEO, familyId: FAM_K, name: 'Leo', birthday: '2023-01-09', timezone: 'America/Chicago' },
    ],
    avatars: [
      { id: AV_S, userId: U.sarah, napsterCompanionId: 'comp_s', napsterAgentId: 'agent_s', voiceId: 'marin', photoKey: null, parentTitle: 'Mommy', consentAt: seededAt },
      { id: AV_D, userId: U.david, napsterCompanionId: 'comp_d', napsterAgentId: 'agent_d', voiceId: 'cedar', photoKey: null, parentTitle: 'Daddy', consentAt: seededAt },
    ],
    plans: [
      {
        childId: MIA, avatarId: AV_S, parentTitle: 'Mommy', tone: 'playful', nicknames: ['Mia Bug'], favorites: ['dinosaurs'],
        phrases: ['You are brave'], songTitle: 'Twinkle, Twinkle', neverTopics: ['the dentist'], todayNote: 'Extra cuddles today',
      },
    ],
    connections: [
      { id: 'demo.cn.mia', childId: MIA, kind: 'daycare', orgId: ORG, transcriptAccess: true },
      { id: 'demo.cn.leo.home', childId: LEO, kind: 'home', caregiverUserId: U.rosa, transcriptAccess: true },
    ],
    classrooms: [{ id: ROOM, orgId: ORG, name: 'Butterflies Room', emoji: 'asset:butterflies' }],
    classroomChildren: [{ classroomId: ROOM, childId: MIA }],
    classroomStaff: [{ classroomId: ROOM, userId: U.jess }],
    staffPins: [
      { orgId: ORG, userId: U.jess, pin: '1234' },
      { orgId: ORG, userId: U.tanya, pin: '2468' },
    ],
    invites: [
      { code: 'DEMO01', type: 'parent_enrollment', payload: { orgId: ORG, enrollmentId: 'demo.enr.mia' }, createdBy: U.tanya, expiresAt: seededAt + 7 * DAY, usedBy: U.sarah, usedAt: seededAt - 9 * DAY },
      { code: 'DEMO02', type: 'parent_enrollment', payload: { orgId: ORG, enrollmentId: 'demo.enr.noah' }, createdBy: U.tanya, expiresAt: seededAt + 7 * DAY },
    ],
    enrollments: [
      { id: 'demo.enr.mia', orgId: ORG, classroomId: ROOM, childName: 'Mia', inviteCode: 'DEMO01', childId: MIA, status: 'linked', createdAt: seededAt - 10 * DAY },
      { id: 'demo.enr.noah', orgId: ORG, classroomId: ROOM, childName: 'Noah', inviteCode: 'DEMO02', status: 'invited', createdAt: seededAt - 10 * DAY },
    ],
    sessions: [
      {
        id: 'demo.sess.1', childId: MIA, avatarId: AV_S, caregiverUserId: U.jess, orgId: ORG, reason: 'boo_boo',
        startedAt: s1, endedAt: s1 + 4 * MIN, durationS: 240, costUsd: 0.4, moodAfter: 'calmer', caregiverNote: 'Back to the sandbox.',
        summary: 'Mia scraped her knee and you sang Twinkle, Twinkle together.', moodSignal: 'better',
        transcript: [
          { role: 'Assistant', text: 'Hi Mia Bug, it is Mommy.', timestamp: iso(s1 + 1000) },
          { role: 'User', text: 'I fell down and my knee hurts.', timestamp: iso(s1 + 5000) },
        ],
      },
    ],
    flags: [{ id: 'demo.flag.1', sessionId: 'demo.sess.1', source: 'live', category: 'injury', quote: 'my knee hurts', severity: 'low', createdAt: s1 + 6000 }],
    alerts: [
      { id: 'demo.alert.1', userId: U.sarah, kind: 'summary', refId: 'demo.sess.1', title: "💛 Mia's comfort session", body: 'Mia scraped her knee.', createdAt: s1 + 5 * MIN },
    ],
  };
}

type Opts = { signInToken?: (env: Env, userId: string) => Promise<string>; verify?: typeof testVerify };
function setup(over: Partial<Env> = {}, o: Opts = {}) {
  const signInToken = vi.fn(o.signInToken ?? (async (_e: Env, userId: string) => `ticket_for_${userId}`));
  const verify = vi.fn(o.verify ?? testVerify);
  const app = createApp({
    verify,
    fetchProfile: testFetchProfile,
    signInToken,
    napsterDeleteSession: async () => {},
    napster: {} as never,
  });
  const e = { ...(env as Env), ADMIN_TOKEN: ADMIN, ...over } as Env;
  return { e, signInToken, verify, request: (p: string, init?: RequestInit) => app.request(p, init, e) };
}
type S = ReturnType<typeof setup>;

const json = (method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const admin = (method: string, body?: unknown) => json(method, body, { 'X-Admin-Token': ADMIN });
const as = (user: string, method: string, body?: unknown) => json(method, body, authAs(user));
const errCode = async (res: Response) => ((await res.clone().json()) as { error?: { code: string } }).error?.code;
const all = async <T = Record<string, unknown>>(sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).all<T>()).results;
const one = <T = Record<string, unknown>>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).first<T>();

async function seed(s: S, f: DemoFixtureInput = fixture()) {
  const res = await s.request('/api/admin/seed', admin('PUT', f));
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

const signIn = (s: S, persona: unknown, ip: string) =>
  s.request('/api/demo/sign-in', json('POST', { persona }, { 'CF-Connecting-IP': ip }));

const TABLES = [
  'user', 'org', 'org_member', 'family', 'family_member', 'child', 'avatar', 'comfort_plan', 'connection', 'classroom',
  'classroom_child', 'classroom_staff', 'invite_code', 'enrollment', 'comfort_session', 'session_flag', 'alert',
  'demo_persona', 'demo_fixture',
];
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\``))!.n;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

describe('demo sign-in before seeding', () => {
  it('returns 404 NOT_FOUND when no persona has been seeded', async () => {
    await env.DB.prepare('DELETE FROM demo_persona').run();
    const s = setup();
    const res = await signIn(s, 'parent', '10.0.0.1');
    expect(res.status).toBe(404);
    expect(await errCode(res)).toBe('NOT_FOUND');
    expect(s.signInToken).not.toHaveBeenCalled();
  });
});

describe('admin routes: X-Admin-Token only', () => {
  const paths: [string, string, unknown?][] = [
    ['GET', '/api/admin/credit-guard'],
    ['PUT', '/api/admin/credit-guard', { capUsd: 50 }],
    ['PUT', '/api/admin/seed', {}],
  ];

  for (const [method, path, body] of paths) {
    it(`${method} ${path}: 401 without a token, with a wrong token, and with an empty ADMIN_TOKEN`, async () => {
      const s = setup();
      const none = await s.request(path, json(method, body));
      expect(none.status).toBe(401);
      expect(await errCode(none)).toBe('UNAUTHENTICATED');
      expect((await s.request(path, json(method, body, { 'X-Admin-Token': `${ADMIN}x` }))).status).toBe(401);
      expect((await s.request(path, json(method, body, { 'X-Admin-Token': ADMIN.slice(0, -1) }))).status).toBe(401);

      const empty = setup({ ADMIN_TOKEN: '' });
      expect((await empty.request(path, json(method, body, { 'X-Admin-Token': '' }))).status).toBe(401);
      expect((await empty.request(path, json(method, body, { 'X-Admin-Token': ADMIN }))).status).toBe(401);
      const unset = setup({ ADMIN_TOKEN: undefined as unknown as string });
      expect((await unset.request(path, json(method, body, { 'X-Admin-Token': 'undefined' }))).status).toBe(401);
    });
  }

  it('ignores Clerk auth: a valid session is not enough, and Clerk is never consulted', async () => {
    const s = setup();
    const res = await s.request('/api/admin/credit-guard', { headers: authAs('someone') });
    expect(res.status).toBe(401);
    const ok = await s.request('/api/admin/credit-guard', { headers: { 'X-Admin-Token': ADMIN } });
    expect(ok.status).toBe(200);
    expect(s.verify).not.toHaveBeenCalled();
    expect(await one('SELECT id FROM user WHERE id = ?', 'someone')).toBeNull();
  });
});

describe('credit guard admin', () => {
  beforeEach(async () => {
    await env.DB.prepare('UPDATE credit_guard SET cap_usd = 120, spent_usd = 0 WHERE id = 1').run();
  });

  it('GET returns {capUsd, spentUsd}; PUT updates the cap', async () => {
    const s = setup();
    await env.DB.prepare('UPDATE credit_guard SET spent_usd = 12.5 WHERE id = 1').run();
    const get = await s.request('/api/admin/credit-guard', admin('GET'));
    expect(await get.json()).toEqual({ capUsd: 120, spentUsd: 12.5 });
    const put = await s.request('/api/admin/credit-guard', admin('PUT', { capUsd: 90 }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ capUsd: 90, spentUsd: 12.5 });
    expect((await one<{ cap_usd: number }>('SELECT cap_usd FROM credit_guard WHERE id = 1'))!.cap_usd).toBe(90);
    for (const capUsd of [0, 150]) expect((await s.request('/api/admin/credit-guard', admin('PUT', { capUsd }))).status).toBe(200);
  });

  it('PUT rejects a cap outside 0..150 or not a number', async () => {
    const s = setup();
    for (const body of [{ capUsd: -0.01 }, { capUsd: 150.01 }, { capUsd: '100' }, {}, { capUsd: null }]) {
      const res = await s.request('/api/admin/credit-guard', admin('PUT', body));
      expect(res.status).toBe(400);
      expect(await errCode(res)).toBe('INVALID');
    }
    expect((await one<{ cap_usd: number }>('SELECT cap_usd FROM credit_guard WHERE id = 1'))!.cap_usd).toBe(120);
  });
});

describe('PUT /api/admin/seed', () => {
  it('rejects an invalid fixture', async () => {
    const s = setup();
    const res = await s.request('/api/admin/seed', admin('PUT', { ...fixture(), version: 2 }));
    expect(res.status).toBe(400);
    const dangling = fixture();
    dangling.flags![0]!.sessionId = 'nope';
    expect((await s.request('/api/admin/seed', admin('PUT', dangling))).status).toBe(400);
  });

  it('upserts the world, marks the fixture users demo, and stores personas + fixture', async () => {
    const s = setup();
    const f = fixture();
    await seed(s, f);
    const users = await all<{ id: string; is_demo: number; name: string }>(
      'SELECT id, is_demo, name FROM user WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',
      JSON.stringify(Object.values(U)),
    );
    expect(users).toHaveLength(6);
    expect(users.every((u) => u.is_demo === 1)).toBe(true);
    expect(await all('SELECT persona, user_id FROM demo_persona ORDER BY persona')).toEqual([
      { persona: 'parent', user_id: U.sarah },
      { persona: 'teacher', user_id: U.jess },
    ]);
    const stored = await one<{ seeded_at: number; json: string }>('SELECT seeded_at, json FROM demo_fixture WHERE id = 1');
    expect(stored!.seeded_at).toBe(f.seededAt);
    expect(JSON.parse(stored!.json).seededAt).toBe(f.seededAt);
    expect(await one('SELECT status, is_synthetic, consent_name, napster_agent_id FROM avatar WHERE id = ?', AV_S)).toEqual({
      status: 'approved', is_synthetic: 1, consent_name: 'AI-generated face, no real person', napster_agent_id: 'agent_s',
    });
    const session = await one<{ status: string; summary: string; transcript_json: string; kind: string }>(
      'SELECT status, summary, transcript_json, kind FROM comfort_session WHERE id = ?', 'demo.sess.1',
    );
    expect(session).toMatchObject({ status: 'closed', kind: 'child', summary: f.sessions![0]!.summary });
    expect(JSON.parse(session!.transcript_json)).toHaveLength(2);
    const plan = await one<{ today_note: string; today_note_expires_at: number; nicknames: string }>(
      'SELECT today_note, today_note_expires_at, nicknames FROM comfort_plan WHERE child_id = ? AND avatar_id = ?', MIA, AV_S,
    );
    expect(plan!.today_note).toBe('Extra cuddles today');
    expect(plan!.today_note_expires_at).toBeGreaterThan(Date.now());
    expect(JSON.parse(plan!.nicknames)).toEqual(['Mia Bug']);
    expect(await one('SELECT emoji FROM classroom WHERE id = ?', ROOM)).toEqual({ emoji: 'asset:butterflies' });
  });

  it("records a real person's own digital twin truthfully (not synthetic) and keeps a custom cloned voice", async () => {
    const s = setup();
    const f = fixture();
    f.avatars![1] = { ...f.avatars![1]!, voiceId: 'custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1', likeness: { kind: 'self', ownerName: 'Vamshi Krishna' } };
    await seed(s, f);
    expect(await one('SELECT is_synthetic, consent_name, voice_id FROM avatar WHERE id = ?', AV_D)).toEqual({
      is_synthetic: 0,
      consent_name: "Vamshi Krishna (self: the account owner's own likeness and voice, consented by the owner)",
      voice_id: 'custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1',
    });
    // Every other avatar keeps the synthetic record; the nightly reset keeps the avatar as seeded.
    expect(await one('SELECT is_synthetic, consent_name FROM avatar WHERE id = ?', AV_S)).toEqual({ is_synthetic: 1, consent_name: 'AI-generated face, no real person' });
    await resetDemoWorld(s.e);
    expect(await one('SELECT is_synthetic, voice_id FROM avatar WHERE id = ?', AV_D)).toEqual({ is_synthetic: 0, voice_id: 'custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1' });
    // The owner's avatar view shows the custom voice id as is (the app labels it "Your own voice").
    const mine = (await (await s.request('/api/avatars/mine', { headers: authAs(U.david) })).json()) as { voiceId: string; consentName: string }[];
    expect(mine[0]).toMatchObject({ voiceId: 'custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1', consentName: expect.stringContaining('self') });
  });

  it('rejects a voice that is neither a stock voice nor custom:<id>', async () => {
    const s = setup();
    const f = fixture();
    f.avatars![1] = { ...f.avatars![1]!, voiceId: 'nova' as never };
    expect(await errCode(await s.request('/api/admin/seed', admin('PUT', f)))).toBe('INVALID');
    f.avatars![1] = { ...f.avatars![1]!, voiceId: 'custom:bad id!' as never };
    expect(await errCode(await s.request('/api/admin/seed', admin('PUT', f)))).toBe('INVALID');
  });

  it('gives the demo staff their PINs, hashed (Jess 1234, Tanya 2468), so the tablet PIN switch can be demoed', async () => {
    const s = setup();
    await seed(s);
    expect(await verifyPin(s.e, U.jess, ORG, '1234')).toBe(true);
    expect(await verifyPin(s.e, U.tanya, ORG, '2468')).toBe(true);
    expect(await verifyPin(s.e, U.jess, ORG, '2468')).toBe(false);
    expect(await all('SELECT pin_hash FROM staff_pin WHERE pin_hash IN (?, ?)', '1234', '2468')).toEqual([]);
  });

  it('rejects a fixture PIN that is not 4 digits or not for a member of that org', async () => {
    const s = setup();
    const bad = (staffPins: unknown) => s.request('/api/admin/seed', admin('PUT', { ...fixture(), staffPins }));
    expect(await errCode(await bad([{ orgId: ORG, userId: U.jess, pin: '12a4' }]))).toBe('INVALID');
    expect(await errCode(await bad([{ orgId: ORG, userId: U.sarah, pin: '1234' }]))).toBe('INVALID');
  });

  it('is idempotent: seeding twice gives the same row counts', async () => {
    const s = setup();
    await seed(s);
    const first = await counts();
    await seed(s);
    expect(await counts()).toEqual(first);
  });

  it('the seeded parent sees the demo world through the normal API', async () => {
    const s = setup();
    await seed(s);
    const me = await (await s.request('/api/me', { headers: authAs(U.sarah) })).json() as { user: { isDemo: boolean; name: string } };
    expect(me.user).toMatchObject({ isDemo: true, name: 'Sarah Johnson' });
    const kids = await (await s.request('/api/children', { headers: authAs(U.sarah) })).json() as { children: { id: string }[] };
    expect(kids.children.map((c) => c.id)).toEqual([MIA]);
    const roster = await (await s.request(`/api/orgs/${ORG}/roster`, { headers: authAs(U.jess) })).json() as { tiles: { name: string; status: string }[] };
    expect(roster.tiles.map((t) => [t.name, t.status])).toEqual([
      ['Mia', 'ready'],
      ['Noah', 'invite_sent'],
    ]);
  });
});

describe('POST /api/demo/sign-in', () => {
  it('mints a Clerk sign-in ticket for the seeded persona', async () => {
    const s = setup();
    await seed(s);
    const res = await signIn(s, 'parent', '10.0.1.1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket: `ticket_for_${U.sarah}` });
    expect(s.signInToken).toHaveBeenCalledWith(expect.anything(), U.sarah);
    const t = await signIn(s, 'teacher', '10.0.1.1');
    expect(await t.json()).toEqual({ ticket: `ticket_for_${U.jess}` });
  });

  it('validates the persona', async () => {
    const s = setup();
    await seed(s);
    for (const persona of ['admin', '', 42, undefined]) {
      const res = await signIn(s, persona, '10.0.2.1');
      expect(res.status).toBe(400);
    }
    expect(s.signInToken).not.toHaveBeenCalled();
  });

  it('refuses a persona whose user is no longer a demo user', async () => {
    const s = setup();
    await seed(s);
    await env.DB.prepare('UPDATE user SET is_demo = 0 WHERE id = ?').bind(U.sarah).run();
    const res = await signIn(s, 'parent', '10.0.3.1');
    expect(res.status).toBe(404);
    expect(s.signInToken).not.toHaveBeenCalled();
    // Restore by hand: the seed now refuses to adopt an existing non-demo user (fix round 1, 2a).
    await env.DB.prepare('UPDATE user SET is_demo = 1 WHERE id = ?').bind(U.sarah).run();
  });

  it('a Clerk failure is a 502 INTERNAL', async () => {
    const s = setup({}, { signInToken: async () => { throw new Error('clerk down'); } });
    await seed(s);
    const res = await signIn(s, 'parent', '10.0.4.1');
    expect(res.status).toBe(502);
    expect(await errCode(res)).toBe('INTERNAL');
  });

  it('is rate-limited to 10 requests per minute per IP: the 11th gets 429 RATE_LIMITED', async () => {
    const s = setup();
    await seed(s);
    for (let i = 0; i < 10; i++) {
      // invalid bodies count too: the limit is on requests, checked before anything else
      const res = await signIn(s, i % 2 ? 'parent' : 'bogus', '10.0.5.1');
      expect(res.status).not.toBe(429);
    }
    const eleventh = await signIn(s, 'parent', '10.0.5.1');
    expect(eleventh.status).toBe(429);
    expect(await errCode(eleventh)).toBe('RATE_LIMITED');
    expect((await signIn(s, 'parent', '10.0.5.2')).status).toBe(200); // other IPs are unaffected
  });

  it('requests without CF-Connecting-IP share the "unknown" bucket', async () => {
    const s = setup();
    await seed(s);
    await env.DB.prepare(`DELETE FROM rate_limit WHERE key LIKE '%unknown'`).run();
    for (let i = 0; i < 10; i++) expect((await s.request('/api/demo/sign-in', json('POST', { persona: 'parent' }))).status).toBe(200);
    expect((await s.request('/api/demo/sign-in', json('POST', { persona: 'parent' }))).status).toBe(429);
  });
});

describe('forbidDemo: demo accounts are read-only for names, deletions and avatars', () => {
  async function demoWorld() {
    const s = setup();
    await seed(s);
    return s;
  }
  const expectReadOnly = async (res: Response) => {
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe('DEMO_READ_ONLY');
  };

  it('DELETE /api/children/:id', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/children/${MIA}`, as(U.sarah, 'DELETE')));
    expect(await one('SELECT id FROM child WHERE id = ?', MIA)).not.toBeNull();
  });

  it('PUT plan still works (200)', async () => {
    const s = await demoWorld();
    const res = await s.request(`/api/children/${MIA}/plans/${AV_S}`, as(U.sarah, 'PUT', { tone: 'calm', nicknames: ['Judge'] }));
    expect(res.status).toBe(200);
  });

  it('PATCH /api/children/:id: a name change is refused; other fields (and the same name) still work', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { name: 'Renamed' })));
    await expectReadOnly(await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { name: 'Mia 2', birthday: '2022-03-15' })));
    const ok = await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { birthday: '2022-03-15' }));
    expect(ok.status).toBe(200);
    // Resending the unchanged name (a full edit form) is fine.
    expect((await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { name: ' Mia ', timezone: 'America/Chicago' }))).status).toBe(200);
    expect((await one<{ name: string }>('SELECT name FROM child WHERE id = ?', MIA))!.name).toBe('Mia');
  });

  it('PATCH /api/avatars/:id and POST /api/avatars', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/avatars/${AV_S}`, as(U.sarah, 'PATCH', { voiceId: 'ash' })));
    await expectReadOnly(
      await s.request('/api/avatars', as(U.sarah, 'POST', { photoKey: `avatar/${U.sarah}/aaaaaaaaaaaaaaaaaaaaa.png`, voiceId: 'ash', consentName: 'X', consentAccepted: true, parentTitle: 'Mom' })),
    );
    expect((await one<{ voice_id: string }>('SELECT voice_id FROM avatar WHERE id = ?', AV_S))!.voice_id).toBe('marin');
  });

  it('DELETE /api/children/:id/caregivers/:connectionId', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/children/${MIA}/caregivers/demo.cn.mia`, as(U.sarah, 'DELETE')));
    expect(await one('SELECT id FROM connection WHERE id = ?', 'demo.cn.mia')).not.toBeNull();
  });

  it('DELETE /api/orgs/:id/staff/:userId', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/orgs/${ORG}/staff/${U.jess}`, as(U.tanya, 'DELETE')));
    expect(await one('SELECT role FROM org_member WHERE org_id = ? AND user_id = ?', ORG, U.jess)).not.toBeNull();
  });

  it('PATCH /api/orgs/:id: a name change is refused; the address can change', async () => {
    const s = await demoWorld();
    await expectReadOnly(await s.request(`/api/orgs/${ORG}`, as(U.tanya, 'PATCH', { name: 'Big Acorns' })));
    expect((await s.request(`/api/orgs/${ORG}`, as(U.tanya, 'PATCH', { address: '99 Elm St' }))).status).toBe(200);
    expect((await one<{ name: string }>('SELECT name FROM org WHERE id = ?', ORG))!.name).toBe('Little Acorns Daycare');
  });

  it('does not affect non-demo users', async () => {
    const s = await demoWorld();
    await seedRows(env as Env, {
      user: [{ id: 'fd_p', name: 'Real Parent', email: 'r@x', created_at: NOW }],
      family: [{ id: 'fd_f', created_at: NOW }],
      family_member: [{ family_id: 'fd_f', user_id: 'fd_p', role: 'parent' }],
      child: [{ id: 'fd_c', family_id: 'fd_f', name: 'Real Kid' }],
    });
    expect((await s.request('/api/children/fd_c', as('fd_p', 'PATCH', { name: 'Real Kiddo' }))).status).toBe(200);
    expect((await s.request('/api/children/fd_c', as('fd_p', 'DELETE'))).status).toBe(200);
  });
});

describe('resetDemoWorld', () => {
  it('is a no-op before any seed', async () => {
    const s = setup();
    await seed(s);
    const stored = await one<{ json: string; seeded_at: number }>('SELECT json, seeded_at FROM demo_fixture WHERE id = 1');
    await env.DB.prepare('DELETE FROM demo_fixture').run();
    const before = await counts();
    await resetDemoWorld(s.e);
    expect(await counts()).toEqual(before);
    await env.DB.prepare('INSERT INTO demo_fixture (id, json, seeded_at) VALUES (1, ?, ?)').bind(stored!.json, stored!.seeded_at).run();
  });

  it('removes a judge-created session (with its flag and alerts) and restores an edited plan', async () => {
    const s = setup();
    await seed(s);
    // A judge, signed in as Sarah / Ms. Jess, edits the plan, runs a session, flags it, checks in on an old one.
    const put = await s.request(`/api/children/${MIA}/plans/${AV_S}`, as(U.sarah, 'PUT', { tone: 'calm', nicknames: ['Judge'], todayNote: 'edited' }));
    expect(put.status).toBe(200);
    await seedRows(env as Env, {
      comfort_session: [{ id: 'judge.sess', child_id: MIA, avatar_id: AV_S, caregiver_user_id: U.jess, org_id: ORG, reason: 'missing_parent', started_at: Date.now(), status: 'closed', ended_at: Date.now() }],
      session_flag: [{ id: 'judge.flag', session_id: 'judge.sess', source: 'manual', category: 'other', quote: 'hi', severity: 'low', created_at: Date.now() }],
      alert: [
        { id: 'judge.alert.s', user_id: U.sarah, kind: 'summary', ref_id: 'judge.sess', title: 't', created_at: Date.now() },
        { id: 'judge.alert.t', user_id: U.tanya, kind: 'flag', ref_id: 'judge.sess', title: 't', created_at: Date.now() },
      ],
    });
    await env.DB.prepare(`UPDATE comfort_session SET mood_after = 'upset', caregiver_note = 'judge' WHERE id = 'demo.sess.1'`).run();
    await env.DB.prepare(`UPDATE alert SET read_at = ? WHERE id = 'demo.alert.1'`).bind(Date.now()).run();
    await env.DB.prepare(`UPDATE session_flag SET acknowledged_at = ?, acknowledged_by = ? WHERE id = 'demo.flag.1'`).bind(Date.now(), U.tanya).run();

    await resetDemoWorld(s.e);

    expect(await one('SELECT id FROM comfort_session WHERE id = ?', 'judge.sess')).toBeNull();
    expect(await one('SELECT id FROM session_flag WHERE id = ?', 'judge.flag')).toBeNull();
    expect(await all(`SELECT id FROM alert WHERE id LIKE 'judge.%'`)).toEqual([]);
    const plan = await (await s.request(`/api/children/${MIA}/plans/${AV_S}`, { headers: authAs(U.sarah) })).json();
    expect(plan).toMatchObject({ tone: 'playful', nicknames: ['Mia Bug'], todayNote: 'Extra cuddles today' });
    expect(await one(`SELECT mood_after, caregiver_note FROM comfort_session WHERE id = 'demo.sess.1'`)).toEqual({ mood_after: 'calmer', caregiver_note: 'Back to the sandbox.' });
    expect(await one(`SELECT read_at FROM alert WHERE id = 'demo.alert.1'`)).toEqual({ read_at: null });
    expect(await one(`SELECT acknowledged_at FROM session_flag WHERE id = 'demo.flag.1'`)).toEqual({ acknowledged_at: null });
  });

  it('keeps a session that has not ended yet (a judge mid-call at reset time), but removes ended ones', async () => {
    const s = setup();
    await seed(s);
    const t = Date.now();
    await seedRows(env as Env, {
      comfort_session: [
        { id: 'judge.live', child_id: MIA, avatar_id: AV_S, caregiver_user_id: U.jess, org_id: ORG, reason: 'missing_parent', started_at: t, status: 'started', kind: 'child' },
        { id: 'judge.done', child_id: MIA, avatar_id: AV_S, caregiver_user_id: U.jess, org_id: ORG, reason: 'missing_parent', started_at: t - 1000, ended_at: t, status: 'closed', kind: 'child' },
      ],
    });
    await resetDemoWorld(s.e);
    expect(await one('SELECT id FROM comfort_session WHERE id = ?', 'judge.live')).toEqual({ id: 'judge.live' });
    expect(await one('SELECT id FROM comfort_session WHERE id = ?', 'judge.done')).toBeNull();
    await env.DB.prepare(`UPDATE comfort_session SET ended_at = ?, status = 'closed' WHERE id = 'judge.live'`).bind(Date.now()).run();
    await resetDemoWorld(s.e);
    expect(await one('SELECT id FROM comfort_session WHERE id = ?', 'judge.live')).toBeNull();
  });

  it('restores the demo teacher PINs (Jess 1234, Tanya 2468) after a judge changes or clears them', async () => {
    const s = setup();
    await seed(s);
    await setPin(s.e, U.jess, ORG, '9999');
    await env.DB.prepare('DELETE FROM staff_pin WHERE user_id = ?').bind(U.tanya).run();
    await resetDemoWorld(s.e);
    expect(await verifyPin(s.e, U.jess, ORG, '1234')).toBe(true);
    expect(await verifyPin(s.e, U.jess, ORG, '9999')).toBe(false);
    expect(await verifyPin(s.e, U.tanya, ORG, '2468')).toBe(true);
    const row = await one<{ pin_hash: string }>('SELECT pin_hash FROM staff_pin WHERE user_id = ? AND org_id = ?', U.jess, ORG);
    expect(row!.pin_hash).toMatch(/^pbkdf2\$/); // hashed, never the PIN itself
  });

  it('removes what judges added in demo families and orgs, and keeps avatars', async () => {
    const s = setup();
    await seed(s);
    // New child + plan + invite by the demo parent; a co-parent invite redeemed by a real judge account.
    const kid = await (await s.request('/api/children', as(U.sarah, 'POST', { name: 'Judge Kid', birthday: '2021-01-01', timezone: 'UTC' }))).json() as { id: string };
    await s.request(`/api/children/${kid.id}/plans/${AV_S}`, as(U.sarah, 'PUT', { tone: 'calm' }));
    const inv = await (await s.request('/api/invites', as(U.sarah, 'POST', { type: 'co_parent', familyId: FAM_J }))).json() as { code: string };
    await seedRows(env as Env, {
      user: [{ id: 'rj_judge', name: 'Real Judge', email: 'judge@x', created_at: NOW }],
      family_member: [{ family_id: FAM_J, user_id: 'rj_judge', role: 'parent' }],
      connection: [{ id: 'rj_conn', child_id: MIA, kind: 'home', caregiver_user_id: 'rj_judge', transcript_access: 1 }],
      // Things the demo admin did in the demo org.
      classroom: [{ id: 'rj_room', org_id: ORG, name: 'Bees', emoji: '🐝' }],
      enrollment: [{ id: 'rj_enr', org_id: ORG, classroom_id: ROOM, child_name: 'Extra', invite_code: 'ZZZZZZ', status: 'invited', created_at: Date.now() }],
      classroom_staff: [{ classroom_id: ROOM, user_id: U.tanya }],
      // A test call on Sarah's avatar.
      comfort_session: [{ id: 'rj_test', child_id: null, avatar_id: AV_S, caregiver_user_id: U.sarah, kind: 'test', started_at: Date.now(), ended_at: Date.now() }],
      // A brand-new org a demo user created (only demo members): removed entirely.
      org: [{ id: 'rj_org', name: 'Judge Daycare' }],
      org_member: [{ org_id: 'rj_org', user_id: U.jess, role: 'admin' }],
    });
    await env.DB.prepare(`UPDATE connection SET transcript_access = 0 WHERE id = 'demo.cn.mia'`).run();
    await env.DB.prepare(`DELETE FROM classroom_child WHERE child_id = ?`).bind(MIA).run();
    await env.DB.prepare(`UPDATE enrollment SET child_id = NULL, status = 'invited' WHERE id = 'demo.enr.mia'`).run();
    await env.DB.prepare(`UPDATE invite_code SET used_by = 'x', used_at = 1 WHERE code = 'DEMO02'`).run();

    await resetDemoWorld(s.e);

    expect(await one('SELECT id FROM child WHERE id = ?', kid.id)).toBeNull();
    expect(await all('SELECT * FROM comfort_plan WHERE child_id = ?', kid.id)).toEqual([]);
    expect(await one('SELECT code FROM invite_code WHERE code = ?', inv.code)).toBeNull();
    expect(await all(`SELECT user_id FROM family_member WHERE family_id = ? ORDER BY user_id`, FAM_J)).toEqual([{ user_id: U.marcus }, { user_id: U.sarah }]);
    expect(await one('SELECT id FROM user WHERE id = ?', 'rj_judge')).not.toBeNull(); // the real account itself is kept
    expect(await one('SELECT id FROM connection WHERE id = ?', 'rj_conn')).toBeNull();
    expect(await one('SELECT id FROM classroom WHERE id = ?', 'rj_room')).toBeNull();
    expect(await one('SELECT id FROM enrollment WHERE id = ?', 'rj_enr')).toBeNull();
    expect(await all('SELECT user_id FROM classroom_staff WHERE classroom_id = ?', ROOM)).toEqual([{ user_id: U.jess }]);
    expect(await one('SELECT id FROM comfort_session WHERE id = ?', 'rj_test')).toBeNull();
    expect(await one('SELECT id FROM org WHERE id = ?', 'rj_org')).toBeNull();
    expect(await all('SELECT * FROM org_member WHERE org_id = ?', 'rj_org')).toEqual([]);
    expect(await one(`SELECT transcript_access FROM connection WHERE id = 'demo.cn.mia'`)).toEqual({ transcript_access: 1 });
    expect(await all('SELECT classroom_id FROM classroom_child WHERE child_id = ?', MIA)).toEqual([{ classroom_id: ROOM }]);
    expect(await one(`SELECT child_id, status FROM enrollment WHERE id = 'demo.enr.mia'`)).toEqual({ child_id: MIA, status: 'linked' });
    expect(await one(`SELECT used_by, used_at FROM invite_code WHERE code = 'DEMO02'`)).toEqual({ used_by: null, used_at: null });
    // Avatars are kept as they are (no re-upsert, no deletion).
    expect(await all(`SELECT id FROM avatar WHERE user_id IN (?, ?) ORDER BY id`, U.sarah, U.david)).toEqual([{ id: AV_D }, { id: AV_S }]);
  });

  it('never touches non-demo data', async () => {
    const s = setup();
    await seed(s);
    const later = Date.now() + 1000;
    // A real family and a real daycare, with activity after seededAt, plus a demo teacher who joined the real daycare.
    await seedRows(env as Env, {
      user: [
        { id: 'nd_p', name: 'Pat Real', email: 'p@x', created_at: NOW },
        { id: 'nd_a', name: 'Ann Admin', email: 'a@x', created_at: NOW },
      ],
      org: [{ id: 'nd_org', name: 'Real Daycare' }],
      org_member: [
        { org_id: 'nd_org', user_id: 'nd_a', role: 'admin' },
        { org_id: 'nd_org', user_id: U.jess, role: 'teacher' },
      ],
      classroom: [{ id: 'nd_room', org_id: 'nd_org', name: 'Owls', emoji: '🦉' }],
      family: [{ id: 'nd_f', created_at: NOW }],
      family_member: [{ family_id: 'nd_f', user_id: 'nd_p', role: 'parent' }],
      child: [{ id: 'nd_c', family_id: 'nd_f', name: 'Real Kid' }],
      avatar: [{ id: 'nd_av', user_id: 'nd_p', status: 'approved', parent_title: 'Mom', created_at: NOW }],
      comfort_plan: [{ child_id: 'nd_c', avatar_id: 'nd_av', parent_title: 'Mom', tone: 'calm' }],
      connection: [{ id: 'nd_cn', child_id: 'nd_c', kind: 'daycare', org_id: 'nd_org', transcript_access: 0 }],
      classroom_child: [{ classroom_id: 'nd_room', child_id: 'nd_c' }],
      enrollment: [{ id: 'nd_enr', org_id: 'nd_org', classroom_id: 'nd_room', child_name: 'Real Kid', invite_code: 'NDCODE', child_id: 'nd_c', status: 'linked', created_at: later }],
      invite_code: [{ code: 'NDCODE', type: 'parent_enrollment', payload: '{}', created_by: 'nd_a', expires_at: later + DAY }],
      comfort_session: [{ id: 'nd_sess', child_id: 'nd_c', avatar_id: 'nd_av', caregiver_user_id: 'nd_a', org_id: 'nd_org', started_at: later }],
      session_flag: [{ id: 'nd_flag', session_id: 'nd_sess', source: 'live', category: 'injury', quote: 'ow', severity: 'low', created_at: later }],
      alert: [{ id: 'nd_alert', user_id: 'nd_p', kind: 'summary', ref_id: 'nd_sess', title: 't', created_at: later }],
    });
    const snap = async () => ({
      user: await all(`SELECT * FROM user WHERE id LIKE 'nd_%' ORDER BY id`),
      org: await all(`SELECT * FROM org WHERE id LIKE 'nd_%'`),
      orgMember: await all(`SELECT * FROM org_member WHERE user_id LIKE 'nd_%' ORDER BY user_id`),
      classroom: await all(`SELECT * FROM classroom WHERE id LIKE 'nd_%'`),
      family: await all(`SELECT * FROM family WHERE id LIKE 'nd_%'`),
      familyMember: await all(`SELECT * FROM family_member WHERE family_id LIKE 'nd_%'`),
      child: await all(`SELECT * FROM child WHERE id LIKE 'nd_%'`),
      avatar: await all(`SELECT * FROM avatar WHERE id LIKE 'nd_%'`),
      plan: await all(`SELECT * FROM comfort_plan WHERE child_id LIKE 'nd_%'`),
      connection: await all(`SELECT * FROM connection WHERE id LIKE 'nd_%'`),
      classroomChild: await all(`SELECT * FROM classroom_child WHERE child_id LIKE 'nd_%'`),
      enrollment: await all(`SELECT * FROM enrollment WHERE id LIKE 'nd_%'`),
      invite: await all(`SELECT * FROM invite_code WHERE code = 'NDCODE'`),
      session: await all(`SELECT * FROM comfort_session WHERE id LIKE 'nd_%'`),
      flag: await all(`SELECT * FROM session_flag WHERE id LIKE 'nd_%'`),
      alert: await all(`SELECT * FROM alert WHERE id LIKE 'nd_%'`),
    });
    const before = await snap();
    expect(before.session).toHaveLength(1);

    await resetDemoWorld(s.e);

    expect(await snap()).toEqual(before);
    // Only the demo teacher's own membership in the real daycare was undone.
    expect(await one('SELECT role FROM org_member WHERE org_id = ? AND user_id = ?', 'nd_org', U.jess)).toBeNull();
  });

  it('shifts fixture timestamps forward by whole days since seeding, so the world stays recent', async () => {
    const s = setup();
    const seededAt = NOW - 3 * DAY - 5 * MIN;
    const f = fixture(seededAt);
    await seed(s, f);
    expect((await one<{ started_at: number }>(`SELECT started_at FROM comfort_session WHERE id = 'demo.sess.1'`))!.started_at).toBe(
      f.sessions![0]!.startedAt + 3 * DAY,
    );
    await resetDemoWorld(s.e);
    const row = await one<{ started_at: number; transcript_json: string }>(`SELECT started_at, transcript_json FROM comfort_session WHERE id = 'demo.sess.1'`);
    expect(row!.started_at).toBe(f.sessions![0]!.startedAt + 3 * DAY);
    expect(JSON.parse(row!.transcript_json)[0].timestamp).toBe(new Date(f.sessions![0]!.startedAt + 3 * DAY + 1000).toISOString());
    expect((await one<{ created_at: number }>(`SELECT created_at FROM session_flag WHERE id = 'demo.flag.1'`))!.created_at).toBe(f.flags![0]!.createdAt + 3 * DAY);
    const plan = await one<{ today_note_expires_at: number }>('SELECT today_note_expires_at FROM comfort_plan WHERE child_id = ? AND avatar_id = ?', MIA, AV_S);
    expect(plan!.today_note_expires_at).toBe(todayNoteExpiry('America/Chicago', plan!.today_note_expires_at - 1));
    await seed(s); // back to a fresh fixture for later tests
  });

  it('the nightly cron also clears stale rate-limit windows', async () => {
    const s = setup();
    await seed(s);
    await seedRows(env as Env, { rate_limit: [{ key: 'demo-sign-in:old', window_start: 0, count: 3 }] });
    await resetDemoWorld(s.e);
    expect(await one(`SELECT key FROM rate_limit WHERE key = 'demo-sign-in:old'`)).toBeNull();
  });
});

describe('clerkSignInToken', () => {
  it('POSTs {user_id, expires_in_seconds: 300} with the secret key and returns the token', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ token: 'tok_123', url: 'https://x' }), { status: 200 }));
    const token = await clerkSignInToken({ CLERK_SECRET_KEY: 'sk_test_abc' }, 'user_1', fetchImpl as unknown as typeof fetch);
    expect(token).toBe('tok_123');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.clerk.com/v1/sign_in_tokens');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_abc');
    expect(JSON.parse(init!.body as string)).toEqual({ user_id: 'user_1', expires_in_seconds: 300 });
  });

  it('throws on an error status or a missing token', async () => {
    const bad = vi.fn(async () => new Response('{}', { status: 422 }));
    await expect(clerkSignInToken({ CLERK_SECRET_KEY: 'k' }, 'u', bad as unknown as typeof fetch)).rejects.toThrow(/422/);
    const empty = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(clerkSignInToken({ CLERK_SECRET_KEY: 'k' }, 'u', empty as unknown as typeof fetch)).rejects.toThrow(/no token/);
  });
});

describe('the real seed fixture (scripts/seed)', () => {
  it('is accepted by PUT /api/admin/seed and gives the roster with mixed statuses', async () => {
    const { buildFixture, placeholderIds } = await import('../../../scripts/seed/fixture');
    const s = setup();
    const f = buildFixture(placeholderIds(), Date.now() - MIN);
    await seed(s, f);
    const roster = await (await s.request('/api/orgs/demo.org.acorns/roster', { headers: authAs('user_dryrun_jess') })).json() as { tiles: { name: string; status: string; readyAvatars: unknown[] }[] };
    expect(roster.tiles.map((t) => `${t.name}:${t.status}`)).toEqual([
      'Mia:ready', 'Leo:ready', 'Ava:ready', 'Noah:setup_pending', 'Zoe:ready', 'Eli:ready', 'Isla:invite_sent', 'Sam:ready',
    ]);
    const titles = Object.fromEntries(roster.tiles.map((t) => [t.name, (t.readyAvatars as { parentTitle: string }[]).map((a) => a.parentTitle).sort()]));
    expect(titles).toMatchObject({ Ava: ['Baba', 'Mommy'], Zoe: ['Mommy'], Eli: ['Papa'], Sam: ['Mama'], Leo: ['Daddy'] });
    expect(titles.Mia).toContain('Mommy');
    // Roster parents are demo users without a sign-in persona.
    expect(await one(`SELECT is_demo FROM user WHERE id = 'user_dryrun_hannah'`)).toEqual({ is_demo: 1 });
    expect(await all(`SELECT persona FROM demo_persona WHERE user_id = 'user_dryrun_hannah'`)).toEqual([]);
    const sessions = await all(`SELECT id FROM comfort_session WHERE id LIKE 'demo.sess.s%'`);
    expect(sessions).toHaveLength(8);
    await resetDemoWorld(s.e);
    expect(await all(`SELECT id FROM comfort_session WHERE id LIKE 'demo.sess.s%'`)).toHaveLength(8);
    expect(await verifyPin(s.e, 'user_dryrun_jess', 'demo.org.acorns', '1234')).toBe(true);
    expect(await verifyPin(s.e, 'user_dryrun_tanya', 'demo.org.acorns', '2468')).toBe(true);
    await seed(s); // back to the compact fixture for any later test
  }, 20_000); // imports scripts/seed and seeds the full world: ~5 s under the parallel suite, so the 5 s default flakes
});

// ---- fix round 1 ------------------------------------------------------------------------------------------------

describe('fix round 1: demo photos, probing, seed guards, invites, cutoff, IPv6', () => {
  const MIA_PHOTO = 'child/demo.fam.johnson/aaaaaaaaaaaaaaaaaaaaa.png';

  it('a demo user cannot change or clear a child photoKey (the seeded R2 portrait survives)', async () => {
    const s = setup();
    await seed(s);
    await env.MEDIA.put(MIA_PHOTO, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    for (const photoKey of [null, 'child/demo.fam.johnson/bbbbbbbbbbbbbbbbbbbbb.png']) {
      const res = await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { photoKey }));
      expect(res.status).toBe(403);
      expect(await errCode(res)).toBe('DEMO_READ_ONLY');
    }
    expect(await env.MEDIA.head(MIA_PHOTO)).not.toBeNull();
    expect((await one<{ photo_key: string }>('SELECT photo_key FROM child WHERE id = ?', MIA))!.photo_key).toBe(MIA_PHOTO);
    // Resending the same key alongside another edit is fine.
    expect((await s.request(`/api/children/${MIA}`, as(U.sarah, 'PATCH', { photoKey: MIA_PHOTO, birthday: '2022-03-14' }))).status).toBe(200);
  });

  it('rename / photo checks run after authorization, so demo users cannot probe other families or orgs', async () => {
    const s = setup();
    await seed(s);
    await seedRows(env as Env, {
      user: [{ id: 'pr_p', name: 'Probe Parent', email: 'pp@x', created_at: NOW }],
      family: [{ id: 'pr_f', created_at: NOW }],
      family_member: [{ family_id: 'pr_f', user_id: 'pr_p', role: 'parent' }],
      child: [{ id: 'pr_c', family_id: 'pr_f', name: 'Probe Kid' }],
      org: [{ id: 'pr_org', name: 'Probe Daycare' }],
      org_member: [{ org_id: 'pr_org', user_id: 'pr_p', role: 'admin' }],
    });
    const child = await s.request('/api/children/pr_c', as(U.sarah, 'PATCH', { name: 'X', photoKey: null }));
    const missing = await s.request('/api/children/no_such_child', as(U.sarah, 'PATCH', { name: 'X' }));
    const org = await s.request('/api/orgs/pr_org', as(U.tanya, 'PATCH', { name: 'X' }));
    for (const res of [child, missing, org]) {
      expect(res.status).not.toBe(200);
      expect(await errCode(res)).not.toBe('DEMO_READ_ONLY');
    }
    expect(await errCode(child)).toBe(await errCode(missing)); // same answer whether or not the child exists
  });

  it('seed refuses (a) a fixture user id that already exists as a non-demo user', async () => {
    const s = setup();
    await seed(s);
    await seedRows(env as Env, { user: [{ id: 'sg_real', name: 'Real Person', email: 'real@x', created_at: NOW }] });
    const f = fixture();
    f.users.push({ id: 'sg_real', name: 'Real Person', email: 'real.person.demo@everthere.app' });
    const res = await s.request('/api/admin/seed', admin('PUT', f));
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('INVALID');
    expect(await one('SELECT is_demo, name FROM user WHERE id = ?', 'sg_real')).toEqual({ is_demo: 0, name: 'Real Person' });
  });

  it('seed refuses (b) family / org / child / classroom ids that exist but are not in the stored fixture', async () => {
    const s = setup();
    await seed(s);
    await seedRows(env as Env, {
      family: [{ id: 'sg_f', created_at: NOW }],
      org: [{ id: 'sg_org', name: 'Real Org' }],
      child: [{ id: 'sg_c', family_id: 'sg_f', name: 'Real Kid' }],
      classroom: [{ id: 'sg_room', org_id: 'sg_org', name: 'Real Room' }],
    });
    const cases: ((f: DemoFixtureInput) => void)[] = [
      (f) => f.families!.push({ id: 'sg_f' }),
      (f) => f.orgs!.push({ id: 'sg_org', name: 'Hijack', timezone: 'UTC' }),
      (f) => f.children!.push({ id: 'sg_c', familyId: FAM_J, name: 'Hijack', timezone: 'UTC' }),
      (f) => f.classrooms!.push({ id: 'sg_room', orgId: ORG, name: 'Hijack' }),
    ];
    for (const mutate of cases) {
      const f = fixture();
      mutate(f);
      const res = await s.request('/api/admin/seed', admin('PUT', f));
      expect(res.status).toBe(400);
      expect(await errCode(res)).toBe('INVALID');
    }
    expect(await one('SELECT name FROM org WHERE id = ?', 'sg_org')).toEqual({ name: 'Real Org' });
    expect(await one('SELECT family_id, name FROM child WHERE id = ?', 'sg_c')).toEqual({ family_id: 'sg_f', name: 'Real Kid' });
    expect(await one('SELECT name FROM classroom WHERE id = ?', 'sg_room')).toEqual({ name: 'Real Room' });
    await seed(s); // ids already in the stored fixture are fine (re-seed)
  });

  it('seed refuses (c) emails that are not *.demo@everthere.app', async () => {
    const s = setup();
    for (const email of ['sarah@gmail.com', 'sarah.demo@everthere.app.evil.com', 'sarah@demo.everthere.app']) {
      const f = fixture();
      f.users[0]!.email = email;
      expect((await s.request('/api/admin/seed', admin('PUT', f))).status, email).toBe(400);
    }
  });

  it('redeem refuses invites across the demo boundary, in both directions', async () => {
    const s = setup();
    await seed(s);
    await seedRows(env as Env, {
      user: [
        { id: 'iv_real', name: 'Real Judge', email: 'rj@x', created_at: NOW },
        { id: 'iv_realp', name: 'Real Parent', email: 'rp@x', created_at: NOW },
      ],
      family: [{ id: 'iv_f', created_at: NOW }],
      family_member: [{ family_id: 'iv_f', user_id: 'iv_realp', role: 'parent' }],
      invite_code: [{ code: 'RLNV22', type: 'co_parent', payload: JSON.stringify({ familyId: 'iv_f' }), created_by: 'iv_realp', expires_at: Date.now() + DAY }],
    });
    // A real user cannot redeem a demo invite (the seeded enrollment invite) ...
    const inDemo = await s.request('/api/invites/redeem', as('iv_real', 'POST', { code: 'DEMO02' }));
    expect(inDemo.status).toBe(400);
    expect(await errCode(inDemo)).toBe('INVITE_INVALID');
    expect(await one(`SELECT used_at FROM invite_code WHERE code = 'DEMO02'`)).toEqual({ used_at: null });
    // ... and a demo user cannot redeem a real one.
    const outOfDemo = await s.request('/api/invites/redeem', as(U.marcus, 'POST', { code: 'RLNV22' }));
    expect(outOfDemo.status).toBe(400);
    expect(await errCode(outOfDemo)).toBe('INVITE_INVALID');
    expect(await one(`SELECT user_id FROM family_member WHERE family_id = 'iv_f' AND user_id = ?`, U.marcus)).toBeNull();
    // Demo-to-demo still works.
    const inv = await (await s.request('/api/invites', as(U.sarah, 'POST', { type: 'co_parent', familyId: FAM_J }))).json() as { code: string };
    expect((await s.request('/api/invites/redeem', as(U.jess, 'POST', { code: inv.code }))).status).toBe(200);
    await resetDemoWorld(s.e);
  });

  it('a re-seed keeps the earliest seed time as the cutoff, so judge activity in between is removed', async () => {
    const s = setup();
    await seed(s);
    await env.DB.prepare('UPDATE demo_fixture SET seeded_at = ?, first_seeded_at = ? WHERE id = 1').bind(Date.now(), Date.now()).run().catch(() => undefined);
    const t0 = Date.now() - 2 * 3_600_000;
    await seed(s, fixture(t0));
    const judge = (id: string, at: number) =>
      seedRows(env as Env, { comfort_session: [{ id, child_id: MIA, avatar_id: AV_S, caregiver_user_id: U.jess, org_id: ORG, started_at: at, status: 'closed', ended_at: at + MIN }] });
    await judge('cut.a', t0 + 30 * MIN); // between the first and the second seed
    const t1 = Date.now() - MIN;
    await seed(s, fixture(t1));
    expect(await one('SELECT seeded_at, first_seeded_at FROM demo_fixture WHERE id = 1')).toEqual({ seeded_at: t1, first_seeded_at: t0 });
    expect(await one(`SELECT id FROM comfort_session WHERE id = 'cut.a'`)).toBeNull();
    await judge('cut.b', t0 + 40 * MIN); // also before the latest seed time
    await resetDemoWorld(s.e);
    expect(await one(`SELECT id FROM comfort_session WHERE id = 'cut.b'`)).toBeNull();
    // An older fixture never moves the cutoff later.
    await seed(s, fixture(t1));
    expect((await one<{ first_seeded_at: number }>('SELECT first_seeded_at FROM demo_fixture WHERE id = 1'))!.first_seeded_at).toBe(t0);
  });

  it('rate-limits IPv6 clients by their /64; IPv4 stays per address', async () => {
    expect(rateLimitIpKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitIpKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitIpKey('::ffff:198.51.100.4')).toBe('0:0:0:0::/64');
    expect(rateLimitIpKey('unknown')).toBe('unknown');
    const s = setup();
    await seed(s);
    for (let i = 0; i < 10; i++) {
      const ip = `2001:db8:77:${'1'}:${(i + 1).toString(16)}::${i}`;
      expect((await signIn(s, 'parent', ip)).status).toBe(200);
    }
    expect((await signIn(s, 'parent', '2001:db8:77:1:ffff::ffff')).status).toBe(429);
    expect((await signIn(s, 'parent', '2001:db8:77:2::1')).status).toBe(200); // another /64
  });
});
