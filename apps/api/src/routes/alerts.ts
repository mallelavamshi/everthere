import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { readJson } from '../http';

export const ALERTS_PAGE = 50;
// D1 allows 100 bound parameters per statement (2 are used by read_at and user_id).
const MAX_READ_IDS = 90;

type AlertRow = { id: string; kind: string; ref_id: string | null; title: string; body: string | null; read_at: number | null; created_at: number };

const view = (a: AlertRow) => ({
  id: a.id,
  kind: a.kind,
  refId: a.ref_id,
  title: a.title,
  body: a.body,
  readAt: a.read_at,
  createdAt: a.created_at,
});

const ReadBody = z.object({ ids: z.array(z.string().min(1).max(64)).max(MAX_READ_IDS) });

/** The signed-in user's own alerts. Always the real user (c.var.userId), never an acting teacher. */
export const alertRoutes = new Hono<AppEnv>();

alertRoutes.get('/alerts', async (c) => {
  const unread = c.req.query('unread') === '1';
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, kind, ref_id, title, body, read_at, created_at FROM alert
       WHERE user_id = ?${unread ? ' AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ${ALERTS_PAGE}`,
    )
    .bind(c.var.userId)
    .all<AlertRow>();
  return c.json({ items: results.map(view) });
});

alertRoutes.post('/alerts/read', async (c) => {
  const { ids } = ReadBody.parse(await readJson(c));
  const unique = [...new Set(ids)];
  if (!unique.length) return c.json({ updated: 0 });
  // Only the caller's own unread alerts change; ids belonging to anyone else are silently ignored.
  const res = await c.env.DB
    .prepare(`UPDATE alert SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${unique.map(() => '?').join(',')})`)
    .bind(Date.now(), c.var.userId, ...unique)
    .run();
  return c.json({ updated: res.meta.changes ?? 0 });
});
