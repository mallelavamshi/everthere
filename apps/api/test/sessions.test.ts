import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createApp } from '../src/index';
import type { Env } from '../src/env';
import { napster as realNapster, NapsterError } from '../src/napster/client';
import { signActingToken, ACTING_TTL_MS } from '../src/auth/acting';
import { testVerify, testFetchProfile, authAs, seedRows } from './helpers';
import { childClientId } from '../src/lib/clientIds';
import { TEST_SESSION_CONTEXT } from '../src/services/sessions';

const NOW = Date.now();
const DAY = 86_400_000;

type ConnOver = () => Promise<{ token: string; connectionId: string }>;
function fake(conn?: ConnOver) {
  let n = 0;
  return {
    createConnection: vi.fn(conn ?? (async (_agent: string, _b: unknown) => ({ token: `tok${++n}`, connectionId: `conn${n}` }))),
    deleteConnection: vi.fn(async (_id: string) => undefined),
  };
}
type Fake = ReturnType<typeof fake>;

function setup(f: Fake | Record<string, unknown> = fake()) {
  const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: f as never });
  const e = env as Env;
  return { f: f as Fake, request: (p: string, init?: RequestInit) => app.request(p, init, e) };
}
type S = ReturnType<typeof setup>;

/**
 * App whose D1 runs `hook` instead of `run()` for the statement whose SQL contains `match`
 * (hook gets the real run). Used to simulate interleavings and failures deterministically.
 */
function setupWithDbHook(f: Fake, match: string, hook: (run: () => Promise<D1Result>) => Promise<D1Result>) {
  const real = env.DB;
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(t, p) {
        if (p === 'bind') return (...a: unknown[]) => wrapStmt(t.bind(...a));
        if (p === 'run') return () => hook(() => t.run());
        const v = Reflect.get(t, p);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  const DB = new Proxy(real, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => (sql.includes(match) ? wrapStmt(t.prepare(sql)) : t.prepare(sql));
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: f as never });
  const e = { ...(env as Env), DB } as Env;
  return { f, request: (p: string, init?: RequestInit) => app.request(p, init, e) };
}


