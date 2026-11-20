import { afterEach, describe, expect, it, vi } from 'vitest';
import { preflightMic } from '../src/live/micPreflight';

// Task 26c round 2: the mic permission is settled BEFORE the Napster connection starts, so Android's system dialog
// never runs against the connect timeout. Fast path: an already-granted permission costs no prompt and no capture.

const stop = vi.fn();
const stream = () => ({ getTracks: () => [{ stop }, { stop }] }) as unknown as MediaStream;

function nav(over: { query?: () => Promise<{ state: string }>; gum?: () => Promise<MediaStream> } = {}) {
  const getUserMedia = vi.fn(over.gum ?? (async () => stream()));
  const query = over.query ? vi.fn(over.query) : undefined;
  return { n: { mediaDevices: { getUserMedia }, permissions: query ? { query } : undefined } as unknown as Navigator, getUserMedia, query };
}
const named = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => stop.mockClear());

describe('preflightMic', () => {
  it('fast path: an already-granted mic is not captured and not prompted', async () => {
    const { n, getUserMedia, query } = nav({ query: async () => ({ state: 'granted' }) });
    await expect(preflightMic(n)).resolves.toBe('granted');
    expect(query).toHaveBeenCalledWith({ name: 'microphone' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('otherwise asks with getUserMedia({ audio: true }) and stops every track at once', async () => {
    const { n, getUserMedia } = nav({ query: async () => ({ state: 'prompt' }) });
    await expect(preflightMic(n)).resolves.toBe('granted');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('no Permissions API (or it throws): still asks once', async () => {
    const a = nav();
    await expect(preflightMic(a.n)).resolves.toBe('granted');
    expect(a.getUserMedia).toHaveBeenCalledTimes(1);
    const b = nav({ query: async () => Promise.reject(new TypeError('microphone is not a valid permission name')) });
    await expect(preflightMic(b.n)).resolves.toBe('granted');
    expect(b.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('a refusal is "denied"', async () => {
    for (const name of ['NotAllowedError', 'SecurityError', 'PermissionDeniedError']) {
      const { n } = nav({ gum: async () => Promise.reject(named(name)) });
      await expect(preflightMic(n)).resolves.toBe('denied');
    }
  });

  it('no mic API, no device or a busy device is "unavailable" (the SDK then reports what it finds)', async () => {
    await expect(preflightMic({} as Navigator)).resolves.toBe('unavailable');
    await expect(preflightMic(undefined)).resolves.toBe('unavailable');
    for (const name of ['NotFoundError', 'NotReadableError', 'AbortError']) {
      const { n } = nav({ gum: async () => Promise.reject(named(name)) });
      await expect(preflightMic(n)).resolves.toBe('unavailable');
    }
  });

  it('a getUserMedia that resolves without a stream is still granted', async () => {
    const { n } = nav({ gum: async () => undefined as unknown as MediaStream });
    await expect(preflightMic(n)).resolves.toBe('granted');
  });
});
