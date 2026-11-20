import { describe, it, expect, vi } from 'vitest';
import { makeApp, authAs, seedRows } from './helpers';
import { hmacHex, timingSafeEqualHex } from '../src/lib/crypto';
import { signMediaUrl } from '../src/routes/media';
import { isOwnedKey, makeMediaKey } from '../src/lib/mediaKeys';

const { env, request } = makeApp();
const NOW = Date.now();
const users = (...ids: string[]) => seedRows(env, { user: ids.map((id) => ({ id, name: `N ${id}`, email: `${id}@x`, created_at: NOW })) });
const errCode = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;
const codes = (s: string) => [...s].map((c) => c.charCodeAt(0));

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const WEBP = [...codes('RIFF'), 1, 2, 3, 4, ...codes('WEBP')];

function upload(user: string, bytes: Uint8Array | number[], type: string, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('file', new File([new Uint8Array(bytes)], 'x', { type }));
  return request('/api/media', { method: 'POST', headers: authAs(user), body: fd });
}
const fam = async (user: string) => ((await (await request('/api/families', { method: 'POST', headers: authAs(user) })).json()) as { id: string }).id;
const local = (url: string) => url.replace('http://localhost:8787', '');

describe('crypto helpers', () => {
  it('hmacHex is deterministic hex; timingSafeEqualHex compares', async () => {
    const a = await hmacHex('k', 'm');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex('k', 'm')).toBe(a);
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, a.slice(0, -1) + (a.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(timingSafeEqualHex(a, 'ab')).toBe(false);
  });
});

describe('mediaKeys', () => {
  it('rejects underscore in place of the dot, and wrong owner/purpose', () => {
    const t = 'a'.repeat(21);
    expect(isOwnedKey(`child/fam/${t}.jpg`, 'child', 'fam')).toBe(true);
    expect(isOwnedKey(`child/fam/${t}_jpg`, 'child', 'fam')).toBe(false);
    expect(isOwnedKey(`child/fam/${t}.gif`, 'child', 'fam')).toBe(false);
    expect(isOwnedKey(`child/other/${t}.jpg`, 'child', 'fam')).toBe(false);
    expect(isOwnedKey(`avatar/fam/${t}.jpg`, 'child', 'fam')).toBe(false);
    expect(isOwnedKey(`child/fam/${t}.jpg\n`, 'child', 'fam')).toBe(false);
  });
  it('makeMediaKey maps content types', () => {
    expect(makeMediaKey('avatar', 'u1', 'image/png')).toMatch(/^avatar\/u1\/[A-Za-z0-9_-]{21}\.png$/);
    expect(makeMediaKey('logo', 'o1', 'image/webp')).toMatch(/\.webp$/);
  });
});

