import { Hono, type MiddlewareHandler } from 'hono';
import { ActingBody, LIMITS, PinBody } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError, readJson } from '../http';
import { newId } from '../lib/ids';
import { hmacHex, timingSafeEqualHex } from '../lib/crypto';
import { isMemberOf, requireMemberOf } from './access';

type E = Pick<Env, 'DB'>;

const PBKDF2_ITERATIONS = 100_000;
const PIN_RE = /^\d{4}$/;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export function assertPinFormat(pin: unknown): asserts pin is string {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw apiError('INVALID', 'PIN must be exactly 4 digits');
}

/** `pbkdf2$<iterations>$<saltB64>$<hashB64>` */
export async function hashPin(pin: string): Promise<string> {
  assertPinFormat(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function setPin(env: E, userId: string, orgId: string, pin: string): Promise<void> {
  const pinHash = await hashPin(pin);
  await env.DB
    .prepare(
      `INSERT INTO staff_pin (user_id, org_id, pin_hash) VALUES (?, ?, ?)
       ON CONFLICT(user_id, org_id) DO UPDATE SET pin_hash = excluded.pin_hash`,
    )
    .bind(userId, orgId, pinHash)
    .run();
}

export async function verifyPin(env: E, userId: string, orgId: string, pin: string): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT pin_hash FROM staff_pin WHERE user_id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first<{ pin_hash: string }>();
  if (!row) return false;
  const [scheme, iters, salt, hash] = row.pin_hash.split('$');
  if (scheme !== 'pbkdf2' || !iters || !salt || !hash) return false;
  const n = Number(iters);
  if (!Number.isInteger(n) || n < 1) return false;
  const got = new Uint8Array(await derive(pin, unb64(salt), n));
  return timingSafeEqual(got, unb64(hash));
}

// ---------------------------------------------------------------------------------------------------------------
// Shared-tablet acting tokens.
// Format: base64url("deviceId|orgId|teacherUserId|exp") + "." + hex HMAC-SHA256(ACTING_TOKEN_KEY, "deviceId|orgId|teacherUserId|exp")

export const ACTING_TTL_MS = 12 * 3_600_000;
export const ACTING_HEADER = 'X-Acting-Token';
const MAX_TOKEN_LENGTH = 1024;

export type ActingClaims = { deviceId: string; orgId: string; teacherUserId: string; exp: number };

const utf8 = new TextEncoder();

const b64urlEncode = (s: string): string => b64(utf8.encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(unb64(s.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export async function signActingToken(env: Pick<Env, 'ACTING_TOKEN_KEY'>, t: ActingClaims): Promise<string> {
  if (!env.ACTING_TOKEN_KEY) throw new Error('ACTING_TOKEN_KEY is not configured');
  for (const v of [t.deviceId, t.orgId, t.teacherUserId]) if (!v || v.includes('|')) throw new Error('invalid acting token field');
  const payload = `${t.deviceId}|${t.orgId}|${t.teacherUserId}|${t.exp}`;
  return `${b64urlEncode(payload)}.${await hmacHex(env.ACTING_TOKEN_KEY, payload)}`;
}

/** Signature (constant-time) + expiry only; membership/device checks are in resolveActing. Null on any defect. */
export async function verifyActingToken(env: Pick<Env, 'ACTING_TOKEN_KEY'>, token: string, nowMs = Date.now()): Promise<ActingClaims | null> {
  if (!env.ACTING_TOKEN_KEY || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts as [string, string];
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const payload = b64urlDecode(p);
  if (payload == null) return null;
  const expected = await hmacHex(env.ACTING_TOKEN_KEY, payload);
  if (!timingSafeEqualHex(expected, sig)) return null;
  const f = payload.split('|');
  if (f.length !== 4 || f.slice(0, 3).some((x) => !x)) return null;
  const exp = Number(f[3]);
  if (!Number.isSafeInteger(exp) || exp <= nowMs) return null;
  return { deviceId: f[0]!, orgId: f[1]!, teacherUserId: f[2]!, exp };
}

const ORG_PATH = /^\/api\/orgs\/([^/]+)/;

/** Teacher the request may act as, and the token's org, or null. Every check is re-run against D1 on each request. */
export async function resolveActing(
  env: Pick<Env, 'DB' | 'ACTING_TOKEN_KEY'>,
  token: string,
  userId: string,
  path: string,
): Promise<{ teacherUserId: string; orgId: string } | null> {
  const t = await verifyActingToken(env, token);
  if (!t) return null;
  const m = ORG_PATH.exec(path);
  if (m) {
    let target: string;
    try {
      target = decodeURIComponent(m[1]!);
    } catch {
      return null;
    }
    if (target !== t.orgId) return null;
  }
  // Device belongs to the org, the signed-in user is a member, and the teacher is still a member.
  const ok = await env.DB
    .prepare(
      `SELECT 1 FROM device d
       JOIN org_member me ON me.org_id = d.org_id AND me.user_id = ?
       JOIN org_member t ON t.org_id = d.org_id AND t.user_id = ?
       WHERE d.id = ? AND d.org_id = ? LIMIT 1`,
    )
    .bind(userId, t.teacherUserId, t.deviceId, t.orgId)
    .first();
  return ok ? { teacherUserId: t.teacherUserId, orgId: t.orgId } : null;
}

/**
 * Runs after auth on /api/*. A valid X-Acting-Token sets c.var.actingUserId and c.var.actingOrgId (always together);
 * anything else is silently ignored. Routes that honor acting must scope access to actingOrgId.
 */
export const actingMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header(ACTING_HEADER);
  const userId = c.get('userId');
  if (token && userId) {
    try {
      const acting = await resolveActing(c.env, token, userId, c.req.path);
      if (acting) {
        c.set('actingUserId', acting.teacherUserId);
        c.set('actingOrgId', acting.orgId);
      }
    } catch {
      // never error on a bad acting token
    }
  }
  await next();
};

export const actingRoutes = new Hono<AppEnv>();

actingRoutes.post('/orgs/:id/devices', async (c) => {
  const orgId = c.req.param('id');
  await requireMemberOf(c.env, c.var.userId, orgId);
  const deviceId = newId();
  await c.env.DB
    .prepare('INSERT INTO device (id, org_id, registered_by, created_at) VALUES (?, ?, ?, ?)')
    .bind(deviceId, orgId, c.var.userId, Date.now())
    .run();
  return c.json({ deviceId });
});

/** Any org member sets or replaces their own PIN for this org (the signed-in user, never the acting teacher). */
actingRoutes.put('/orgs/:id/pin', async (c) => {
  const orgId = c.req.param('id');
  await requireMemberOf(c.env, c.var.userId, orgId);
  const { pin } = PinBody.parse(await readJson(c));
  await setPin(c.env, c.var.userId, orgId, pin);
  return c.json({ ok: true });
});

actingRoutes.post('/orgs/:id/acting', async (c) => {
  const orgId = c.req.param('id');
  await requireMemberOf(c.env, c.var.userId, orgId);
  const body = ActingBody.parse(await readJson(c));

  const dev = await c.env.DB.prepare('SELECT org_id FROM device WHERE id = ?').bind(body.deviceId).first<{ org_id: string }>();
  if (!dev || dev.org_id !== orgId) throw apiError('DEVICE_UNKNOWN', 'Unknown device');

  // Lockout, atomic: record this attempt first, then count inside the same transaction. The attempt is refused
  // unchecked when it is beyond the limit for the device OR for the target (org, teacher) across all devices.
  // Parallel requests each see every row inserted before them, so at most pinAttempts PINs are ever checked.
  const DB = c.env.DB;
  const now = Date.now();
  const since = now - LIMITS.pinWindowMs;
  const [ins, byDevice, byTeacher] = await DB.batch<{ rid?: number; n?: number }>([
    DB.prepare('INSERT INTO pin_attempt (device_id, at, org_id, teacher_user_id) VALUES (?, ?, ?, ?) RETURNING rowid AS rid').bind(
      body.deviceId,
      now,
      orgId,
      body.teacherUserId,
    ),
    DB.prepare('SELECT COUNT(*) AS n FROM pin_attempt WHERE device_id = ? AND at > ?').bind(body.deviceId, since),
    DB.prepare('SELECT COUNT(*) AS n FROM pin_attempt WHERE org_id = ? AND teacher_user_id = ? AND at > ?').bind(orgId, body.teacherUserId, since),
  ]);
  const rid = ins?.results[0]?.rid;
  const over = (r: D1Result<{ n?: number }> | undefined) => (r?.results[0]?.n ?? Infinity) > LIMITS.pinAttempts;
  if (over(byDevice) || over(byTeacher)) {
    // A refused attempt is not a PIN check: drop its row so it neither counts nor extends the lock.
    if (rid != null) await DB.prepare('DELETE FROM pin_attempt WHERE rowid = ?').bind(rid).run();
    throw apiError('PIN_LOCKED', 'Too many wrong PINs. Try again in a few minutes.');
  }

  const ok = (await isMemberOf(c.env, body.teacherUserId, orgId)) && (await verifyPin(c.env, body.teacherUserId, orgId, body.pin));
  if (!ok) {
    // Keep this attempt's row; prune expired rows for this device and target.
    await DB.prepare('DELETE FROM pin_attempt WHERE (device_id = ? OR (org_id = ? AND teacher_user_id = ?)) AND at <= ?')
      .bind(body.deviceId, orgId, body.teacherUserId, since)
      .run();
    throw apiError('FORBIDDEN', 'Wrong PIN');
  }

  // Correct PIN: clear this teacher's attempts (all devices) and this device's untargeted legacy rows. Wrong guesses
  // on this device against OTHER teachers are kept, or signing in as yourself would reset a colleague's counter.
  await DB.prepare('DELETE FROM pin_attempt WHERE (org_id = ? AND teacher_user_id = ?) OR (device_id = ? AND teacher_user_id IS NULL)')
    .bind(orgId, body.teacherUserId, body.deviceId)
    .run();
  const expiresAt = now + ACTING_TTL_MS;
  const actingToken = await signActingToken(c.env, { deviceId: body.deviceId, orgId, teacherUserId: body.teacherUserId, exp: expiresAt });
  return c.json({ actingToken, expiresAt });
});
