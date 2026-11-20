import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { apiError } from '../http';
import { canViewChildInOrg, caregiverChildIds, requireParentOf } from '../auth/access';
import { readyAvatarsByChild } from '../lib/readyAvatars';
import { MEDIA_URL_TTL_MS, signMediaUrl } from './media';
import { forbidDemo } from '../auth/demo';

const AccessBody = z.object({ transcriptAccess: z.boolean() });

export const caregiverRoutes = new Hono<AppEnv>();

/**
 * Children the caller looks after, in the roster tile shape, for caregivers with no classroom (a home nanny).
 * Effective user = the acting teacher on a shared tablet, else the signed-in user; an acting tablet only ever reaches
 * children through its own org.
 */
caregiverRoutes.get('/caregiver/children', async (c) => {
  const viewer = c.var.actingUserId ?? c.var.userId;
  let ids = await caregiverChildIds(c.env, viewer);
  if (c.var.actingUserId) {
    // Acting is always set together with its org; without one, fail closed rather than fall back to everything.
    const actingOrg = c.var.actingOrgId;
    if (!actingOrg) return c.json({ children: [] });
    ids = (await Promise.all(ids.map(async (id) => ((await canViewChildInOrg(c.env, viewer, id, actingOrg)) ? id : null)))).filter((x): x is string => x !== null);
  }
  if (!ids.length) return c.json({ children: [] });

  const [{ results: kids }, avatars, { results: parents }] = await Promise.all([
    c.env.DB
      .prepare('SELECT id, name, photo_key, family_id FROM child WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name, id')
      .bind(JSON.stringify(ids))
      .all<{ id: string; name: string; photo_key: string | null; family_id: string }>(),
    readyAvatarsByChild(c.env, ids),
    c.env.DB
      .prepare(
        `SELECT fm.family_id, u.name FROM family_member fm JOIN user u ON u.id = fm.user_id
         WHERE fm.family_id IN (SELECT family_id FROM child WHERE id IN (SELECT value FROM json_each(?))) ORDER BY fm.family_id, u.name`,
      )
      .bind(JSON.stringify(ids))
      .all<{ family_id: string; name: string }>(),
  ]);
  const children = await Promise.all(
    kids.map(async (k) => {
      const last = parents.find((p) => p.family_id === k.family_id)?.name.trim().split(/\s+/).slice(-1)[0];
      return {
        id: k.id,
        name: k.name,
        ...(k.photo_key ? { photoUrl: await signMediaUrl(c.env, k.photo_key, MEDIA_URL_TTL_MS) } : {}),
        readyAvatars: avatars.get(k.id) ?? [],
        familyLabel: last ? `${last} family` : 'Family',
      };
    }),
  );
  return c.json({ children });
});

type ConnRow = { id: string; kind: 'daycare' | 'home'; org_id: string | null; caregiver_user_id: string | null; transcript_access: number };

caregiverRoutes.get('/children/:id/caregivers', async (c) => {
  const id = c.req.param('id');
  await requireParentOf(c.env, c.var.userId, id);
  const { results: conns } = await c.env.DB
    .prepare('SELECT id, kind, org_id, caregiver_user_id, transcript_access FROM connection WHERE child_id = ? ORDER BY id')
    .bind(id)
    .all<ConnRow>();

  let daycare:
    | { connectionId: string; org: { id: string; name: string }; teachers: { userId: string; name: string }[]; transcriptAccess: boolean }
    | undefined;
  const home: { connectionId: string; userId: string; name: string; transcriptAccess: boolean }[] = [];

  for (const cn of conns) {
    if (cn.kind === 'daycare' && cn.org_id && !daycare) {
      const org = await c.env.DB.prepare('SELECT id, name FROM org WHERE id = ?').bind(cn.org_id).first<{ id: string; name: string }>();
      if (!org) continue;
      const { results: teachers } = await c.env.DB
        .prepare(
          `SELECT DISTINCT u.id AS userId, u.name AS name
           FROM classroom_child cc
           JOIN classroom cl ON cl.id = cc.classroom_id AND cl.org_id = ?
           JOIN classroom_staff cs ON cs.classroom_id = cl.id
           JOIN user u ON u.id = cs.user_id
           WHERE cc.child_id = ? ORDER BY u.name, u.id`,
        )
        .bind(org.id, id)
        .all<{ userId: string; name: string }>();
      daycare = { connectionId: cn.id, org, teachers, transcriptAccess: cn.transcript_access === 1 };
    } else if (cn.kind === 'home' && cn.caregiver_user_id) {
      const u = await c.env.DB.prepare('SELECT name FROM user WHERE id = ?').bind(cn.caregiver_user_id).first<{ name: string }>();
      home.push({ connectionId: cn.id, userId: cn.caregiver_user_id, name: u?.name ?? '', transcriptAccess: cn.transcript_access === 1 });
    }
  }
  return c.json(daycare ? { daycare, home } : { home });
});

async function loadConnection(env: AppEnv['Bindings'], childId: string, connectionId: string): Promise<ConnRow> {
  const cn = await env.DB
    .prepare('SELECT id, kind, org_id, caregiver_user_id, transcript_access FROM connection WHERE id = ? AND child_id = ?')
    .bind(connectionId, childId)
    .first<ConnRow>();
  if (!cn) throw apiError('NOT_FOUND', 'Connection not found');
  return cn;
}

caregiverRoutes.patch('/children/:id/caregivers/:connectionId', async (c) => {
  const id = c.req.param('id');
  await requireParentOf(c.env, c.var.userId, id);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw apiError('INVALID', 'Invalid JSON body');
  }
  const body = AccessBody.parse(raw);
  const cn = await loadConnection(c.env, id, c.req.param('connectionId'));
  await c.env.DB
    .prepare('UPDATE connection SET transcript_access = ? WHERE id = ?')
    .bind(body.transcriptAccess ? 1 : 0, cn.id)
    .run();
  return c.json({ connectionId: cn.id, transcriptAccess: body.transcriptAccess });
});

caregiverRoutes.delete('/children/:id/caregivers/:connectionId', forbidDemo, async (c) => {
  const id = c.req.param('id');
  await requireParentOf(c.env, c.var.userId, id);
  const cn = await loadConnection(c.env, id, c.req.param('connectionId'));
  const stmts = [c.env.DB.prepare('DELETE FROM connection WHERE id = ?').bind(cn.id)];
  if (cn.kind === 'daycare' && cn.org_id) {
    // Unlink the child from that daycare's classrooms and enrollment so no stale link outlives the connection.
    stmts.push(
      c.env.DB
        .prepare('DELETE FROM classroom_child WHERE child_id = ? AND classroom_id IN (SELECT id FROM classroom WHERE org_id = ?)')
        .bind(id, cn.org_id),
      c.env.DB
        .prepare(`UPDATE enrollment SET child_id = NULL, status = 'invited' WHERE child_id = ? AND org_id = ?`)
        .bind(id, cn.org_id),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
