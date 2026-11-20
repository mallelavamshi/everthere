import { Hono } from 'hono';
import { PlanBody, todayNoteExpiry } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError, readJson } from '../http';
import { isParentOf } from '../auth/access';
import { fetchPlan, planView, type PlanRow } from '../services/plans';

type Ctx = { child: { id: string; timezone: string }; avatar: { id: string; parent_title: string } };

/**
 * Caller must be a parent of the child, and the avatar's owner must be in the child's family.
 * Anything else is NOT_FOUND (no existence leak).
 */
async function load(env: Env, userId: string, childId: string, avatarId: string): Promise<Ctx> {
  const nf = () => apiError('NOT_FOUND', 'Plan not found');
  if (!(await isParentOf(env, userId, childId))) throw nf();
  const row = await env.DB
    .prepare(
      `SELECT c.id AS child_id, c.timezone AS tz, a.id AS avatar_id, a.parent_title AS parent_title
       FROM child c
       JOIN avatar a ON a.id = ?
       JOIN family_member fm ON fm.family_id = c.family_id AND fm.user_id = a.user_id
       WHERE c.id = ? LIMIT 1`,
    )
    .bind(avatarId, childId)
    .first<{ child_id: string; tz: string; avatar_id: string; parent_title: string }>();
  if (!row) throw nf();
  return { child: { id: row.child_id, timezone: row.tz }, avatar: { id: row.avatar_id, parent_title: row.parent_title } };
}

const view = (ctx: Ctx, p: PlanRow | null, now: number) =>
  planView({ childId: ctx.child.id, avatarId: ctx.avatar.id, parentTitle: ctx.avatar.parent_title }, p, now);

export const planRoutes = new Hono<AppEnv>();

planRoutes.get('/children/:childId/plans/:avatarId', async (c) => {
  const ctx = await load(c.env, c.var.userId, c.req.param('childId'), c.req.param('avatarId'));
  return c.json(view(ctx, await fetchPlan(c.env, ctx.child.id, ctx.avatar.id), Date.now()));
});

planRoutes.put('/children/:childId/plans/:avatarId', async (c) => {
  const ctx = await load(c.env, c.var.userId, c.req.param('childId'), c.req.param('avatarId'));
  const b = PlanBody.parse(await readJson(c));
  const now = Date.now();
  const note = b.todayNote?.trim() || null;
  const expires = note ? todayNoteExpiry(ctx.child.timezone, now) : null;
  // No Napster call here: the agent only carries the persona and rules. Child specifics (this plan) are
  // sent per session in externalClientProfile, so saving a plan never needs to patch the agent.
  await c.env.DB
    .prepare(
      `INSERT INTO comfort_plan (child_id, avatar_id, parent_title, nicknames, tone, favorites, phrases, song_title, song_lyrics,
                                 never_topics, today_note, today_note_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (child_id, avatar_id) DO UPDATE SET
         parent_title = COALESCE(?, comfort_plan.parent_title),
         nicknames = excluded.nicknames, tone = excluded.tone, favorites = excluded.favorites, phrases = excluded.phrases,
         song_title = excluded.song_title, song_lyrics = excluded.song_lyrics, never_topics = excluded.never_topics,
         today_note = excluded.today_note, today_note_expires_at = excluded.today_note_expires_at`,
    )
    .bind(
      ctx.child.id, ctx.avatar.id, b.parentTitle ?? ctx.avatar.parent_title,
      JSON.stringify(b.nicknames), b.tone, JSON.stringify(b.favorites), JSON.stringify(b.phrases),
      b.songTitle?.trim() || null, b.songLyrics?.trim() || null, JSON.stringify(b.neverTopics), note, expires,
      b.parentTitle ?? null,
    )
    .run();
  return c.json(view(ctx, await fetchPlan(c.env, ctx.child.id, ctx.avatar.id), now));
});
