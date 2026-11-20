import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { createApp } from '../src/index';
import type { Env } from '../src/env';
import { verifyNapsterSignature } from '../src/routes/webhooks';
import { testVerify, testFetchProfile } from './helpers';
import { GOOD_SUMMARY, alertsFor, all, fakeMeta, fakeNapster, sessionRow, spent, world, type FakeNapster } from './finalizeWorld';

// A base64 secret, as the Napster dashboard shows it.
const SECRET = btoa('napster-webhook-signing-secret-bytes');

/** Independent HMAC (not the code under test): hex HMAC-SHA256 of `body` under raw key bytes. */
async function sign(keyBytes: Uint8Array, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64Bytes = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

afterEach(async () => {
  await env.DB.prepare('UPDATE credit_guard SET spent_usd = 0 WHERE id = 1').run();
});

function setup(n: FakeNapster = fakeNapster(), meta = fakeMeta(), DB: D1Database = env.DB) {
  const app = createApp({ verify: testVerify, fetchProfile: testFetchProfile, napster: n as never, meta });
  const e = { ...(env as Env), DB, NAPSTER_WEBHOOK_SECRET: SECRET } as Env;
  const post = async (body: string, sig?: string | null, ctx?: ExecutionContext) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const s = sig === undefined ? await sign(b64Bytes(SECRET), body) : sig;
    if (s !== null) headers['X-Webhook-Signature'] = s;
    const req = new Request('http://x/api/webhooks/napster', { method: 'POST', headers, body });
    return ctx ? app.fetch(req, e, ctx) : app.request(req, undefined, e);
  };
  return { n, meta, post, e };
}

const envelope = (eventId: string, eventType: string, session?: Record<string, unknown>) =>
  JSON.stringify({
    eventId,
    eventType,
    timestamp: new Date().toISOString(),
    organizationId: 'org',
    projectId: 'proj',
    data: session ? { session } : {},
  });
const closed = (eventId: string, napsterId: string) =>
  envelope(eventId, 'session.closed', {
    id: napsterId, type: 'webrtc', companionId: 'comp', externalClientId: 'x',
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), closedAt: new Date().toISOString(), reason: 'client',
  });
const eventRow = (id: string) => env.DB.prepare('SELECT * FROM webhook_event WHERE event_id = ?').bind(id).first();

describe('verifyNapsterSignature', () => {
  it('accepts the base64-decoded key and the raw UTF-8 key; rejects others', async () => {
    const body = '{"a":1}';
    expect(await verifyNapsterSignature(SECRET, body, await sign(b64Bytes(SECRET), body))).toBe(true);
    expect(await verifyNapsterSignature(SECRET, body, await sign(new TextEncoder().encode(SECRET), body))).toBe(true);
    expect(await verifyNapsterSignature(SECRET, body, (await sign(b64Bytes(SECRET), body)).toUpperCase())).toBe(true);
    expect(await verifyNapsterSignature(SECRET, body, await sign(new TextEncoder().encode('other'), body))).toBe(false);
    expect(await verifyNapsterSignature(SECRET, body + ' ', await sign(b64Bytes(SECRET), body))).toBe(false);
    expect(await verifyNapsterSignature(SECRET, body, null)).toBe(false);
    expect(await verifyNapsterSignature('', body, '0'.repeat(64))).toBe(false);
    expect(await verifyNapsterSignature(undefined, body, '0'.repeat(64))).toBe(false);
  });
});

