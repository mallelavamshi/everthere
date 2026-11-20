import { describe, expect, it, vi } from 'vitest';
import { napster, NapsterError, parseRetryAfter } from '../src/napster/client';
import { agentProviderSettings } from '../src/services/avatars';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('napster client', () => {
  it('sends X-Api-Key and prefixes /public', async () => {
    const fetch = vi.fn(async () => json({ id: 'c1' }));
    const n = napster('k-123', { fetch: fetch as unknown as typeof globalThis.fetch });
    const res = await n.createCompanion({ description: 'd', firstName: 'Bee', pictureUrl: 'https://x/y.png', version: 'v1' });
    expect(res).toEqual({ id: 'c1' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://napster-api.napster.com/public/companions');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('k-123');
    expect(init.method).toBe('POST');
  });

  it('getFunction GETs and updateFunction PUTs /public/functions/{id} with the definition', async () => {
    const fetch = vi.fn(async () => json({ id: 'fn 1' }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    const def = { data: { name: 'flag_concern', description: 'd', parameters: { type: 'object' } }, flow: 'implicit' as const };
    await n.getFunction('fn 1');
    await n.updateFunction('fn 1', def);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('https://napster-api.napster.com/public/functions/fn%201');
    expect(calls[0]![1].method).toBe('GET');
    expect(calls[1]![0]).toBe('https://napster-api.napster.com/public/functions/fn%201');
    expect(calls[1]![1].method).toBe('PUT');
    expect(JSON.parse(String(calls[1]![1].body))).toEqual(def);
  });

  it('createConnection retries once on 429 honoring Retry-After, then succeeds', async () => {
    const sleeps: number[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'slow down' }, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ token: 'tok', connection: { id: 'conn1' } }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async (ms) => void sleeps.push(ms) });
    const res = await n.createConnection('a1', { channelType: 'webrtc', videoPolicy: 'deferred' });
    expect(res).toEqual({ token: 'tok', connectionId: 'conn1' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2000]);
  });

  it('createConnection gives up after 2 retries with the 429 error', async () => {
    const fetch = vi.fn(async () => json({}, 429, { 'Retry-After': '1' }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} });
    await expect(n.createConnection('a1', { channelType: 'webrtc' })).rejects.toMatchObject({ status: 429, retryAfterMs: 1000 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('maps 409 ConcurrentSessionLimitReached to BUSY', async () => {
    const fetch = vi.fn(async () => json({ code: 'ConcurrentSessionLimitReached', message: 'x' }, 409));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    const err = await n.createConnection('a1', { channelType: 'webrtc' }).catch((e) => e);
    expect(err).toBeInstanceOf(NapsterError);
    expect(err).toMatchObject({ status: 409, code: 'BUSY' });
  });

  it('getSession maps conversation.items and handles missing conversation', async () => {
    const items = [{ role: 'User', text: 'hi', timestamp: 't1' }];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 's', status: 'closed', cost: 0.4, closeReason: 'user', conversation: { items } }))
      .mockResolvedValueOnce(json({ id: 's', status: 'started', cost: null, closeReason: null }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await n.getSession('s')).toEqual({ status: 'closed', cost: 0.4, closeReason: 'user', items });
    expect(await n.getSession('s')).toEqual({ status: 'started', cost: null, closeReason: null, items: [] });
  });

  it('deleteSession issues DELETE', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await n.deleteSession('s 1');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://napster-api.napster.com/public/sessions/s%201');
    expect(init.method).toBe('DELETE');
  });

  it('non-ok responses throw NapsterError with body code', async () => {
    const fetch = vi.fn(async () => json({ code: 'InactiveSubscription' }, 403));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(n.getCompanion('c')).rejects.toMatchObject({ status: 403, code: 'InactiveSubscription' });
  });
});

describe('napster client fixes', () => {
  it('createAgent sends providerSettings as given: far-field noise reduction, no turnDetection override (P-4)', async () => {
    const fetch = vi.fn(async () => json({ id: 'agent1' }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await n.createAgent({ companionId: 'c', name: 'n', voiceId: 'v', providerSettings: agentProviderSettings('Be kind.') });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/public\/agents$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).providerSettings).toEqual({
      instructions: 'Be kind.',
      temperature: 0.6,
      noiseReduction: { type: 'farField' },
    });
    expect(JSON.parse(init.body as string).providerSettings).not.toHaveProperty('turnDetection');
  });

  it('createConnection always sends videoPolicy deferred', async () => {
    const fetch = vi.fn(async () => json({ token: 't', connection: { id: 'c' } }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await n.createConnection('a', { channelType: 'webrtc', ...({ videoPolicy: 'always' } as object) });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).videoPolicy).toBe('deferred');
  });

  it('deleteSession tolerates a 200 text/plain body', async () => {
    const fetch = vi.fn(async () => new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(n.deleteSession('s')).resolves.toBeUndefined();
  });

  it('parseRetryAfter handles seconds, HTTP-date, and clamps to 5s', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('60')).toBe(5000);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:03 GMT', now)).toBe(3000);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:10:00 GMT', now)).toBe(5000);
    expect(parseRetryAfter('garbage')).toBeUndefined();
  });
});