const call = (s: S, user: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
  s.request(path, {
    method,
    headers: { ...authAs(user), 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T = any>(res: Response) => (await res.json()) as T;
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;
const row = (id: string) => env.DB.prepare('SELECT * FROM comfort_session WHERE id = ?').bind(id).first<Record<string, any>>();
const all = async <T = Record<string, any>>(sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).all<T>()).results;

/**
 * Per-test world, all ids prefixed `p`:
 * org A (classrooms A1 staff T, A2 staff T2; admin AD; tablet account TAB; TB also a teacher here),
 * org B (classroom B1 staff TB; admin ADB). Family F (parents P "Pat Doe", P2) with child C1 "Mia" in A1 (daycare A).
 * Family FH (PH) with child CH, home-cared by T. Family FB (PB) with child CB in B1 (daycare B).
 * Approved avatars av1 (P), avH (PH), avB (PB). Tablet device dev in org A.
 */
async function world(p: string) {
  const id = (s: string) => `${p}${s}`;
  await seedRows(env, {
    user: ['P', 'P2', 'T', 'T2', 'AD', 'TAB', 'OUT', 'PH', 'PB', 'ADB', 'TB'].map((u) => ({
      id: id(u),
      name: u === 'P' ? 'Pat Doe' : `${u} Person`,
      email: `${id(u)}@x`,
      created_at: NOW,
    })),
    org: [{ id: id('A'), name: 'A' }, { id: id('B'), name: 'B' }],
    org_member: [
      { org_id: id('A'), user_id: id('T'), role: 'teacher' },
      { org_id: id('A'), user_id: id('T2'), role: 'teacher' },
      { org_id: id('A'), user_id: id('AD'), role: 'admin' },
      { org_id: id('A'), user_id: id('TAB'), role: 'teacher' },
      { org_id: id('A'), user_id: id('TB'), role: 'teacher' },
      { org_id: id('B'), user_id: id('TB'), role: 'teacher' },
      { org_id: id('B'), user_id: id('ADB'), role: 'admin' },
    ],
    classroom: [
      { id: id('A1'), org_id: id('A'), name: 'A1' },
      { id: id('A2'), org_id: id('A'), name: 'A2' },
      { id: id('B1'), org_id: id('B'), name: 'B1' },
    ],
    classroom_staff: [
      { classroom_id: id('A1'), user_id: id('T') },
      { classroom_id: id('A2'), user_id: id('T2') },
      { classroom_id: id('B1'), user_id: id('TB') },
    ],
    family: [{ id: id('F'), created_at: 1 }, { id: id('FH'), created_at: 1 }, { id: id('FB'), created_at: 1 }],
    family_member: [
      { family_id: id('F'), user_id: id('P'), role: 'parent' },
      { family_id: id('F'), user_id: id('P2'), role: 'parent' },
      { family_id: id('FH'), user_id: id('PH'), role: 'parent' },
      { family_id: id('FB'), user_id: id('PB'), role: 'parent' },
    ],
    child: [
      { id: id('C1'), family_id: id('F'), name: 'Mia', birthday: '2022-03-01' },
      { id: id('CH'), family_id: id('FH'), name: 'Hugo', birthday: '2021-01-01' },
      { id: id('CB'), family_id: id('FB'), name: 'Bea', birthday: '2023-01-01' },
    ],
    classroom_child: [
      { classroom_id: id('A1'), child_id: id('C1') },
      { classroom_id: id('B1'), child_id: id('CB') },
    ],
    connection: [
      { id: id('cn1'), child_id: id('C1'), kind: 'daycare', org_id: id('A'), transcript_access: 0 },
      { id: id('cnH'), child_id: id('CH'), kind: 'home', caregiver_user_id: id('T'), transcript_access: 0 },
      { id: id('cnB'), child_id: id('CB'), kind: 'daycare', org_id: id('B'), transcript_access: 0 },
    ],
    avatar: [
      { id: id('av1'), user_id: id('P'), status: 'approved', napster_agent_id: 'ag1', parent_title: 'Mommy', created_at: NOW },
      { id: id('avH'), user_id: id('PH'), status: 'approved', napster_agent_id: 'agH', parent_title: 'Daddy', created_at: NOW },
      { id: id('avB'), user_id: id('PB'), status: 'approved', napster_agent_id: 'agB', parent_title: 'Mama', created_at: NOW },
    ],
    comfort_plan: [
      {
        child_id: id('C1'), avatar_id: id('av1'), parent_title: 'Mommy', nicknames: '["Bug"]', tone: 'calm',
        favorites: '["dinosaurs"]', phrases: '[]', never_topics: '["the dog"]', today_note: 'old note', today_note_expires_at: NOW - 1000,
      },
    ],
    device: [{ id: id('dev'), org_id: id('A'), registered_by: id('TAB'), created_at: NOW }],
  });
  const actingFor = (teacher: string, org = id('A')) =>
    signActingToken(env, { deviceId: id('dev'), orgId: org, teacherUserId: teacher, exp: Date.now() + ACTING_TTL_MS });
  return { id, actingFor };
}

const startBody = (w: { id: (s: string) => string }, child = 'C1', avatar = 'av1', reason = 'missing_parent') => ({
  childId: w.id(child),
  avatarId: w.id(avatar),
  reason,
});
async function start(s: S, user: string, body: unknown, extra: Record<string, string> = {}) {
  return call(s, user, 'POST', '/api/sessions', body, extra);
}
async function started(s: S, user: string, body: unknown) {
  const res = await start(s, user, body);
  expect(res.status).toBe(200);
  return json<{ sessionId: string; token: string }>(res);
}

describe('POST /api/sessions', () => {
  it('happy path: Napster gets the derived externalClientId, forced deferred video, profile, speech and tags', async () => {
    const w = await world('seH_');
    const captured: { url: string; body: any }[] = [];
    const fetchFake = vi.fn(async (url: string, init: RequestInit) => {
      captured.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ token: 'live-token', connection: { id: 'napconn1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const s = setup(realNapster('key', { fetch: fetchFake as never }) as never);
    const res = await start(s, w.id('T'), startBody(w));
    expect(res.status).toBe(200);
    const out = await json<{ sessionId: string; token: string }>(res);
    expect(out.token).toBe('live-token');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain('/agents/ag1/connections');
    const b = captured[0]!.body;
    expect(b.channelType).toBe('webrtc');
    expect(b.videoPolicy).toBe('deferred');
    expect(b.externalClientId).toBe(await childClientId(w.id('C1')));
    expect(b.externalClientId).not.toBe(w.id('C1'));
    expect(b.externalClientId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(b.externalClientProfile).toMatchObject({ childName: 'Mia', parentTitle: 'Mommy', parentFirstName: 'Pat', nicknames: ['Bug'], tone: 'calm' });
    expect(b.externalClientProfile.childAgeYears).toBeGreaterThanOrEqual(4);
    expect(b.externalClientProfile).not.toHaveProperty('todayNote'); // expired note dropped
    expect(b.initialSpeech).toBe('Hi Bug! I know you miss Mommy. I\'m here with you on the screen.');
    expect(b.tags).toMatchObject({ childId: w.id('C1'), caregiverId: w.id('T'), reason: 'missing_parent', kind: 'child' });
    expect(Array.isArray(b.tags)).toBe(false);
    expect(Object.values(b.tags).every((v) => typeof v === 'string')).toBe(true);
    expect(await row(out.sessionId)).toMatchObject({
      child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'),
      reason: 'missing_parent', status: 'started', kind: 'child', napster_session_id: 'napconn1', ended_at: null,
    });
  });

  it('validates the body and requires access (parent, outsider, other-org admin, unapproved avatar)', async () => {
    const w = await world('seV_');
    const s = setup();
    expect(await errCode(await start(s, w.id('T'), { childId: w.id('C1'), reason: 'missing_parent' }))).toBe('INVALID');
    expect(await errCode(await start(s, w.id('T'), startBody(w, 'C1', 'av1', 'nope')))).toBe('INVALID');
    for (const u of ['P', 'OUT', 'ADB', 'T2']) expect(await errCode(await start(s, w.id(u), startBody(w))), u).toBe('FORBIDDEN');
    expect(await errCode(await start(s, w.id('T'), startBody(w, 'C1', 'avB')))).toBe('FORBIDDEN'); // other family's avatar
    expect(s.f.createConnection).not.toHaveBeenCalled();
  });

  it('a second start for the same child while active -> SESSION_ACTIVE (any caregiver); allowed again after end', async () => {
    const w = await world('seA_');
    const s = setup();
    const first = await started(s, w.id('T'), startBody(w));
    const again = await start(s, w.id('T'), startBody(w));
    expect([again.status, await errCode(again)]).toEqual([409, 'SESSION_ACTIVE']);
    expect(await errCode(await start(s, w.id('AD'), startBody(w, 'C1', 'av1', 'upset_nap')))).toBe('SESSION_ACTIVE');
    expect(s.f.createConnection).toHaveBeenCalledTimes(1);
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${first.sessionId}/end`)).status).toBe(200);
    await started(s, w.id('T'), startBody(w));
    expect(s.f.createConnection).toHaveBeenCalledTimes(2);
  });

  it('concurrent starts for the same child: exactly one 200, one SESSION_ACTIVE, one Napster call', async () => {
    const w = await world('seC_');
    const s = setup();
    const [a, b] = await Promise.all([start(s, w.id('T'), startBody(w)), start(s, w.id('AD'), startBody(w))]);
    const results = [
      { status: a.status, code: a.status === 200 ? 'OK' : await errCode(a) },
      { status: b.status, code: b.status === 200 ? 'OK' : await errCode(b) },
    ].sort((x, y) => x.status - y.status);
    expect(results).toEqual([{ status: 200, code: 'OK' }, { status: 409, code: 'SESSION_ACTIVE' }]);
    expect(s.f.createConnection).toHaveBeenCalledTimes(1);
    expect(await all('SELECT id FROM comfort_session WHERE child_id = ?', w.id('C1'))).toHaveLength(1);
  });

  it('the 21st session in a UTC day -> RESTING (test, failed and yesterday rows do not count)', async () => {
    const w = await world('seD_');
    const s = setup();
    const dayStart = Math.floor(Date.now() / DAY) * DAY;
    const rows = (tag: string, n: number, over: Record<string, unknown>) =>
      Array.from({ length: n }, (_, i) => ({
        id: w.id(`${tag}${i}`), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'),
        started_at: dayStart + 1, ended_at: dayStart + 2, status: 'closed', kind: 'child', ...over,
      }));
    await seedRows(env, {
      comfort_session: [
        ...rows('today', 19, {}),
        ...rows('test', 3, { kind: 'test', child_id: null }),
        ...rows('failed', 2, { status: 'failed' }),
        ...rows('yday', 4, { started_at: dayStart - 10, ended_at: dayStart - 5 }),
      ],
    });
    await started(s, w.id('T'), startBody(w)); // 20th
    const res = await start(s, w.id('T'), startBody(w, 'CH', 'avH')); // 21st
    expect([res.status, await errCode(res)]).toEqual([503, 'RESTING']);
    expect(s.f.createConnection).toHaveBeenCalledTimes(1);
    // Another caregiver is unaffected by T's count.
    expect(await errCode(await start(s, w.id('AD'), startBody(w)))).toBe('SESSION_ACTIVE');
  });

  it('a demo (is_demo) caregiver may start past 20 a day: the demo limit is LIMITS.demoSessionsPerUserPerDay', async () => {
    const w = await world('seDd_');
    const s = setup();
    await env.DB.prepare('UPDATE user SET is_demo = 1 WHERE id = ?').bind(w.id('T')).run();
    const dayStart = Math.floor(Date.now() / DAY) * DAY;
    const rows = (tag: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: w.id(`${tag}${i}`), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'),
        started_at: dayStart + 1, ended_at: dayStart + 2, status: 'closed', kind: 'child',
      }));
    await seedRows(env, { comfort_session: rows('today', 25) });
    await started(s, w.id('T'), startBody(w)); // the 26th is fine for a demo user
    expect(s.f.createConnection).toHaveBeenCalledTimes(1);
  });

  it('spent >= cap -> RESTING before Napster is called', async () => {
    const w = await world('seR_');
    const s = setup();
    await env.DB.prepare('UPDATE credit_guard SET spent_usd = cap_usd WHERE id = 1').run();
    try {
      const res = await start(s, w.id('T'), startBody(w));
      expect([res.status, await errCode(res)]).toEqual([503, 'RESTING']);
      expect(s.f.createConnection).not.toHaveBeenCalled();
      expect(await all('SELECT id FROM comfort_session WHERE child_id = ?', w.id('C1'))).toHaveLength(0);
    } finally {
      await env.DB.prepare('UPDATE credit_guard SET spent_usd = 0 WHERE id = 1').run();
    }
  });

  it('Napster BUSY -> AVATARS_BUSY; the row is failed and does not block the next start', async () => {
    const w = await world('seB_');
    let busy = true;
    const s = setup(
      fake(async () => {
        if (busy) throw new NapsterError(409, 'BUSY');
        return { token: 'tok', connectionId: 'connOK' };
      }),
    );
    const res = await start(s, w.id('T'), startBody(w));
    expect([res.status, await errCode(res)]).toEqual([503, 'AVATARS_BUSY']);
    expect(await all('SELECT status, ended_reason FROM comfort_session WHERE child_id = ?', w.id('C1'))).toEqual([
      { status: 'failed', ended_reason: 'busy' },
    ]);
    busy = false;
    const ok = await started(s, w.id('T'), startBody(w));
    expect((await row(ok.sessionId))!.status).toBe('started');
  });

  it('other Napster errors -> INTERNAL with ended_reason napster_error', async () => {
    const w = await world('seE_');
    const s = setup(fake(async () => { throw new NapsterError(500, 'HTTP_500'); }));
    expect(await errCode(await start(s, w.id('T'), startBody(w)))).toBe('INTERNAL');
    expect(await all('SELECT status, ended_reason FROM comfort_session WHERE child_id = ?', w.id('C1'))).toEqual([
      { status: 'failed', ended_reason: 'napster_error' },
    ]);
  });

  it('an acting teacher on the tablet is attributed, with the acting org', async () => {
    const w = await world('seT_');
    const s = setup();
    const token = await w.actingFor(w.id('T'));
    const res = await start(s, w.id('TAB'), startBody(w), { 'X-Acting-Token': token });
    expect(res.status).toBe(200);
    const { sessionId } = await json(res);
    expect(await row(sessionId)).toMatchObject({ caregiver_user_id: w.id('T'), org_id: w.id('A') });
    const tags = (s.f.createConnection.mock.calls[0]![1] as { tags: Record<string, string> }).tags;
    expect(tags.caregiverId).toBe(w.id('T'));
  });

  it('an acting teacher cannot start a session for their own home-caregiver child from the tablet', async () => {
    const w = await world('seHm_');
    const s = setup();
    const token = await w.actingFor(w.id('T'));
    expect(await errCode(await start(s, w.id('TAB'), startBody(w, 'CH', 'avH'), { 'X-Acting-Token': token }))).toBe('FORBIDDEN');
    expect(s.f.createConnection).not.toHaveBeenCalled();
    // Signed in as themselves (no acting token), the home path works and has no org.
    const { sessionId } = await started(s, w.id('T'), startBody(w, 'CH', 'avH'));
    expect((await row(sessionId))!.org_id).toBeNull();
  });

  it('an acting token from org A cannot reach an org B child, even for a teacher of both orgs', async () => {
    const w = await world('seX_');
    const s = setup();
    const token = await w.actingFor(w.id('TB'));
    expect(await errCode(await start(s, w.id('TAB'), startBody(w, 'CB', 'avB'), { 'X-Acting-Token': token }))).toBe('FORBIDDEN');
    expect(s.f.createConnection).not.toHaveBeenCalled();
    const { sessionId } = await started(s, w.id('TB'), startBody(w, 'CB', 'avB'));
    expect((await row(sessionId))!.org_id).toBe(w.id('B'));
  });

  it('org_id: an admin gets their org; a caregiver reaching the child both ways prefers the daycare path', async () => {
    const w = await world('seO_');
    const s = setup();
    await seedRows(env, { connection: [{ id: w.id('cnTH'), child_id: w.id('C1'), kind: 'home', caregiver_user_id: w.id('T'), transcript_access: 0 }] });
    const a = await started(s, w.id('T'), startBody(w));
    expect((await row(a.sessionId))!.org_id).toBe(w.id('A'));
    await call(s, w.id('T'), 'POST', `/api/sessions/${a.sessionId}/end`);
    const b = await started(s, w.id('AD'), startBody(w));
    expect((await row(b.sessionId))!).toMatchObject({ org_id: w.id('A'), caregiver_user_id: w.id('AD') });
  });

  it('a pending/started session older than sessionMaxMs + 2 min no longer blocks a new start (fresh ones still do)', async () => {
    const w = await world('seSt_');
    const s = setup();
    const base = { child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('AD'), org_id: w.id('A'), kind: 'child' };
    await seedRows(env, { comfort_session: [{ id: w.id('fresh'), ...base, started_at: Date.now() - 5 * 60_000, status: 'started' }] });
    expect(await errCode(await start(s, w.id('T'), startBody(w)))).toBe('SESSION_ACTIVE');
    await env.DB.prepare('DELETE FROM comfort_session WHERE id = ?').bind(w.id('fresh')).run();
    await seedRows(env, { comfort_session: [{ id: w.id('stale'), ...base, started_at: Date.now() - 13 * 60_000, status: 'pending' }] });
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    expect((await row(sessionId))!.status).toBe('started');
  });

  it('a dotted child id (like demo.child.mia) starts: Napster gets the derived, valid externalClientId', async () => {
    const w = await world('seXc_');
    const s = setup();
    const dotted = 'demo.child.mia.seXc';
    await seedRows(env, {
      child: [{ id: dotted, family_id: w.id('F'), name: 'Dot', birthday: '2022-01-01' }],
      classroom_child: [{ classroom_id: w.id('A1'), child_id: dotted }],
      connection: [{ id: w.id('cnDot'), child_id: dotted, kind: 'daycare', org_id: w.id('A'), transcript_access: 0 }],
    });
    const res = await start(s, w.id('T'), { childId: dotted, avatarId: w.id('av1'), reason: 'upset_nap' });
    expect(res.status).toBe(200);
    const [, opts] = s.f.createConnection.mock.calls[0] as unknown as [string, Record<string, any>];
    expect(opts.externalClientId).toBe(await childClientId(dotted));
    expect(opts.externalClientId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(opts.externalClientId).not.toContain('.');
    expect(opts.tags.childId).toBe(dotted);
    expect(await all('SELECT status FROM comfort_session WHERE child_id = ?', dotted)).toEqual([{ status: 'started' }]);
  });

  it('if recording "started" fails after Napster connected: the connection is deleted and the row failed', async () => {
    const w = await world('seSf_');
    const s = setupWithDbHook(fake(), "SET status = 'started'", async () => {
      throw new Error('D1 down');
    });
    expect(await errCode(await start(s as unknown as S, w.id('T'), startBody(w)))).toBe('INTERNAL');
    expect(s.f.deleteConnection).toHaveBeenCalledWith('conn1');
    expect(await all('SELECT status, ended_reason, napster_session_id FROM comfort_session WHERE child_id = ?', w.id('C1'))).toEqual([
      { status: 'failed', ended_reason: 'db_error', napster_session_id: 'conn1' },
    ]);
    // The slot is free again.
    expect((await start(setup(), w.id('T'), startBody(w))).status).toBe(200);
  });
});

describe('POST /api/sessions/:id/end', () => {
  it('is idempotent: 200 twice, ended_at set once, deleteConnection called (errors ignored)', async () => {
    const w = await world('seN_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const r1 = await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`);
    expect(r1.status).toBe(200);
    const after1 = (await row(sessionId))!;
    expect(after1).toMatchObject({ status: 'closed' });
    expect(after1.ended_at).toBeGreaterThan(0);
    expect(after1.duration_s).toBeGreaterThanOrEqual(0);
    s.f.deleteConnection.mockImplementationOnce(async () => { throw new NapsterError(500, 'HTTP_500'); });
    const r2 = await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`);
    expect(r2.status).toBe(200);
    expect((await row(sessionId))!.ended_at).toBe(after1.ended_at);
    expect(s.f.deleteConnection).toHaveBeenCalledWith('conn1');
  });

  it('re-reads after its update: a start recording its connection concurrently still gets it deleted', async () => {
    const w = await world('seNr_');
    await seedRows(env, {
      comfort_session: [{
        id: w.id('s'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'),
        started_at: Date.now(), status: 'pending', kind: 'child',
      }],
    });
    // Interleaving: end loads the row (pending, no connection) -> the start marks it started with its connection ->
    // end runs its UPDATE.
    const s = setupWithDbHook(fake(), "status = 'closed'", async (run) => {
      await env.DB
        .prepare(`UPDATE comfort_session SET status = 'started', napster_session_id = 'raceconn' WHERE id = ? AND status = 'pending'`)
        .bind(w.id('s'))
        .run();
      return run();
    });
    const res = await call(s as unknown as S, w.id('T'), 'POST', `/api/sessions/${w.id('s')}/end`);
    expect(res.status).toBe(200);
    expect(s.f.deleteConnection).toHaveBeenCalledWith('raceconn');
    expect(await row(w.id('s'))).toMatchObject({ status: 'closed', napster_session_id: 'raceconn' });
  });

  it('an org admin may end it; other staff, parents of other families and outsiders may not', async () => {
    const w = await world('seNa_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    for (const u of ['T2', 'OUT', 'ADB', 'PH']) expect((await call(s, w.id(u), 'POST', `/api/sessions/${sessionId}/end`)).status, u).toBe(404);
    expect((await call(s, w.id('AD'), 'POST', `/api/sessions/${sessionId}/end`)).status).toBe(200);
    expect((await call(s, w.id('T'), 'POST', '/api/sessions/nope/end')).status).toBe(404);
  });

  it('the signed-in caregiver who started it can always end it, even with a stale acting token for someone else', async () => {
    const w = await world('seNs_');
    const s = setup();
    // T starts a daycare session as themselves, and a home session; then the tablet hands over to T2 (acting token).
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const home = await started(s, w.id('T'), startBody(w, 'CH', 'avH'));
    const h = { 'X-Acting-Token': await w.actingFor(w.id('T2')) };
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`, undefined, h)).status).toBe(200);
    expect((await row(sessionId))!.ended_at).toBeGreaterThan(0);
    const hSelf = { 'X-Acting-Token': await w.actingFor(w.id('T')) }; // acting scope (org A) would exclude a home session
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${home.sessionId}/end`, undefined, hSelf)).status).toBe(200);
    expect((await row(home.sessionId))!.ended_at).toBeGreaterThan(0);
    // Someone else's signed-in account with T2 acting still cannot end T's sessions outside the rules.
    const other = await started(s, w.id('T'), startBody(w, 'C1', 'av1'));
    expect((await call(s, w.id('OUT'), 'POST', `/api/sessions/${other.sessionId}/end`, undefined, h)).status).toBe(404);
  });

  it('a test session can be ended by its owner', async () => {
    const w = await world('seNt_');
    const s = setup();
    await seedRows(env, {
      comfort_session: [{ id: w.id('ts'), avatar_id: w.id('av1'), caregiver_user_id: w.id('P'), child_id: null, started_at: NOW, kind: 'test', napster_session_id: 'tconn' }],
    });
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${w.id('ts')}/end`)).status).toBe(404);
    expect((await call(s, w.id('P'), 'POST', `/api/sessions/${w.id('ts')}/end`)).status).toBe(200);
    expect((await row(w.id('ts')))!.ended_at).toBeGreaterThan(0);
    expect(s.f.deleteConnection).toHaveBeenCalledWith('tconn');
  });
});

