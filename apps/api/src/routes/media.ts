import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { apiError } from '../http';
import { hmacHex, timingSafeEqualHex } from '../lib/crypto';
import { IMAGE_EXT, MEDIA_PURPOSES, makeMediaKey, type ImageType, type MediaPurpose } from '../lib/mediaKeys';
import { isAdminOf } from '../auth/access';

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MEDIA_URL_TTL_MS = 3_600_000;

type SignEnv = Pick<Env, 'MEDIA_SIGNING_KEY' | 'PUBLIC_API_BASE'>;

const HOUR_MS = 3_600_000;
const MIN_VALIDITY_MS = 30 * 60_000;

/**
 * Expiry rounded UP to the next whole hour (at least `ttlMs` and at least 30 minutes away), so every refetch within
 * the hour signs the identical URL: images stay cached instead of re-downloading and flickering.
 */
export function mediaExpiry(ttlMs: number, now = Date.now()): number {
  let exp = Math.ceil((now + ttlMs) / HOUR_MS) * HOUR_MS;
  if (exp - now < MIN_VALIDITY_MS) exp += HOUR_MS;
  return exp;
}

let warnedBase = false;
/** Test hook: lets the once-only PUBLIC_API_BASE warning fire again. */
export const resetMediaBaseWarning = (): void => {
  warnedBase = false;
};

/** A deployed Worker must sign links with its public URL; localhost links would be dead on a phone. Warn once. */
function checkBase(base: string | undefined): void {
  if (warnedBase) return;
  if (!base || /^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(base)) {
    warnedBase = true;
    console.error(
      `media: PUBLIC_API_BASE is ${base ? 'a localhost URL' : 'not set'}; signed photo links will not load on devices. ` +
        'Set PUBLIC_API_BASE to the deployed workers.dev URL (see docs/notes/deploy-checklist.md).',
    );
  }
}

export async function signMediaUrl(env: SignEnv, key: string, ttlMs: number, now = Date.now()): Promise<string> {
  checkBase(env.PUBLIC_API_BASE);
  const exp = mediaExpiry(ttlMs, now);
  const sig = await hmacHex(env.MEDIA_SIGNING_KEY, `${key}|${exp}`);
  return `${env.PUBLIC_API_BASE ?? ''}/m/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

function matchesMagic(b: Uint8Array, type: ImageType): boolean {
  const at = (o: number, s: string) => [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return at(0, 'RIFF') && at(8, 'WEBP');
}

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.post('/media', async (c) => {
  const userId = c.var.userId;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw apiError('INVALID', 'Expected multipart form data');
  }
  const purpose = form.get('purpose');
  if (typeof purpose !== 'string' || !(MEDIA_PURPOSES as readonly string[]).includes(purpose)) throw apiError('INVALID', 'Invalid purpose');
  const file = form.get('file') as unknown as { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> } | string | null;
  if (file === null || typeof file === 'string') throw apiError('INVALID', 'Missing file');
  if (!Object.hasOwn(IMAGE_EXT, file.type)) throw apiError('INVALID', 'Only JPEG, PNG or WebP images are allowed');
  const type = file.type as ImageType;
  if (file.size > MAX_MEDIA_BYTES) throw apiError('INVALID', 'File is larger than 8 MB');
  const bytes = await file.arrayBuffer();
  if (!matchesMagic(new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)), type)) throw apiError('INVALID', 'File content does not match its type');

  let ownerId: string;
  if (purpose === 'avatar') {
    ownerId = userId;
  } else if (purpose === 'child') {
    const row = await c.env.DB.prepare('SELECT family_id FROM family_member WHERE user_id = ? ORDER BY family_id LIMIT 1')
      .bind(userId)
      .first<{ family_id: string }>();
    if (!row) throw apiError('FORBIDDEN', 'Only parents can upload child photos');
    ownerId = row.family_id;
  } else {
    const orgId = form.get('orgId');
    if (typeof orgId !== 'string' || !orgId) throw apiError('INVALID', 'orgId is required for logo uploads');
    if (!(await isAdminOf(c.env, userId, orgId))) throw apiError('FORBIDDEN', 'Only org admins can upload logos');
    ownerId = orgId;
  }

  const key = makeMediaKey(purpose as MediaPurpose, ownerId, type);
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  return c.json({ key, url: await signMediaUrl(c.env, key, MEDIA_URL_TTL_MS) });
});

/** Public (unauthenticated) route, mounted outside /api: access is by signature + expiry only. */
export const publicMediaRoutes = new Hono<AppEnv>();

publicMediaRoutes.get('/m/:key', async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(c.req.param('key'));
  } catch {
    throw apiError('FORBIDDEN', 'Invalid or expired link');
  }
  const expRaw = c.req.query('exp') ?? '';
  const sig = c.req.query('sig') ?? '';
  const exp = Number(expRaw);
  const unsafeKey = !key || key.includes('..') || key.startsWith('/');
  const expected = await hmacHex(c.env.MEDIA_SIGNING_KEY, `${key}|${expRaw}`);
  const sigOk = timingSafeEqualHex(expected, sig);
  if (unsafeKey || !sigOk || !Number.isSafeInteger(exp) || exp <= Date.now()) throw apiError('FORBIDDEN', 'Invalid or expired link');

  const obj = await c.env.MEDIA.get(key);
  if (!obj) throw apiError('NOT_FOUND', 'Not found');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
});
