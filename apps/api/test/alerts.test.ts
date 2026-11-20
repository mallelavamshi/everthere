import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import type { Env } from '../src/env';
import { authAs, makeApp, seedRows } from './helpers';

const NOW = Date.now();

async function seed(p: string) {
  const id = (s: string) => `${p}${s}`;
  await seedRows(env as Env, {
    user: ['U', 'O'].map((u) => ({ id: id(u), name: u, email: `${id(u)}@x`, created_at: NOW })),
    alert: [
      ...Array.from({ length: 55 }, (_, i) => ({
        id: id(`a${String(i).padStart(2, '0')}`), user_id: id('U'), kind: 'summary', ref_id: 'r', title: `t${i}`, body: 'b',
        created_at: NOW + i, read_at: i < 3 ? NOW : null,
      })),
      { id: id('other'), user_id: id('O'), kind: 'flag', ref_id: 'r', title: 'theirs', body: 'b', created_at: NOW },
    ],
  });
  return { id };
}

describe('alerts routes', () => {
  it('GET /api/alerts returns my alerts, newest first, at most 50', async () => {
    const { id } = await seed('al');
    const { request } = makeApp();
    const res = await request('/api/alerts', { headers: authAs(id('U')) });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { id: string; kind: string; refId: string; title: string; body: string; readAt: number | null; createdAt: number }[] };
    expect(items).toHaveLength(50);
    expect(items[0]).toEqual({ id: id('a54'), kind: 'summary', refId: 'r', title: 't54', body: 'b', readAt: null, createdAt: NOW + 54 });
    expect(items.every((a) => a.id !== id('other'))).toBe(true);
    for (let i = 1; i < items.length; i++) expect(items[i - 1]!.createdAt).toBeGreaterThanOrEqual(items[i]!.createdAt);
  });

  it('GET /api/alerts?unread=1 returns only unread ones', async () => {
    const { id } = await seed('au');
    const { request } = makeApp();
    // Mark all but two read.
    await env.DB.prepare(`UPDATE alert SET read_at = ? WHERE user_id = ? AND id NOT IN (?, ?)`).bind(NOW, id('U'), id('a10'), id('a20')).run();
    const res = await request('/api/alerts?unread=1', { headers: authAs(id('U')) });
    const { items } = (await res.json()) as { items: { id: string }[] };
    expect(items.map((a) => a.id)).toEqual([id('a20'), id('a10')]);
  });

  it('POST /api/alerts/read marks only my own alerts and returns the count', async () => {
    const { id } = await seed('ar');
    const { request } = makeApp();
    const res = await request('/api/alerts/read', {
      method: 'POST',
      headers: { ...authAs(id('U')), 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id('a50'), id('a51'), id('a00'), id('other'), 'nope'] }),
    });
    expect(res.status).toBe(200);
    // a00 was already read: only a50 and a51 change.
    expect(await res.json()).toEqual({ updated: 2 });
    const rows = (await env.DB.prepare('SELECT id, read_at FROM alert WHERE id IN (?, ?, ?)').bind(id('a50'), id('a51'), id('other')).all<{ id: string; read_at: number | null }>()).results;
    expect(rows.find((r) => r.id === id('other'))!.read_at).toBeNull();
    expect(rows.filter((r) => r.id !== id('other')).every((r) => r.read_at != null)).toBe(true);
  });

  it('POST /api/alerts/read validates the body', async () => {
    const { id } = await seed('av');
    const { request } = makeApp();
    const res = await request('/api/alerts/read', {
      method: 'POST',
      headers: { ...authAs(id('U')), 'content-type': 'application/json' },
      body: JSON.stringify({ ids: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('requires sign-in', async () => {
    const { request } = makeApp();
    expect((await request('/api/alerts')).status).toBe(401);
  });
});