describe('POST /api/webhooks/napster', () => {
  it('bad or missing signature → 401 UNAUTHENTICATED, nothing recorded', async () => {
    const { post, n } = setup();
    for (const sig of ['deadbeef', null]) {
      const res = await post(closed('wh_bad', 'nope'), sig);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    }
    expect(await eventRow('wh_bad')).toBeNull();
    expect(n.getSession).not.toHaveBeenCalled();
  });

  it('valid signature over invalid JSON → 400', async () => {
    const { post } = setup();
    const res = await post('{not json');
    expect(res.status).toBe(400);
  });

  it('session.started, companion.* and unknown events are recorded and acknowledged', async () => {
    const { post, n } = setup();
    for (const [id, type] of [['wh_st', 'session.started'], ['wh_cu', 'companion.updated'], ['wh_xx', 'something.new']] as const) {
      const res = await post(envelope(id, type, { id: 'whatever' }));
      expect(res.status).toBe(200);
      expect(await eventRow(id)).not.toBeNull();
    }
    expect(n.getSession).not.toHaveBeenCalled();
  });

  it('unknown session → 200, no rows touched', async () => {
    const { post, n } = setup();
    const before = (await all('SELECT COUNT(*) AS c FROM alert'))[0]!.c;
    const res = await post(closed('wh_unknown', 'no-such-connection'));
    expect(res.status).toBe(200);
    expect(n.getSession).not.toHaveBeenCalled();
    expect((await all('SELECT COUNT(*) AS c FROM alert'))[0]!.c).toBe(before);
    expect(await all("SELECT * FROM comfort_session WHERE napster_session_id = 'no-such-connection'")).toEqual([]);
  });

  it('session.closed finalizes a child session: transcript, cost, summary, parents alerted', async () => {
    const { id } = await world('wa');
    const { post, n } = setup();
    const res = await post(closed('wh_a1', id('conn')));
    expect(res.status).toBe(200);
    expect(n.getSession).toHaveBeenCalledWith(id('conn'));
    const s = (await sessionRow(id('s')))!;
    expect(s.cost_usd).toBeCloseTo(0.42);
    expect(JSON.parse(s.transcript_json)).toHaveLength(4);
    expect(s.summary).toBe(GOOD_SUMMARY.summary);
    expect(s.mood_signal).toBe('better');
    expect(s.ended_at).not.toBeNull();
    expect(s.status).toBe('closed');
    expect(await spent()).toBeCloseTo(0.42);
    const alerts = (await alertsFor(id('s'))).filter((a) => a.kind === 'summary');
    expect(alerts.map((a) => a.user_id)).toEqual([id('P'), id('P2')]);
    expect(alerts[0]!.title).toBe("💛 Mia's comfort session");
    expect(alerts[0]!.body).toBe(GOOD_SUMMARY.summary);
  });

  it('duplicate eventId → one alert set, one cost record (Review Focus 5)', async () => {
    const { id } = await world('wd');
    const { post, n } = setup();
    const body = closed('wh_dup', id('conn'));
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(n.getSession).toHaveBeenCalledTimes(1);
    expect((await alertsFor(id('s'))).filter((a) => a.kind === 'summary')).toHaveLength(2);
    expect(await spent()).toBeCloseTo(0.42);
  });

  it('a different eventId for the same session does not double-count or re-alert', async () => {
    const { id } = await world('wr');
    const { post } = setup();
    await post(closed('wh_r1', id('conn')));
    await post(closed('wh_r2', id('conn')));
    expect((await alertsFor(id('s'))).filter((a) => a.kind === 'summary')).toHaveLength(2);
    expect(await spent()).toBeCloseTo(0.42);
  });

  it('test session → only the owner is alerted; no flags, no admin alerts', async () => {
    const { id } = await world('wt');
    const meta = fakeMeta({ ...GOOD_SUMMARY, flags: [{ category: 'injury', quote: 'ouch', severity: 'high' }] });
    const { post } = setup(fakeNapster(), meta);
    expect((await post(closed('wh_t1', id('tconn')))).status).toBe(200);
    const s = (await sessionRow(id('st')))!;
    expect(s.summary).toBe(GOOD_SUMMARY.summary);
    expect(s.cost_usd).toBeCloseTo(0.42);
    expect(await spent()).toBeCloseTo(0.42);
    const alerts = await alertsFor(id('st'));
    expect(alerts.map((a) => [a.user_id, a.kind, a.title])).toEqual([[id('P'), 'summary', 'Your test call is ready to review']]);
    expect(await all('SELECT * FROM session_flag WHERE session_id = ?', id('st'))).toEqual([]);
    expect(await all('SELECT * FROM alert WHERE user_id = ?', id('AD'))).toEqual([]);
  });

  it('if marking the session ended fails, nothing is recorded and a retry with the same eventId is processed', async () => {
    const { id } = await world('wf');
    let failures = 1;
    const real = env.DB;
    const DB = new Proxy(real, {
      get(t, p) {
        if (p === 'prepare') return (sql: string) => {
          if (sql.includes('COALESCE(ended_at, ?)') && failures-- > 0) throw new Error('db hiccup');
          return t.prepare(sql);
        };
        const v = Reflect.get(t, p);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const { post, n } = setup(fakeNapster(), fakeMeta(), DB);
    const body = closed('wh_f1', id('conn'));
    expect((await post(body)).status).toBe(500);
    expect(await eventRow('wh_f1')).toBeNull();
    expect((await post(body)).status).toBe(200);
    expect(await eventRow('wh_f1')).not.toBeNull();
    expect(n.getSession).toHaveBeenCalledTimes(1);
    expect((await sessionRow(id('s')))!.summary).toBe(GOOD_SUMMARY.summary);
  });

  it('a failed session is recorded and acknowledged but never finalized or alerted', async () => {
    const { id } = await world('wx', { s: { status: 'failed', ended_at: Date.now() - 60_000, ended_reason: 'busy' } });
    const { post, n } = setup();
    expect((await post(closed('wh_x1', id('conn')))).status).toBe(200);
    expect(await eventRow('wh_x1')).not.toBeNull();
    expect(n.getSession).not.toHaveBeenCalled();
    const s = (await sessionRow(id('s')))!;
    expect(s.summary).toBeNull();
    expect(s.status).toBe('failed');
    expect(await alertsFor(id('s'))).toEqual([]);
  });

  it('session.closed with unusable data: warns once with the eventId and the data KEYS only, records it, 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { post, n } = setup();
    const res = await post(
      JSON.stringify({ eventId: 'wh_bad_data', eventType: 'session.closed', data: { secretish: 'payload-xyz', session: { other: 'v-hidden' } } }),
    );
    expect(res.status).toBe(200);
    expect(await eventRow('wh_bad_data')).not.toBeNull();
    expect(n.getSession).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('wh_bad_data');
    expect(logged).toContain('secretish');
    expect(logged).toContain('session');
    expect(logged).toContain('other');
    expect(logged).not.toContain('payload-xyz');
    expect(logged).not.toContain('v-hidden');
    warn.mockRestore();
  });

  // Napster's real session.closed body did not match data.session.id (device test, I-1): accept the other shapes too.
  const shapes: [string, (conn: string) => Record<string, unknown>][] = [
    ['data.id', (conn) => ({ id: conn, closedAt: new Date().toISOString() })],
    ['data.sessionId', (conn) => ({ sessionId: conn, status: 'closed' })],
    ['data.connectionId', (conn) => ({ connectionId: conn, closeReason: 'connection_closed' })],
    ['data.session.connectionId', (conn) => ({ session: { connectionId: conn, closedAt: Math.floor(Date.now() / 1000) } })],
  ];
  for (const [name, data] of shapes) {
    it(`session.closed with the session id in ${name} finalizes the session`, async () => {
      const p = `ws${name.replace(/\W/g, '')}`;
      const { id } = await world(p);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { post, n } = setup();
      const res = await post(JSON.stringify({ eventId: `wh_${p}`, eventType: 'session.closed', data: data(id('conn')) }));
      expect(res.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
      expect(n.getSession).toHaveBeenCalledWith(id('conn'));
      const s = (await sessionRow(id('s')))!;
      expect(s.status).toBe('closed');
      expect(s.ended_at).not.toBeNull();
      expect(s.summary).toBe(GOOD_SUMMARY.summary);
      warn.mockRestore();
    });
  }

  it('closedAt as unix seconds is used as the end time', async () => {
    const { id } = await world('wsec');
    const { post } = setup();
    const closedS = Math.floor(Date.now() / 1000) - 30;
    await post(JSON.stringify({ eventId: 'wh_wsec', eventType: 'session.closed', data: { session: { id: id('conn'), closedAt: closedS } } }));
    expect((await sessionRow(id('s')))!.ended_at).toBe(closedS * 1000);
  });

  it('responds without waiting for Meta when an ExecutionContext is available', async () => {
    const { id } = await world('wq');
    let release!: (v: string) => void;
    const meta = { chat: vi.fn(() => new Promise<string>((r) => (release = r))) };
    const { post } = setup(fakeNapster(), meta);
    const ctx = createExecutionContext();
    const res = await post(closed('wh_q1', id('conn')), undefined, ctx);
    expect(res.status).toBe(200);
    expect((await sessionRow(id('s')))!.summary).toBeNull();
    await vi.waitFor(() => expect(meta.chat).toHaveBeenCalled());
    release(JSON.stringify(GOOD_SUMMARY));
    await waitOnExecutionContext(ctx);
    expect((await sessionRow(id('s')))!.summary).toBe(GOOD_SUMMARY.summary);
  });
});