describe('flags', () => {
  const flag = (over: Record<string, unknown> = {}) => ({ category: 'injury', severity: 'medium', quote: 'my knee hurts', source: 'live', ...over });

  it('a live flag inserts the flag and alerts every parent and org admin, deduplicated', async () => {
    const w = await world('seF_');
    const s = setup();
    // AD is also a parent in the family: one alert, not two.
    await seedRows(env, { family_member: [{ family_id: w.id('F'), user_id: w.id('AD'), role: 'parent' }] });
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const long = `She said: ${'x'.repeat(300)}`;
    const res = await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ quote: long }));
    expect(res.status).toBe(200);
    expect(await all('SELECT source, category, severity, quote FROM session_flag WHERE session_id = ?', sessionId)).toEqual([
      { source: 'live', category: 'injury', severity: 'medium', quote: long },
    ]);
    const alerts = await all<{ user_id: string; kind: string; ref_id: string; title: string; body: string }>(
      'SELECT user_id, kind, ref_id, title, body FROM alert WHERE ref_id = ? ORDER BY user_id', sessionId,
    );
    expect(alerts.map((a) => a.user_id)).toEqual([w.id('AD'), w.id('P'), w.id('P2')].sort());
    for (const a of alerts) {
      expect(a).toMatchObject({ kind: 'flag', title: '⚑ Heads up about Mia' });
      expect(a.body.length).toBeLessThanOrEqual(140);
      expect(a.body.startsWith('She said: xxx')).toBe(true);
    }
  });

  it('home sessions alert parents only (no org)', async () => {
    const w = await world('seFh_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w, 'CH', 'avH'));
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag())).status).toBe(200);
    expect((await all<{ user_id: string }>('SELECT user_id FROM alert WHERE ref_id = ?', sessionId)).map((a) => a.user_id)).toEqual([w.id('PH')]);
  });

  it('live after end -> INVALID; manual after end is fine; parents may flag; others 404; bad enums INVALID', async () => {
    const w = await world('seFl_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    expect(await errCode(await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ category: 'nope' })))).toBe('INVALID');
    expect(await errCode(await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ severity: 'huge' })))).toBe('INVALID');
    expect(await errCode(await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ source: 'post' })))).toBe('INVALID');
    await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`);
    expect(await errCode(await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag()))).toBe('INVALID');
    expect((await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ source: 'manual' }))).status).toBe(200);
    expect((await call(s, w.id('P2'), 'POST', `/api/sessions/${sessionId}/flags`, flag({ source: 'manual' }))).status).toBe(200);
    for (const u of ['T2', 'OUT', 'PH']) expect((await call(s, w.id(u), 'POST', `/api/sessions/${sessionId}/flags`, flag({ source: 'manual' }))).status, u).toBe(404);
    expect(await all('SELECT source FROM session_flag WHERE session_id = ?', sessionId)).toEqual([{ source: 'manual' }, { source: 'manual' }]);
  });
});

describe('check-in', () => {
  it('only after end -> INVALID before; caregiver or org admin; stores mood and note', async () => {
    const w = await world('seK_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const path = `/api/sessions/${sessionId}/checkin`;
    expect(await errCode(await call(s, w.id('T'), 'POST', path, { moodAfter: 'calmer' }))).toBe('INVALID');
    await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`);
    expect(await errCode(await call(s, w.id('T'), 'POST', path, { moodAfter: 'happy' }))).toBe('INVALID');
    for (const u of ['T2', 'OUT', 'P']) expect((await call(s, w.id(u), 'POST', path, { moodAfter: 'calmer' })).status, u).toBe(404);
    expect((await call(s, w.id('T'), 'POST', path, { moodAfter: 'calmer', note: 'Settled for nap' })).status).toBe(200);
    expect(await row(sessionId)).toMatchObject({ mood_after: 'calmer', caregiver_note: 'Settled for nap' });
    expect((await call(s, w.id('AD'), 'POST', path, { moodAfter: 'same' })).status).toBe(200);
    expect((await row(sessionId))!.mood_after).toBe('same');
  });
});

