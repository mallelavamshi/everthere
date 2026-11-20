import { describe, it, expect } from 'vitest';
import { makeApp, seedRows, authAs } from './helpers';
import { newId } from '../src/lib/ids';
import { db } from '../src/db/client';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '../src/http';

describe('skeleton', () => {
  it('GET /api/health -> 200 {ok:true}', async () => {
    const { request } = makeApp();
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route -> 404 NOT_FOUND', async () => {
    const { request } = makeApp();
    const res = await request('/api/nope', { headers: authAs('u1-404') });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });

  it('unauthenticated protected path -> 401 UNAUTHENTICATED; health stays public', async () => {
    const { request } = makeApp();
    const res = await request('/api/anything');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    expect((await request('/api/health')).status).toBe(200);
  });

  it('apiError maps to status + JSON', async () => {
    const e = apiError('PIN_LOCKED', 'slow down');
    expect(e.status).toBe(429);
    expect(await e.getResponse().json()).toEqual({ error: { code: 'PIN_LOCKED', message: 'slow down' } });
  });

  it('newId is 21 chars', () => {
    expect(newId()).toHaveLength(21);
  });

  it('migrations applied: seed and read via drizzle', async () => {
    const { env } = makeApp();
    await seedRows(env, { user: [{ id: 'u1', name: 'Sarah', email: 's@x.io', created_at: 1 }] });
    const rows = await db(env).select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(rows[0]).toMatchObject({ id: 'u1', name: 'Sarah', isDemo: 0 });
  });
});

import { Hono } from 'hono';
import { z } from 'zod';
import { onError } from '../src/http';

describe('error handler', () => {
  it('maps ZodError to INVALID 400 and HTTPException to its JSON', async () => {
    const a = new Hono();
    a.onError(onError as never);
    a.get('/z', (c) => c.json(z.object({ a: z.string() }).parse({})));
    a.get('/f', () => {
      throw apiError('FORBIDDEN', 'nope');
    });
    const z1 = await a.request('/z');
    expect(z1.status).toBe(400);
    expect(((await z1.json()) as { error: { code: string } }).error.code).toBe('INVALID');
    const f = await a.request('/f');
    expect(f.status).toBe(403);
    expect(await f.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope' } });
  });

  it('credit_guard is seeded with $120 cap', async () => {
    const { env } = makeApp();
    const row = await env.DB.prepare('SELECT * FROM credit_guard').first();
    expect(row).toEqual({ id: 1, cap_usd: 120, spent_usd: 0 });
  });
});
