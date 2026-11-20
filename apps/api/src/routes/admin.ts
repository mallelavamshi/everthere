import { Hono, type MiddlewareHandler } from 'hono';
import { CreditGuardBody, DemoFixture, LIMITS } from '@everthere/shared';
import type { AppEnv } from '../env';
import { apiError, readJson } from '../http';
import { timingSafeEqualHex } from '../lib/crypto';
import { seedDemoWorld } from '../services/demo';

/**
 * Admin routes authenticate with the X-Admin-Token header ONLY (Clerk is skipped for /api/admin/, see
 * PUBLIC_PREFIXES). Constant-time comparison against env.ADMIN_TOKEN; an unset or empty ADMIN_TOKEN refuses everything.
 */
export const requireAdminToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const given = c.req.header('X-Admin-Token') ?? '';
  const ok = typeof expected === 'string' && expected.length > 0 && timingSafeEqualHex(given, expected);
  if (!ok) throw apiError('UNAUTHENTICATED', 'Admin token required');
  await next();
};

async function guardView(env: AppEnv['Bindings']) {
  const row = await env.DB.prepare('SELECT cap_usd, spent_usd FROM credit_guard WHERE id = 1').first<{ cap_usd: number; spent_usd: number }>();
  return { capUsd: row?.cap_usd ?? LIMITS.creditCapUsd, spentUsd: row?.spent_usd ?? 0 };
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('/admin/*', requireAdminToken);

adminRoutes.get('/admin/credit-guard', async (c) => c.json(await guardView(c.env)));

adminRoutes.put('/admin/credit-guard', async (c) => {
  const { capUsd } = CreditGuardBody.parse(await readJson(c));
  await c.env.DB
    .prepare('INSERT INTO credit_guard (id, cap_usd, spent_usd) VALUES (1, ?, 0) ON CONFLICT (id) DO UPDATE SET cap_usd = excluded.cap_usd')
    .bind(capUsd)
    .run();
  return c.json(await guardView(c.env));
});

/** Body: the fixture JSON written by scripts/seed/seed.ts. Idempotent. */
adminRoutes.put('/admin/seed', async (c) => {
  const fixture = DemoFixture.parse(await readJson(c));
  await seedDemoWorld(c.env, fixture);
  return c.json({ ok: true, seededAt: fixture.seededAt, personas: fixture.personas });
});