describe('context', () => {
  it('returns the session system message to the caregiver while active only', async () => {
    const w = await world('seCt_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const path = `/api/sessions/${sessionId}/context`;
    const res = await call(s, w.id('T'), 'GET', path);
    expect(res.status).toBe(200);
    const { systemMessage } = await json<{ systemMessage: string }>(res);
    expect(systemMessage).toContain('Mia');
    expect(systemMessage).toContain('the dog');
    expect(systemMessage).not.toContain('old note');
    for (const u of ['AD', 'P', 'OUT']) expect((await call(s, w.id(u), 'GET', path)).status, u).toBe(404);
    await call(s, w.id('T'), 'POST', `/api/sessions/${sessionId}/end`);
    expect(await errCode(await call(s, w.id('T'), 'GET', path))).toBe('INVALID');
  });

  it("returns the plan's song (title and lyrics) for the call's song button, also to a caregiver acting in the org", async () => {
    const w = await world('seSg_');
    await env.DB
      .prepare('UPDATE comfort_plan SET song_title = ?, song_lyrics = ? WHERE child_id = ? AND avatar_id = ?')
      .bind('Twinkle Twinkle', 'Twinkle twinkle little star', w.id('C1'), w.id('av1'))
      .run();
    const s = setup();
    const token = await w.actingFor(w.id('T'));
    const h = { 'X-Acting-Token': token };
    const { sessionId } = await json<{ sessionId: string }>(await start(s, w.id('TAB'), startBody(w), h));
    const res = await call(s, w.id('TAB'), 'GET', `/api/sessions/${sessionId}/context`, undefined, h);
    expect(res.status).toBe(200);
    const body = await json<{ systemMessage: string; song?: unknown }>(res);
    expect(body.song).toEqual({ title: 'Twinkle Twinkle', lyrics: 'Twinkle twinkle little star' });
    expect(body.systemMessage).toContain('Twinkle Twinkle');
  });

  it('a song with a title and no lyrics has no lyrics key', async () => {
    const w = await world('seSl_');
    await env.DB.prepare('UPDATE comfort_plan SET song_title = ? WHERE child_id = ?').bind('Hush Little Baby', w.id('C1')).run();
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const body = await json<{ song?: unknown }>(await call(s, w.id('T'), 'GET', `/api/sessions/${sessionId}/context`));
    expect(body.song).toEqual({ title: 'Hush Little Baby' });
  });

  it('omits song when the plan has no song title (lyrics alone are not a song)', async () => {
    const w = await world('seSn_');
    await env.DB.prepare("UPDATE comfort_plan SET song_title = '  ', song_lyrics = 'la la' WHERE child_id = ?").bind(w.id('C1')).run();
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w));
    const body = await json<Record<string, unknown>>(await call(s, w.id('T'), 'GET', `/api/sessions/${sessionId}/context`));
    expect(body.systemMessage).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('song');
  });

  it('never returns a song for a test session', async () => {
    const w = await world('seSx_');
    await env.DB.prepare('UPDATE comfort_plan SET song_title = ? WHERE child_id = ?').bind('Twinkle Twinkle', w.id('C1')).run();
    await seedRows(env, {
      comfort_session: [
        { id: w.id('ts'), avatar_id: w.id('av1'), caregiver_user_id: w.id('P'), child_id: null, started_at: NOW, status: 'started', kind: 'test' },
        // Even a test row that names a child (not written by the API today) gets no song.
        { id: w.id('tc'), avatar_id: w.id('av1'), caregiver_user_id: w.id('P'), child_id: w.id('C1'), started_at: NOW, status: 'started', kind: 'test' },
      ],
    });
    const s = setup();
    for (const id of [w.id('ts'), w.id('tc')]) {
      const res = await call(s, w.id('P'), 'GET', `/api/sessions/${id}/context`);
      expect(res.status, id).toBe(200);
      const body = await json<Record<string, unknown>>(res);
      expect(body.systemMessage, id).toBe(TEST_SESSION_CONTEXT);
      expect(body, id).not.toHaveProperty('song');
    }
  });
});

