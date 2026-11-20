import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, friendlyMessage, setTokenGetter, API_TIMEOUT_MS } from '../src/lib/api';
import { networkStatus } from '../src/lib/native';
import { clearActingToken, setActingToken } from '../src/lib/storage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
const getToken = vi.fn(async (_opts?: { skipCache?: boolean }) => 'tok-1');

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  getToken.mockClear();
  setTokenGetter(getToken);
  networkStatus.reset();
  await clearActingToken();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('maps a 503 AVATARS_BUSY body to an ApiError with that code', async () => {
    fetchMock.mockResolvedValue(json(503, { error: { code: 'AVATARS_BUSY', message: 'busy' } }));
    const err = (await api('/api/avatars').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'AVATARS_BUSY', status: 503, message: 'busy' });
    expect(friendlyMessage(err.code)).toBe('All our avatars are busy hugging. Try again in a minute 💛');
  });

  it('sends the bearer token and the stored acting token, and parses JSON', async () => {
    await setActingToken({ token: 'act-9', expiresAt: Date.now() + 60_000 });
    fetchMock.mockResolvedValue(json(200, { ok: 1 }));
    await expect(api<{ ok: number }>('/api/me')).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/me$/);
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe('Bearer tok-1');
    expect(h.get('x-acting-token')).toBe('act-9');
  });

  it('omits the acting token once it has expired', async () => {
    await setActingToken({ token: 'old', expiresAt: Date.now() - 1 });
    fetchMock.mockResolvedValue(json(200, {}));
    await api('/api/me');
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('x-acting-token')).toBeNull();
  });

  it('on a 401 refreshes the token once and retries once', async () => {
    getToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh');
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api('/api/me')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true });
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get('authorization')).toBe('Bearer fresh');
  });

  it('does not retry a second 401', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }));
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('turns a 15 s timeout into ApiError NETWORK', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const p = api('/api/me').catch((e) => e);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    const err = (await p) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK');
    expect(friendlyMessage('NETWORK')).toMatch(/connection/i);
  });

  it('flags the network as failing on a TypeError and recovers on the next success', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(networkStatus.getSnapshot()).toBe(false); // one blip is not enough to show the banner
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(networkStatus.getSnapshot()).toBe(true);
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api('/api/me');
    expect(networkStatus.getSnapshot()).toBe(false);
  });

  it('wraps a getToken failure in ApiError NETWORK', async () => {
    setTokenGetter(async () => {
      throw new Error('clerk offline');
    });
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the token', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    fetchMock.mockResolvedValue(json(500, { error: { code: 'INTERNAL', message: 'x' } }));
    await api('/api/me').catch(() => {});
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('tok-1');
    spies.forEach((s) => s.mockRestore());
  });

  it('friendlyMessage covers every code', () => {
    for (const code of ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID', 'SESSION_ACTIVE', 'AVATARS_BUSY', 'RESTING', 'DEMO_READ_ONLY', 'INVITE_INVALID', 'PIN_LOCKED', 'RATE_LIMITED', 'INTERNAL', 'NETWORK'] as const) {
      expect(friendlyMessage(code).length).toBeGreaterThan(10);
    }
    expect(friendlyMessage('RESTING')).toBe('EverThere is taking a little rest. Please try again soon.');
  });
});
