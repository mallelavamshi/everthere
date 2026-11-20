import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createApp } from '../src/index';
import type { Env } from '../src/env';
import { NapsterError } from '../src/napster/client';
import { agentProviderSettings, companionReadiness } from '../src/services/avatars';
import { makeMediaKey } from '../src/lib/mediaKeys';
import { testClientId } from '../src/lib/clientIds';
import { testVerify, testFetchProfile, authAs, seedRows } from './helpers';

const NOW = Date.now();
const u = (id: string, name: string) => ({ id, name, email: `${id}@x`, created_at: NOW });
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;

type Fake = ReturnType<typeof fake>;
function fake(over: { agent?: () => Promise<{ id: string }>; companion?: () => Promise<Record<string, unknown>>; conn?: () => Promise<{ token: string; connectionId: string }> } = {}) {
  let n = 0;
  return {
    createCompanion: vi.fn(async (_b: unknown) => ({ id: `comp${++n}` })),
    getCompanion: vi.fn(over.companion ?? (async () => ({ id: 'comp1', status: 'readyToUse' }))),
    createAgent: vi.fn(over.agent ?? (async (_b: unknown) => ({ id: 'agent1' }))),
    patchAgent: vi.fn(async (_id: string, _p: unknown) => undefined),
    deleteAgent: vi.fn(async (_id: string) => undefined),
    deleteCompanion: vi.fn(async (_id: string) => undefined),
    createConnection: vi.fn(over.conn ?? (async () => ({ token: 'tok', connectionId: 'conn1' }))),
  };
}
function setup(f: Fake = fake(), vars: Partial<Env> = { NAPSTER_FLAG_FUNCTION_ID: 'fn1' }) {
  const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: f as never });
  const e = { ...env, ...vars } as Env;
  return { f, e, request: (p: string, init?: RequestInit) => app.request(p, init, e) };
}
const json = (user: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { ...authAs(user), 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const body = (user: string, over: Record<string, unknown> = {}) => ({
  photoKey: makeMediaKey('avatar', user, 'image/jpeg'),
  voiceId: 'coral',
  consentName: 'Pat Doe',
  consentAccepted: true,
  parentTitle: 'Mommy',
  ...over,
});
async function create(s: ReturnType<typeof setup>, user: string, over: Record<string, unknown> = {}) {
  const res = await s.request('/api/avatars', json(user, 'POST', body(user, over)));
  return { res, avatar: (await res.json()) as { id: string; status: string; approvedAt: number | null } };
}
async function ready(s: ReturnType<typeof setup>, user: string) {
  const { avatar } = await create(s, user);
  await s.request(`/api/avatars/${avatar.id}`, { headers: authAs(user) });
  return avatar.id;
}
const row = (id: string) => env.DB.prepare('SELECT * FROM avatar WHERE id=?').bind(id).first<Record<string, unknown>>();

describe('companionReadiness (statuses observed on the device spike)', () => {
  it('pending and generationCompleted are still creating (previewUrl fills while pending)', () => {
    expect(companionReadiness({ status: 'pending', previewUrl: 'https://x/p.jpg', versions: [] })).toBe('creating');
    expect(companionReadiness({ status: 'generationCompleted', videoLoopUrl: 'https://x/v.mp4', versions: ['v1'] })).toBe('creating');
  });
  it('readyToUse is ready, and so is a stock companion status completed', () => {
    expect(companionReadiness({ status: 'readyToUse', versions: ['v1'] })).toBe('ready');
    expect(companionReadiness({ status: 'completed' })).toBe('ready');
  });
  it('failure wins; fail/error statuses are failed', () => {
    expect(companionReadiness({ status: 'Failed' })).toBe('failed');
    expect(companionReadiness({ status: 'generationFailed' })).toBe('failed');
    expect(companionReadiness({ status: 'readyToUse', generationStatus: 'failed' })).toBe('failed');
  });
  it('unknown, missing or malformed input stays creating', () => {
    expect(companionReadiness({ status: 'processing', avatarUrl: 'https://x' })).toBe('creating');
    expect(companionReadiness({ previewUrl: 'https://x/p.jpg' })).toBe('creating');
    expect(companionReadiness({ status: 'inactive' })).toBe('creating');
    expect(companionReadiness({})).toBe('creating');
    expect(companionReadiness(null)).toBe('creating');
    expect(companionReadiness('x')).toBe('creating');
  });
});

describe('avatars', () => {
  it('create -> creating, with persona companion, signed picture url, consent stored', async () => {
    const s = setup();
    await seedRows(env, { user: [u('a1', 'Pat Doe')] });
    const { res, avatar } = await create(s, 'a1');
    expect(res.status).toBe(200);
    expect(avatar.status).toBe('creating');
    const arg = s.f.createCompanion.mock.calls[0]![0] as { pictureUrl: string; description: string; firstName: string; version: string };
    expect(arg.version).toBe('v1');
    expect(arg.pictureUrl).toContain('/m/avatar');
    expect(arg.firstName).toBe('Pat');
    expect(arg.description).toContain('Mommy');
    const r = (await row(avatar.id))!;
    expect(r).toMatchObject({ user_id: 'a1', napster_companion_id: 'comp1', voice_id: 'coral', consent_name: 'Pat Doe', parent_title: 'Mommy' });
    expect(r.consent_at).toBeGreaterThan(0);
  });

  it('consent is required; bad voice, foreign photoKey, bad title -> INVALID', async () => {
    const s = setup();
    await seedRows(env, { user: [u('a2', 'X')] });
    for (const over of [
      { consentAccepted: false },
      { consentAccepted: undefined },
      { consentName: '  ' },
      { voiceId: 'nope' },
      { photoKey: makeMediaKey('avatar', 'someone-else', 'image/png') },
      { photoKey: makeMediaKey('child', 'a2', 'image/png') },
      { parentTitle: '' },
      { parentTitle: 'x'.repeat(21) },
    ]) {
      const { res, avatar: err } = await create(s, 'a2', over);
      expect([res.status, (err as unknown as { error: { code: string } }).error.code], JSON.stringify(over)).toEqual([400, 'INVALID']);
    }
    expect(s.f.createCompanion).not.toHaveBeenCalled();
  });

  it('poll with ready companion creates the agent once -> ready', async () => {
    const s = setup();
    await seedRows(env, { user: [u('a3', 'Pat Doe')] });
    const { avatar } = await create(s, 'a3');
    const g = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a3') });
    expect(((await g.json()) as { status: string }).status).toBe('ready');
    const a = s.f.createAgent.mock.calls[0]![0] as Record<string, any>;
    expect(a.companionId).toBe('comp1');
    expect(a.name).toBe(`everthere-${avatar.id}-omp1`.replace('-omp1', '-comp1'));
    expect(a.functions).toEqual(['fn1']);
    expect(a.voiceId).toBe('coral');
    expect(a.language).toBe('en');
    expect(a.mode).toBe('conversation');
    expect(a.providerSettings.temperature).toBe(0.6);
    expect(a.providerSettings.instructions).toContain('flag_concern');
    expect(a.providerSettings.instructions).toContain("Pat's");
    // Device test P-4: a phone or tablet on a classroom table hears the room: far-field noise reduction. No
    // turnDetection override (fix round 1): Napster's defaults apply, so a child's mid-sentence pause isn't cut off.
    expect(a.providerSettings.noiseReduction).toEqual({ type: 'farField' });
    expect(a.providerSettings).not.toHaveProperty('turnDetection');
    expect(a.providerSettings).toEqual(agentProviderSettings(a.providerSettings.instructions));
    expect((await row(avatar.id))!.napster_agent_id).toBe('agent1');
    await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a3') });
    expect(s.f.createAgent).toHaveBeenCalledTimes(1);
  });

  it('an avatar without a voice is not given an agent: Napster is not called, error is logged', async () => {
    const s = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRows(env, { user: [u('a3v', 'Pat Doe')] });
    const { avatar } = await create(s, 'a3v');
    await env.DB.prepare('UPDATE avatar SET voice_id = NULL WHERE id = ?').bind(avatar.id).run();
    const g = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a3v') });
    expect(((await g.json()) as { status: string }).status).toBe('creating');
    expect(s.f.createAgent).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).toMatch(/voice/i);
    err.mockRestore();
  });

  it("a digital twin's own cloned voice (custom:<id>) is never sent as a stock voiceId: the agent gets no voiceId", async () => {
    const s = setup();
    await seedRows(env, { user: [u('a3c', 'Pat Doe')] });
    const { avatar } = await create(s, 'a3c');
    await env.DB.prepare('UPDATE avatar SET voice_id = ? WHERE id = ?').bind('custom:5edcdc24-1ebc', avatar.id).run();
    const g = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a3c') });
    expect(((await g.json()) as { status: string }).status).toBe('ready');
    const a = s.f.createAgent.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).not.toHaveProperty('voiceId');
    expect((await row(avatar.id))!.napster_agent_id).toBe('agent1');
  });

  it('empty flag function id -> functions [] and a warning, not a failure', async () => {
    const s = setup(fake(), { NAPSTER_FLAG_FUNCTION_ID: '' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedRows(env, { user: [u('a4', 'Pat')] });
    const id = await ready(s, 'a4');
    expect((s.f.createAgent.mock.calls[0]![0] as { functions: string[] }).functions).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect((await row(id))!.status).toBe('ready');
    warn.mockRestore();
  });

  it('still-generating companion stays creating; failed companion -> failed', async () => {
    const s = setup(fake({ companion: async () => ({ id: 'c', status: 'processing' }) }));
    await seedRows(env, { user: [u('a5', 'P'), u('a6', 'P')] });
    const { avatar } = await create(s, 'a5');
    const g = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a5') });
    expect(((await g.json()) as { status: string }).status).toBe('creating');
    expect(s.f.createAgent).not.toHaveBeenCalled();
    const s2 = setup(fake({ companion: async () => ({ id: 'c', status: 'failed' }) }));
    const b = await create(s2, 'a6');
    const g2 = await s2.request(`/api/avatars/${b.avatar.id}`, { headers: authAs('a6') });
    expect(((await g2.json()) as { status: string }).status).toBe('failed');
  });

  it('creating for over 30 minutes -> failed', async () => {
    const s = setup(fake({ companion: async () => ({ id: 'c', status: 'processing' }) }));
    await seedRows(env, { user: [u('a7', 'P')] });
    const { avatar } = await create(s, 'a7');
    await env.DB.prepare('UPDATE avatar SET created_at=? WHERE id=?').bind(Date.now() - 31 * 60_000, avatar.id).run();
    const g = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a7') });
    expect(((await g.json()) as { status: string }).status).toBe('failed');
  });

  it('approve: creating -> INVALID; ready -> approved with approved_at', async () => {
    const s = setup();
    await seedRows(env, { user: [u('a8', 'P')] });
    const { avatar } = await create(s, 'a8');
    const bad = await s.request(`/api/avatars/${avatar.id}/approve`, json('a8', 'POST'));
    expect(bad.status).toBe(400);
    expect(await errCode(bad)).toBe('INVALID');
    await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('a8') });
    const ok = await s.request(`/api/avatars/${avatar.id}/approve`, json('a8', 'POST'));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe('approved');
    expect((await row(avatar.id))!.approved_at).toBeGreaterThan(0);
  });

  it('changing the photo after approval resets to creating and clears approved_at + agent; old photo deleted', async () => {
    const s = setup();
    await seedRows(env, { user: [u('a9', 'P')] });
    const id = await ready(s, 'a9');
    await s.request(`/api/avatars/${id}/approve`, json('a9', 'POST'));
    const old = (await row(id))!.photo_key as string;
    await env.MEDIA.put(old, new Uint8Array([1]));
    const nk = makeMediaKey('avatar', 'a9', 'image/png');
    const res = await s.request(`/api/avatars/${id}`, json('a9', 'PATCH', { photoKey: nk, consentName: 'New Name', consentAccepted: true }));
    expect(res.status).toBe(200);
    const r = (await row(id))!;
    expect(r).toMatchObject({ status: 'creating', approved_at: null, napster_agent_id: null, photo_key: nk, napster_companion_id: 'comp2' });
    expect(await env.MEDIA.get(old)).toBeNull();
    expect(r).toMatchObject({ consent_name: 'New Name' });
    expect(s.f.deleteAgent).toHaveBeenCalledWith('agent1');
    expect(s.f.deleteCompanion).toHaveBeenCalledWith('comp1');
    const bad = await s.request(`/api/avatars/${id}`, json('a9', 'PATCH', { photoKey: makeMediaKey('avatar', 'zzz', 'image/png'), consentName: 'N', consentAccepted: true }));
    expect(bad.status).toBe(400);
  });

  it('changing the voice patches the agent, stays ready, clears approval', async () => {
    const s = setup();
    await seedRows(env, { user: [u('b1', 'P')] });
    const id = await ready(s, 'b1');
    await s.request(`/api/avatars/${id}/approve`, json('b1', 'POST'));
    const res = await s.request(`/api/avatars/${id}`, json('b1', 'PATCH', { voiceId: 'sage' }));
    expect(res.status).toBe(200);
    expect(s.f.patchAgent).toHaveBeenCalledWith('agent1', { voiceId: 'sage' });
    expect(await row(id)).toMatchObject({ status: 'ready', approved_at: null, voice_id: 'sage' });
    const bad = await s.request(`/api/avatars/${id}`, json('b1', 'PATCH', { voiceId: 'nope' }));
    expect(await errCode(bad)).toBe('INVALID');
  });

  it('voice change while creating just stores it', async () => {
    const s = setup(fake({ companion: async () => ({ id: 'c', status: 'processing' }) }));
    await seedRows(env, { user: [u('b2', 'P')] });
    const { avatar } = await create(s, 'b2');
    await s.request(`/api/avatars/${avatar.id}`, json('b2', 'PATCH', { voiceId: 'ash' }));
    expect(s.f.patchAgent).not.toHaveBeenCalled();
    expect(await row(avatar.id)).toMatchObject({ status: 'creating', voice_id: 'ash' });
  });

  it("another user's avatar is NOT_FOUND on every route; /mine lists only own", async () => {
    const s = setup();
    await seedRows(env, { user: [u('b3', 'P'), u('b4', 'Q')] });
    const id = await ready(s, 'b3');
    for (const [m, p] of [['GET', ''], ['PATCH', ''], ['POST', '/approve'], ['POST', '/test-session']] as const) {
      const res = await s.request(`/api/avatars/${id}${p}`, json('b4', m, m === 'PATCH' ? { voiceId: 'ash' } : undefined));
      expect(res.status, `${m} ${p}`).toBe(404);
      expect(await errCode(res)).toBe('NOT_FOUND');
    }
    const mine = (await (await s.request('/api/avatars/mine', { headers: authAs('b4') })).json()) as unknown[];
    expect(mine).toEqual([]);
    const mine3 = (await (await s.request('/api/avatars/mine', { headers: authAs('b3') })).json()) as { id: string }[];
    expect(mine3.map((a) => a.id)).toEqual([id]);
  });

  it('test-session: creating -> INVALID', async () => {
    const s = setup(fake({ companion: async () => ({ id: 'c', status: 'processing' }) }));
    await seedRows(env, { user: [u('b5', 'P')] });
    const { avatar } = await create(s, 'b5');
    const res = await s.request(`/api/avatars/${avatar.id}/test-session`, json('b5', 'POST'));
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('INVALID');
  });

  it('test-session on a ready avatar returns token and records a test comfort_session', async () => {
    const s = setup();
    await seedRows(env, { user: [u('b6', 'P')] });
    const id = await ready(s, 'b6');
    const res = await s.request(`/api/avatars/${id}/test-session`, json('b6', 'POST'));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { sessionId: string; token: string };
    expect(out.token).toBe('tok');
    const [agentId, opts] = s.f.createConnection.mock.calls[0] as unknown as [string, Record<string, any>];
    expect(agentId).toBe('agent1');
    expect(opts).toMatchObject({ channelType: 'webrtc', externalClientId: await testClientId(id) });
    expect(opts.externalClientId).toMatch(/^t_[A-Za-z0-9_-]{30}$/);
    expect(opts.initialSpeech).toMatch(/^Hi! This is a test call/);
    expect(opts.tags).toEqual({ kind: 'test', avatarId: id });
    const sess = await env.DB.prepare('SELECT * FROM comfort_session WHERE id=?').bind(out.sessionId).first<Record<string, unknown>>();
    expect(sess).toMatchObject({ kind: 'test', avatar_id: id, caregiver_user_id: 'b6', child_id: null, napster_session_id: 'conn1' });
  });

  it('test-session: Napster BUSY -> AVATARS_BUSY 503 and no dangling session row', async () => {
    const s = setup(fake({ conn: async () => { throw new NapsterError(409, 'BUSY'); } }));
    await seedRows(env, { user: [u('b7', 'P')] });
    const id = await ready(s, 'b7');
    const res = await s.request(`/api/avatars/${id}/test-session`, json('b7', 'POST'));
    expect(res.status).toBe(503);
    expect(await errCode(res)).toBe('AVATARS_BUSY');
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM comfort_session WHERE avatar_id=?').bind(id).first<{ n: number }>();
    expect(c!.n).toBe(0);
  });
  it('photo change requires fresh consent', async () => {
    const s = setup();
    await seedRows(env, { user: [u('c1', 'P')] });
    const id = await ready(s, 'c1');
    const nk = makeMediaKey('avatar', 'c1', 'image/png');
    for (const extra of [{}, { consentName: 'N' }, { consentAccepted: true }, { consentName: 'N', consentAccepted: false }]) {
      const res = await s.request(`/api/avatars/${id}`, json('c1', 'PATCH', { photoKey: nk, ...extra }));
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(s.f.createCompanion).toHaveBeenCalledTimes(1);
    const ok = await s.request(`/api/avatars/${id}`, json('c1', 'PATCH', { photoKey: nk, consentName: 'Fresh', consentAccepted: true }));
    expect(ok.status).toBe(200);
    expect(await row(id)).toMatchObject({ consent_name: 'Fresh' });
  });

  it('companion ready but createAgent always failing: stays creating, then failed after 30 minutes', async () => {
    const s = setup(fake({ agent: async () => { throw new Error('boom'); } }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRows(env, { user: [u('c2', 'P')] });
    const { avatar } = await create(s, 'c2');
    const g1 = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('c2') });
    expect(((await g1.json()) as { status: string }).status).toBe('creating');
    await env.DB.prepare('UPDATE avatar SET created_at=? WHERE id=?').bind(Date.now() - 31 * 60_000, avatar.id).run();
    const g2 = await s.request(`/api/avatars/${avatar.id}`, { headers: authAs('c2') });
    expect(((await g2.json()) as { status: string }).status).toBe('failed');
    err.mockRestore();
  });

  it('voice changed while the agent was being created: patched to the current voice', async () => {
    const f = fake();
    f.createAgent.mockImplementation(async () => {
      await env.DB.prepare("UPDATE avatar SET voice_id='sage' WHERE user_id='c3'").run();
      return { id: 'agent1' };
    });
    const s = setup(f);
    await seedRows(env, { user: [u('c3', 'P')] });
    const id = await ready(s, 'c3');
    expect(f.patchAgent).toHaveBeenCalledWith('agent1', { voiceId: 'sage' });
    expect(await row(id)).toMatchObject({ status: 'ready', napster_agent_id: 'agent1', voice_id: 'sage' });
    expect(f.deleteAgent).not.toHaveBeenCalled();
  });

  it('lost createAgent race deletes the losing agent', async () => {
    const f = fake();
    f.createAgent.mockImplementation(async () => {
      await env.DB.prepare("UPDATE avatar SET status='failed' WHERE user_id='c4'").run();
      return { id: 'agent9' };
    });
    const s = setup(f);
    await seedRows(env, { user: [u('c4', 'P')] });
    const id = await ready(s, 'c4');
    expect(f.deleteAgent).toHaveBeenCalledWith('agent9');
    expect((await row(id))!.napster_agent_id).toBeNull();
  });
});