describe('GET /api/sessions and /api/sessions/:id', () => {
  it('lists child sessions newest first with a cursor, excluding test sessions; requires canViewChild', async () => {
    const w = await world('seL_');
    const s = setup();
    await seedRows(env, {
      comfort_session: [
        ...Array.from({ length: 23 }, (_, i) => ({
          id: w.id(`s${String(i).padStart(2, '0')}`), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'),
          reason: 'upset_nap', started_at: NOW - (i + 1) * 60_000, ended_at: NOW - i * 60_000, duration_s: 60, status: 'closed', kind: 'child',
          mood_after: i === 0 ? 'calmer' : null, summary: i === 0 ? 'Calmed down' : null, mood_signal: i === 0 ? 'better' : null,
        })),
        { id: w.id('test'), child_id: null, avatar_id: w.id('av1'), caregiver_user_id: w.id('P'), started_at: NOW, kind: 'test' },
        { id: w.id('fail'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), started_at: NOW, status: 'failed', kind: 'child' },
      ],
      session_flag: [{ id: w.id('fl'), session_id: w.id('s00'), source: 'live', category: 'illness', quote: 'tummy', severity: 'low', created_at: NOW }],
    });
    const p1 = await json<{ items: any[]; nextCursor: string | null }>(await call(s, w.id('P'), 'GET', `/api/sessions?childId=${w.id('C1')}`));
    expect(p1.items).toHaveLength(20);
    expect(p1.items.map((i) => i.id)).not.toContain(w.id('test'));
    expect(p1.items.map((i) => i.id)).not.toContain(w.id('fail'));
    expect(p1.items[0]).toEqual({
      id: w.id('s00'), child: { id: w.id('C1'), name: 'Mia' }, caregiverName: 'T Person', parentTitle: 'Mommy', reason: 'upset_nap',
      startedAt: NOW - 60_000, durationS: 60, moodAfter: 'calmer', summary: 'Calmed down', moodSignal: 'better',
      flags: [expect.objectContaining({ id: w.id('fl'), category: 'illness', severity: 'low', quote: 'tummy', source: 'live' })],
    });
    expect(p1.items[1].flags).toEqual([]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await json<{ items: any[]; nextCursor: string | null }>(
      await call(s, w.id('T'), 'GET', `/api/sessions?childId=${w.id('C1')}&cursor=${encodeURIComponent(p1.nextCursor!)}`),
    );
    expect(p2.items.map((i) => i.id)).toEqual([w.id('s20'), w.id('s21'), w.id('s22')]);
    expect(p2.nextCursor).toBeNull();
    for (const u of ['OUT', 'T2', 'ADB', 'PH']) expect((await call(s, w.id(u), 'GET', `/api/sessions?childId=${w.id('C1')}`)).status, u).toBe(403);
    expect(await errCode(await call(s, w.id('P'), 'GET', '/api/sessions'))).toBe('INVALID');
    expect(await errCode(await call(s, w.id('P'), 'GET', `/api/sessions?childId=${w.id('C1')}&cursor=garbage!`))).toBe('INVALID');
  });

  it("each session says which parent's avatar was there: Mia with Daddy's avatar, viewed by Mom, shows Daddy", async () => {
    const w = await world('seDad_');
    const s = setup();
    await seedRows(env, {
      // Dad (P2) has an approved "Daddy" avatar and no comfort plan for Mia; Mom (P) has her "Mommy" avatar and plan.
      avatar: [{ id: w.id('avD'), user_id: w.id('P2'), status: 'approved', napster_agent_id: 'agD', parent_title: 'Daddy', created_at: NOW }],
      comfort_session: [
        { id: w.id('sD'), child_id: w.id('C1'), avatar_id: w.id('avD'), caregiver_user_id: w.id('T'), org_id: w.id('A'), reason: 'missing_parent', started_at: NOW - 60_000, ended_at: NOW - 30_000, status: 'closed', kind: 'child' },
        { id: w.id('sM'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'), reason: 'upset_nap', started_at: NOW - 120_000, ended_at: NOW - 90_000, status: 'closed', kind: 'child' },
      ],
    });
    const list = await json<{ items: { id: string; parentTitle: string }[] }>(await call(s, w.id('P'), 'GET', `/api/sessions?childId=${w.id('C1')}`));
    expect(list.items.map((i) => [i.id, i.parentTitle])).toEqual([[w.id('sD'), 'Daddy'], [w.id('sM'), 'Mommy']]);
    expect((await json(await call(s, w.id('P'), 'GET', `/api/sessions/${w.id('sD')}`))).parentTitle).toBe('Daddy');
    // A plan title for (Mia, Dad's avatar) wins over the avatar's own title.
    await seedRows(env, { comfort_plan: [{ child_id: w.id('C1'), avatar_id: w.id('avD'), parent_title: 'Papa', tone: 'calm' }] });
    expect((await json(await call(s, w.id('P'), 'GET', `/api/sessions/${w.id('sD')}`))).parentTitle).toBe('Papa');
  });

  it('an acting tablet lists only the acting org sessions (no home or other-org sessions)', async () => {
    const w = await world('seLa_');
    const s = setup();
    // T also home-cares for C1; C1 additionally has a daycare connection to org B.
    await seedRows(env, {
      connection: [
        { id: w.id('cnTH'), child_id: w.id('C1'), kind: 'home', caregiver_user_id: w.id('T'), transcript_access: 0 },
        { id: w.id('cnB1'), child_id: w.id('C1'), kind: 'daycare', org_id: w.id('B'), transcript_access: 0 },
      ],
      comfort_session: ([['org', w.id('A'), 3], ['home', null, 2], ['orgB', w.id('B'), 1]] as const).map(([tag, org, ago]) => ({
        id: w.id(tag), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: org,
        reason: 'upset_nap', started_at: NOW - ago * 60_000, ended_at: NOW, status: 'closed', kind: 'child',
      })),
    });
    const token = await w.actingFor(w.id('T'));
    const acting = await json<{ items: { id: string }[] }>(
      await call(s, w.id('TAB'), 'GET', `/api/sessions?childId=${w.id('C1')}`, undefined, { 'X-Acting-Token': token }),
    );
    expect(acting.items.map((i) => i.id)).toEqual([w.id('org')]);
    // Signed in as themselves, T sees all three.
    const own = await json<{ items: { id: string }[] }>(await call(s, w.id('T'), 'GET', `/api/sessions?childId=${w.id('C1')}`));
    expect(own.items.map((i) => i.id)).toEqual([w.id('orgB'), w.id('home'), w.id('org')]);
  });

  it('a teacher without transcript access gets no transcript field; a parent does; outsiders 404', async () => {
    const w = await world('seG_');
    const s = setup();
    const transcript = [{ role: 'User', text: 'hi', timestamp: '2026-11-18T00:00:00Z' }];
    await seedRows(env, {
      comfort_session: [{
        id: w.id('s'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'), reason: 'boo_boo',
        started_at: NOW - 1000, ended_at: NOW, duration_s: 1, status: 'closed', kind: 'child', transcript_json: JSON.stringify(transcript),
      }],
    });
    const t = await json(await call(s, w.id('T'), 'GET', `/api/sessions/${w.id('s')}`));
    expect(t).toMatchObject({ id: w.id('s'), child: { id: w.id('C1'), name: 'Mia' }, reason: 'boo_boo' });
    expect(t).not.toHaveProperty('transcript');
    const p = await json(await call(s, w.id('P'), 'GET', `/api/sessions/${w.id('s')}`));
    const asMs = [{ role: 'User', text: 'hi', timestamp: Date.UTC(2026, 10, 18) }];
    expect(p.transcript).toEqual(asMs);
    await env.DB.prepare('UPDATE connection SET transcript_access = 1 WHERE id = ?').bind(w.id('cn1')).run();
    expect((await json(await call(s, w.id('T'), 'GET', `/api/sessions/${w.id('s')}`))).transcript).toEqual(asMs);
    for (const u of ['OUT', 'ADB', 'PH']) expect((await call(s, w.id(u), 'GET', `/api/sessions/${w.id('s')}`)).status, u).toBe(404);
  });

  it('the detail carries the caregiver note, and the transcript drops System lines', async () => {
    const w = await world('sdn_');
    const s = setup();
    const lines = [
      { role: 'System', text: 'session started', timestamp: '2026-11-18T00:00:00Z' },
      { role: 'Assistant', text: 'hello', timestamp: '2026-11-18T00:00:01Z' },
      { role: 'User', text: 'hi', timestamp: '2026-11-18T00:00:02Z' },
      { role: 'System', text: 'tool call', timestamp: '2026-11-18T00:00:03Z' },
    ];
    await seedRows(env, {
      comfort_session: [{
        id: w.id('s'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'), reason: 'boo_boo',
        started_at: NOW - 1000, ended_at: NOW, duration_s: 1, status: 'closed', kind: 'child', caregiver_note: 'ate a good snack', transcript_json: JSON.stringify(lines),
      }],
    });
    const t = await json(await call(s, w.id('T'), 'GET', `/api/sessions/${w.id('s')}`));
    expect(t.caregiverNote).toBe('ate a good snack'); // no transcript access, still gets the note
    expect(t).not.toHaveProperty('transcript');
    const p = await json(await call(s, w.id('P'), 'GET', `/api/sessions/${w.id('s')}`));
    expect(p.caregiverNote).toBe('ate a good snack');
    expect(p.transcript.map((l: { role: string }) => l.role)).toEqual(['Assistant', 'User']);
  });

  it('the detail gives transcript times in epoch ms: unix seconds (rows stored before the fix) and ISO both (P-2)', async () => {
    const w = await world('sdts_');
    const s = setup();
    const lines = [
      { role: 'Assistant', text: 'Hello, sweet pea.', timestamp: 1795135636 },
      { role: 'User', text: 'hi', timestamp: '2026-11-18T00:00:02Z' },
      { role: 'User', text: 'no time' },
    ];
    await seedRows(env, {
      comfort_session: [{
        id: w.id('s'), child_id: w.id('C1'), avatar_id: w.id('av1'), caregiver_user_id: w.id('T'), org_id: w.id('A'), reason: 'boo_boo',
        started_at: NOW - 1000, ended_at: NOW, duration_s: 1, status: 'closed', kind: 'child', transcript_json: JSON.stringify(lines),
      }],
    });
    const p = await json(await call(s, w.id('P'), 'GET', `/api/sessions/${w.id('s')}`));
    expect(p.transcript).toEqual([
      { role: 'Assistant', text: 'Hello, sweet pea.', timestamp: 1795135636_000 },
      { role: 'User', text: 'hi', timestamp: Date.UTC(2026, 10, 18, 0, 0, 2) },
      { role: 'User', text: 'no time', timestamp: null },
    ]);
  });

  it('an acting teacher cannot read their home child history from the tablet', async () => {
    const w = await world('seGa_');
    const s = setup();
    const { sessionId } = await started(s, w.id('T'), startBody(w, 'CH', 'avH'));
    const token = await w.actingFor(w.id('T'));
    const h = { 'X-Acting-Token': token };
    expect((await call(s, w.id('TAB'), 'GET', `/api/sessions/${sessionId}`, undefined, h)).status).toBe(404);
    expect((await call(s, w.id('TAB'), 'GET', `/api/sessions?childId=${w.id('CH')}`, undefined, h)).status).toBe(403);
    expect((await call(s, w.id('T'), 'GET', `/api/sessions/${sessionId}`)).status).toBe(200);
  });
});
