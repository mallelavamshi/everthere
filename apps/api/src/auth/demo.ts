import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from '../env';
import { apiError } from '../http';

// Demo accounts (user.is_demo = 1, seeded by PUT /api/admin/seed) are shared by every judge, so they can't rename
// things, delete data, or replace avatars. Everything else (plans, sessions, check-ins) still works and is undone
// by the nightly reset.

const readOnly = () =>
  apiError('DEMO_READ_ONLY', "The demo account can't do that. Sign up with your own account to try it for real.");

const isDemo = (c: Context<AppEnv>): boolean => c.var.me?.isDemo === 1;

/** Refuses the request outright for a demo user. */
export const forbidDemo: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (isDemo(c)) throw readOnly();
  await next();
};

const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? null);

/**
 * For a demo user, refuses an edit that would change a protected field (a name, a child's photo): each entry is
 * `[requested, current]`; `undefined` = not requested. Resending the current value passes. Call it in the route
 * AFTER authorization, so a demo user can't use the answer to probe rows in other families or orgs.
 */
export function forbidDemoChange(c: Context<AppEnv>, fields: [requested: unknown, current: unknown][]): void {
  if (!isDemo(c)) return;
  for (const [requested, current] of fields) {
    if (requested !== undefined && norm(requested) !== norm(current)) throw readOnly();
  }
}

// ---- Clerk sign-in tokens ---------------------------------------------------------------------------------------

export type SignInTokenMinter = (env: Env, userId: string) => Promise<string>;

export const CLERK_SIGN_IN_TOKENS_URL = 'https://api.clerk.com/v1/sign_in_tokens';
export const SIGN_IN_TOKEN_TTL_S = 300;

/**
 * Mints a one-time Clerk sign-in token (the app completes sign-in with `signIn.create({strategy:'ticket', ticket})`).
 * Throws on any Clerk error or a missing token.
 */
export async function clerkSignInToken(env: Pick<Env, 'CLERK_SECRET_KEY'>, userId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(CLERK_SIGN_IN_TOKENS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: SIGN_IN_TOKEN_TTL_S }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Clerk sign_in_tokens failed (${res.status})`);
  const body = (await res.json().catch(() => ({}))) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) throw new Error('Clerk sign_in_tokens returned no token');
  return body.token;
}