describe('child photoKey validation (KEY_TAIL fix)', () => {
  it('rejects child/<fam>/<21chars>_jpg', async () => {
    await users('kt');
    const f = await fam('kt');
    const bad = `child/${f}/${'a'.repeat(21)}_jpg`;
    const res = await request('/api/children', {
      method: 'POST',
      headers: { ...authAs('kt'), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mia', birthday: '2022-03-04', timezone: 'America/New_York', photoKey: bad }),
    });
    expect(await errCode(res)).toBe('INVALID');
  });
});

describe('POST /api/media', () => {
  it('stores an avatar in R2 and returns a key + signed url that serves it', async () => {
    await users('m1');
    const res = await upload('m1', JPEG, 'image/jpeg', { purpose: 'avatar' });
    expect(res.status).toBe(200);
    const { key, url } = (await res.json()) as { key: string; url: string };
    expect(isOwnedKey(key, 'avatar', 'm1')).toBe(true);
    const obj = await env.MEDIA.get(key);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/jpeg');
    expect(url.startsWith(`http://localhost:8787/m/${encodeURIComponent(key)}?exp=`)).toBe(true);
    const got = await request(local(url));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(got.headers.get('cache-control')).toBe('private, max-age=300');
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual(JPEG);
  });

  it('child upload uses the caller family; non-parent is FORBIDDEN', async () => {
    await users('m2', 'm3');
    const f = await fam('m2');
    const { key } = (await (await upload('m2', PNG, 'image/png', { purpose: 'child' })).json()) as { key: string };
    expect(isOwnedKey(key, 'child', f)).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
    expect(await errCode(await upload('m3', PNG, 'image/png', { purpose: 'child' }))).toBe('FORBIDDEN');
  });

  it('logo upload: org admin ok, non-admin FORBIDDEN, missing orgId INVALID', async () => {
    await users('ad', 'te');
    await seedRows(env, {
      org: [{ id: 'org1', name: 'O' }],
      org_member: [
        { org_id: 'org1', user_id: 'ad', role: 'admin' },
        { org_id: 'org1', user_id: 'te', role: 'teacher' },
      ],
    });
    const ok = await upload('ad', WEBP, 'image/webp', { purpose: 'logo', orgId: 'org1' });
    expect(ok.status).toBe(200);
    expect(isOwnedKey(((await ok.json()) as { key: string }).key, 'logo', 'org1')).toBe(true);
    expect(await errCode(await upload('te', WEBP, 'image/webp', { purpose: 'logo', orgId: 'org1' }))).toBe('FORBIDDEN');
    expect(await errCode(await upload('ad', WEBP, 'image/webp', { purpose: 'logo' }))).toBe('INVALID');
  });

  it('rejects >8MB (INVALID), allows exactly 8MB', async () => {
    await users('m4');
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(JPEG);
    const res = await upload('m4', big, 'image/jpeg', { purpose: 'avatar' });
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('INVALID');
    const exact = new Uint8Array(8 * 1024 * 1024);
    exact.set(JPEG);
    expect((await upload('m4', exact, 'image/jpeg', { purpose: 'avatar' })).status).toBe(200);
  });

  it('rejects text/html, magic-byte mismatch, bad purpose, non-multipart', async () => {
    await users('m5');
    const html = codes('<html>hi</html>');
    const r1 = await upload('m5', html, 'text/html', { purpose: 'avatar' });
    expect(r1.status).toBe(400);
    expect(await errCode(r1)).toBe('INVALID');
    expect(await errCode(await upload('m5', html, 'image/jpeg', { purpose: 'avatar' }))).toBe('INVALID');
    expect(await errCode(await upload('m5', JPEG, 'image/png', { purpose: 'avatar' }))).toBe('INVALID');
    expect(await errCode(await upload('m5', JPEG, 'image/jpeg', { purpose: 'bogus' }))).toBe('INVALID');
    expect(await errCode(await request('/api/media', { method: 'POST', headers: authAs('m5') }))).toBe('INVALID');
  });

  it('requires auth', async () => {
    const res = await request('/api/media', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('GET /m/:key', () => {
  const key = 'avatar/zz/' + 'b'.repeat(21) + '.jpg';
  const path = (k: string, exp: number, sig: string) => `/m/${encodeURIComponent(k)}?exp=${exp}&sig=${sig}`;
  const put = () => env.MEDIA.put(key, new Uint8Array(JPEG), { httpMetadata: { contentType: 'image/jpeg' } });

  it('needs no auth header; valid signed url is 200', async () => {
    await put();
    const res = await request(local(await signMediaUrl(env, key, 60_000)));
    expect(res.status).toBe(200);
  });

  it('expired is 403', async () => {
    await put();
    const exp = Date.now() - 1000;
    const res = await request(path(key, exp, await hmacHex(env.MEDIA_SIGNING_KEY, `${key}|${exp}`)));
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe('FORBIDDEN');
  });

  it('tampered signature, tampered exp, other key, missing params are 403', async () => {
    await put();
    const exp = Date.now() + 60_000;
    const sig = await hmacHex(env.MEDIA_SIGNING_KEY, `${key}|${exp}`);
    const bad = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect((await request(path(key, exp, bad))).status).toBe(403);
    expect((await request(path(key, exp + 1, sig))).status).toBe(403);
    expect((await request(path(key.replace('zz', 'yy'), exp, sig))).status).toBe(403);
    expect((await request(`/m/${encodeURIComponent(key)}`)).status).toBe(403);
  });

  it('missing object with a valid signature is 404; traversal keys are never served', async () => {
    const gone = 'avatar/zz/' + 'c'.repeat(21) + '.jpg';
    expect((await request(local(await signMediaUrl(env, gone, 60_000)))).status).toBe(404);
    await env.MEDIA.put('x.jpg', new Uint8Array(JPEG));
    for (const k of ['avatar/../x.jpg', '/avatar/x.jpg', '../x.jpg']) {
      const exp = Date.now() + 60_000;
      const r = await request(path(k, exp, await hmacHex(env.MEDIA_SIGNING_KEY, `${k}|${exp}`)));
      expect(r.status).toBe(403);
    }
  });
});

describe('signMediaUrl: stable URLs and a safe base', () => {
  const H = 3_600_000;
  const expOf = (url: string) => Number(new URL(url).searchParams.get('exp'));

  it('quantizes expiry to the next hour boundary, so refetches within the hour give the identical URL', async () => {
    const base = Math.floor(NOW / H) * H;
    const a = await signMediaUrl(env, 'avatar/u/x.png', H, base + 5 * 60_000);
    const b = await signMediaUrl(env, 'avatar/u/x.png', H, base + 25 * 60_000);
    expect(a).toBe(b);
    expect(expOf(a) % H).toBe(0);
    expect(expOf(a)).toBe(base + 2 * H); // ceil(now + 1h) to the hour
  });

  it('always leaves at least 30 minutes of validity', async () => {
    const base = Math.floor(NOW / H) * H;
    for (const now of [base, base + 1, base + 31 * 60_000, base + H - 1]) {
      for (const ttl of [60_000, 10 * 60_000, H]) {
        const exp = expOf(await signMediaUrl(env, 'k', ttl, now));
        expect(exp - now, `now+${now - base} ttl ${ttl}`).toBeGreaterThanOrEqual(30 * 60_000);
        expect(exp - now).toBeGreaterThanOrEqual(ttl);
        expect(exp % H).toBe(0);
      }
    }
  });

  it('a quantized URL still verifies and serves', async () => {
    await users('mq1');
    const res = await upload('mq1', PNG, 'image/png', { purpose: 'avatar' });
    const { url } = (await res.json()) as { url: string };
    expect(expOf(url) % H).toBe(0);
    expect((await request(local(url))).status).toBe(200);
  });

  it('logs once (no secrets) when PUBLIC_API_BASE is unset or localhost, and still signs', async () => {
    const { resetMediaBaseWarning } = await import('../src/routes/media');
    resetMediaBaseWarning();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const url = await signMediaUrl({ ...env, PUBLIC_API_BASE: 'http://localhost:8787' }, 'k1', H);
      expect(url.startsWith('http://localhost:8787/m/k1?exp=')).toBe(true);
      await signMediaUrl({ ...env, PUBLIC_API_BASE: '' }, 'k2', H);
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = spy.mock.calls.flat().map(String).join(' ');
      expect(msg).toContain('PUBLIC_API_BASE');
      expect(msg).not.toContain(env.MEDIA_SIGNING_KEY);
      resetMediaBaseWarning();
      spy.mockClear();
      await signMediaUrl({ ...env, PUBLIC_API_BASE: 'https://everthere-api.example.workers.dev' }, 'k3', H);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