describe('napster client cleanup deletes', () => {
  it('deleteAgent / deleteCompanion issue DELETE', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await n.deleteAgent('a 1');
    await n.deleteCompanion('c1');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('https://napster-api.napster.com/public/agents/a%201');
    expect(calls[0]![1].method).toBe('DELETE');
    expect(calls[1]![0]).toBe('https://napster-api.napster.com/public/companions/c1');
    // Notes 6.5: 404 is NOT treated as success; real errors surface (best-effort callers catch them).
    const nf = napster('k', { fetch: (async () => json({ code: 'NotFound' }, 404)) as unknown as typeof globalThis.fetch });
    await expect(nf.deleteAgent('x')).rejects.toMatchObject({ status: 404 });
    await expect(nf.deleteCompanion('x')).rejects.toMatchObject({ status: 404 });
    const notCompleted = napster('k', {
      fetch: (async () => json([{ code: 'CompanionNotCompleted', description: 'not yet', type: 11 }], 400)) as unknown as typeof globalThis.fetch,
    });
    await expect(notCompleted.deleteCompanion('c')).rejects.toMatchObject({ status: 400, code: 'CompanionNotCompleted' });
    const boom = napster('k', { fetch: (async () => json({ code: 'X' }, 500)) as unknown as typeof globalThis.fetch });
    await expect(boom.deleteAgent('x')).rejects.toBeInstanceOf(NapsterError);
  });
});

describe('napster error bodies (device spike shapes)', () => {
  const nap = (body: unknown, status: number) => napster('k', { fetch: (async () => json(body, status)) as unknown as typeof globalThis.fetch });
  const err = (p: Promise<unknown>): Promise<any> => p.catch((e) => e);

  it('array body: code and message come from [0]', async () => {
    const e = await err(nap([{ code: 'VoiceIdRequired', description: 'voice is required', type: 11 }], 400).createAgent({ companionId: 'c', name: 'n', voiceId: 'v', providerSettings: {} }));
    expect(e).toBeInstanceOf(NapsterError);
    expect(e).toMatchObject({ status: 400, code: 'VoiceIdRequired', message: 'voice is required' });
  });

  it('object body with description (rate limit)', async () => {
    const e = await err(nap({ code: 'RequestRateLimitExceeded', description: 'slow', type: 12 }, 400).getCompanion('c'));
    expect(e).toMatchObject({ code: 'RequestRateLimitExceeded', message: 'slow' });
  });

  it('ASP.NET validation body {errors:{field:[..]}} -> VALIDATION_ERROR with the first message', async () => {
    const e = await err(nap({ errors: { tags: ['Cannot deserialize the current JSON array'] } }, 400).getCompanion('c'));
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(e.message).toContain('Cannot deserialize');
  });

  it('empty-body 500 falls back to HTTP_500', async () => {
    const n = napster('k', { fetch: (async () => new Response('', { status: 500 })) as unknown as typeof globalThis.fetch });
    expect(await err(n.getCompanion('c'))).toMatchObject({ status: 500, code: 'HTTP_500' });
  });

  it('ConcurrentSessionLimitReached -> BUSY in both the object and the array shape', async () => {
    const conn = (n: ReturnType<typeof napster>) => err(n.createConnection('a', { channelType: 'webrtc' }));
    expect(await conn(nap({ code: 'ConcurrentSessionLimitReached', description: 'x' }, 409))).toMatchObject({ code: 'BUSY' });
    expect(await conn(nap([{ code: 'ConcurrentSessionLimitReached', description: 'x', type: 11 }], 409))).toMatchObject({ code: 'BUSY' });
  });

  it('InactiveSubscription and DigitalTwinConsentRequired keep their own codes (array shape too)', async () => {
    expect(await err(nap([{ code: 'InactiveSubscription', description: 'd', type: 11 }], 403).getCompanion('c'))).toMatchObject({ code: 'InactiveSubscription' });
    expect(await err(nap([{ code: 'DigitalTwinConsentRequired', description: 'd', type: 11 }], 400).createCompanion({ description: 'd', version: 'v1' }))).toMatchObject({
      code: 'DigitalTwinConsentRequired',
    });
  });
});

describe('napster client delete semantics (notes 6.5)', () => {
  const nap = (body: unknown, status: number) => napster('k', { fetch: (async () => json(body, status)) as unknown as typeof globalThis.fetch });

  it('deleteConnection: an expired connection (400 ConnectionNotFound) counts as already gone', async () => {
    await expect(nap([{ code: 'ConnectionNotFound', description: 'gone', type: 11 }], 400).deleteConnection('c')).resolves.toBeUndefined();
  });

  it('deleteConnection: other errors, including 404 and other 400 codes, still throw', async () => {
    await expect(nap({ code: 'NotFound' }, 404).deleteConnection('c')).rejects.toMatchObject({ status: 404 });
    await expect(nap([{ code: 'Other', description: 'd', type: 11 }], 400).deleteConnection('c')).rejects.toMatchObject({ code: 'Other' });
    await expect(nap({}, 500).deleteConnection('c')).rejects.toBeInstanceOf(NapsterError);
  });

  it('deleteSession never swallows errors itself (the cascade deleter decides what is gone)', async () => {
    await expect(nap({ code: 'NotFound' }, 404).deleteSession('s')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createConnection tags', () => {
  it('are sent as a string-to-string object', async () => {
    const fetch = vi.fn(async () => json({ token: 't', connection: { id: 'c' } }));
    const n = napster('k', { fetch: fetch as unknown as typeof globalThis.fetch });
    await n.createConnection('a', { channelType: 'webrtc', tags: { childId: 'abc', kind: 'child' } });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).tags).toEqual({ childId: 'abc', kind: 'child' });
  });
});
