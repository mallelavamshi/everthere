import { Hono } from 'hono';
import { DemoSignInBody } from '@everthere/shared';
import type { AppEnv } from '../env';
import { apiError, readJson } from '../http';
import { clerkSignInToken, type SignInTokenMinter } from '../auth/demo';
import { hitRateLimit } from '../services/demo';

/** IPv6 address as its 8 hextets (lowercase, no leading zeros), or null when it doesn't parse. */
function ipv6Hextets(ip: string): string[] | null {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s); // embedded IPv4 tail = the last two hextets
  if (v4) s = `${v4[1]}0:0`;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16).toString(16));
}

/**
 * Rate-limit bucket for a client address: IPv4 per address; IPv6 per /64 (the first 4 hextets), since a single
 * client usually controls a whole /64. Anything unparseable is used as-is.
 */
export function rateLimitIpKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const h = ipv6Hextets(ip);
  return h ? `${h.slice(0, 4).join(':')}::/64` : ip;
}

export const DEMO_SIGN_IN_LIMIT = 10;
export const DEMO_SIGN_IN_WINDOW_MS = 60_000;

/** Public (in PUBLIC_PATHS): "Try the demo". Rate-limited per IP, then a Clerk sign-in ticket for the seeded persona. */
export function demoRoutes(opts: { signInToken?: SignInTokenMinter } = {}) {
  const r = new Hono<AppEnv>();

  r.post('/demo/sign-in', async (c) => {
    // Counted before anything else, so invalid requests use up the budget too.
    const ip = rateLimitIpKey(c.req.header('CF-Connecting-IP') || 'unknown');
    if (!(await hitRateLimit(c.env, `demo-sign-in:${ip}`, DEMO_SIGN_IN_LIMIT, DEMO_SIGN_IN_WINDOW_MS))) {
      throw apiError('RATE_LIMITED', 'Too many tries. Please wait a minute and try again.');
    }
    const { persona } = DemoSignInBody.parse(await readJson(c));
    // Only a user that is still a demo user can be signed into this way.
    const row = await c.env.DB
      .prepare('SELECT p.user_id FROM demo_persona p JOIN user u ON u.id = p.user_id AND u.is_demo = 1 WHERE p.persona = ?')
      .bind(persona)
      .first<{ user_id: string }>();
    if (!row) throw apiError('NOT_FOUND', 'The demo is not set up yet');
    let ticket: string;
    try {
      ticket = await (opts.signInToken ?? clerkSignInToken)(c.env, row.user_id);
    } catch (e) {
      console.error('demo sign-in: Clerk sign-in token failed', e);
      throw apiError('INTERNAL', 'Could not start the demo right now');
    }
    return c.json({ ticket });
  });

  return r;
}
