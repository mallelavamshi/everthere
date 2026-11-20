import { createClerkClient, verifyToken } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '../http';
import type { AppEnv, Env } from '../env';

export type Claims = { sub: string; email?: string; name?: string };
export type Verifier = (token: string) => Promise<Claims>;

/**
 * Production verifier: validates a Clerk session JWT with the secret key.
 * The top-level `verifyToken` exported by @clerk/backend 3.x RESOLVES TO THE JWT PAYLOAD and THROWS on failure
 * (verified on a real session token in the Task 4 device spike). The internal `tokens/verify` variant returns
 * `{data}`/`{errors}` instead; both shapes are accepted so a refactor between them cannot silently lock everyone out.
 * CLERK_AUTHORIZED_PARTIES (optional, comma-separated) restricts the token's `azp`.
 */
export async function clerkVerify(token: string, env: Env, verify: typeof verifyToken = verifyToken): Promise<Claims> {
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const res = await verify(token, {
    secretKey: env.CLERK_SECRET_KEY,
    ...(authorizedParties?.length ? { authorizedParties } : {}),
  });
  const r = res as unknown as { errors?: unknown; data?: unknown; sub?: unknown };
  if (r.errors) throw new Error('invalid token');
  const data = (r.data !== undefined && r.sub === undefined ? r.data : r) as { sub?: unknown; email?: unknown; name?: unknown } | undefined;
  if (!data || typeof data.sub !== 'string' || !data.sub) throw new Error('invalid token');
  const extra = data;
  return {
    sub: data.sub,
    email: typeof extra.email === 'string' ? extra.email : undefined,
    name: typeof extra.name === 'string' ? extra.name : undefined,
  };
}

export type Profile = { name: string; email: string };
export type ProfileFetcher = (userId: string) => Promise<Profile>;

/** Production profile fetch: Clerk Backend API. */
async function clerkFetchProfile(userId: string, env: Env): Promise<Profile> {
  const u = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
  const email =
    u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return { name, email };
}

const PLACEHOLDER_NAME = 'New user';
const PLACEHOLDER_EMAIL_SUFFIX = '@unknown.invalid';
const hasPlaceholderEmail = (email: string) => email.endsWith(PLACEHOLDER_EMAIL_SUFFIX);

async function tryFetch(env: Env, sub: string, fetchProfile?: ProfileFetcher): Promise<Partial<Profile>> {
  try {
    const p = await (fetchProfile ?? ((id: string) => clerkFetchProfile(id, env)))(sub);
    return { name: p.name?.trim() || undefined, email: p.email || undefined };
  } catch {
    return {};
  }
}

/**
 * Create the user row on first sight (profile fetched then). An existing row that still holds
 * placeholder identity gets one profile retry per request; failure leaves it unchanged.
 */
export async function upsertUser(env: Env, claims: Claims, fetchProfile?: ProfileFetcher) {
  const d = db(env);
  const [existing] = await d.select().from(schema.user).where(eq(schema.user.id, claims.sub));
  if (existing) {
    const stale = existing.name === PLACEHOLDER_NAME || hasPlaceholderEmail(existing.email);
    if (!stale) return existing;
    const p = await tryFetch(env, claims.sub, fetchProfile);
    const name = existing.name === PLACEHOLDER_NAME ? claims.name?.trim() || p.name : undefined;
    const email = hasPlaceholderEmail(existing.email) ? claims.email || p.email : undefined;
    if (!name && !email) return existing;
    const patch = { ...(name ? { name } : {}), ...(email ? { email } : {}) };
    await d.update(schema.user).set(patch).where(eq(schema.user.id, claims.sub));
    return { ...existing, ...patch };
  }
  let name = claims.name?.trim() ?? '';
  let email = claims.email ?? '';
  if (!name || !email) {
    const p = await tryFetch(env, claims.sub, fetchProfile);
    name = name || p.name || '';
    email = email || p.email || '';
  }
  await d
    .insert(schema.user)
    .values({
      id: claims.sub,
      name: name || PLACEHOLDER_NAME,
      email: email || `${claims.sub}${PLACEHOLDER_EMAIL_SUFFIX}`,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
  const [row] = await d.select().from(schema.user).where(eq(schema.user.id, claims.sub));
  if (!row) throw new Error(`user row missing after insert: ${claims.sub}`);
  return row;
}

/** Paths under /api that do not require a session. Everything else under /api/* is guarded. */
export const PUBLIC_PATHS: readonly string[] = ['/api/health', '/api/webhooks/napster', '/api/demo/sign-in'];

/** Path prefixes under /api that skip Clerk. /api/admin/ authenticates with X-Admin-Token only (routes/admin.ts). */
export const PUBLIC_PREFIXES: readonly string[] = ['/api/admin/'];

export const isPublicPath = (path: string): boolean => PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

export function authMiddleware(verify?: Verifier, fetchProfile?: ProfileFetcher): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) throw apiError('UNAUTHENTICATED', 'Sign in required');
    let claims: Claims;
    try {
      claims = await (verify ?? ((t: string) => clerkVerify(t, c.env)))(m[1]!);
      if (!claims.sub) throw new Error('no sub');
    } catch {
      throw apiError('UNAUTHENTICATED', 'Invalid or expired session');
    }
    const me = await upsertUser(c.env, claims, fetchProfile);
    c.set('userId', me.id);
    c.set('me', me);
    await next();
  };
}
