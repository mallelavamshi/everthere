import { Hono } from 'hono';
import { ClassroomBody, ClassroomPatchBody, ClassroomStaffBody } from '@everthere/shared';
import type { AppEnv } from '../env';
import { apiError, readJson } from '../http';
import { requireAdminOf, requireMemberOf } from '../auth/access';
import { newId } from '../lib/ids';

export const classroomRoutes = new Hono<AppEnv>();

// The classroom table has a single `emoji` column; curated art is stored there as `asset:<assetKey>`.
const ASSET_PREFIX = 'asset:';
type ClassroomRow = { id: string; org_id: string; name: string; emoji: string | null };

function view(r: ClassroomRow, staffUserIds: string[]) {
  const isAsset = r.emoji?.startsWith(ASSET_PREFIX) ?? false;
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    emoji: isAsset ? null : r.emoji,
    assetKey: isAsset ? r.emoji!.slice(ASSET_PREFIX.length) : null,
    staffUserIds,
  };
}

classroomRoutes.get('/orgs/:id/classrooms', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const [{ results: rooms }, { results: staff }] = await Promise.all([
    c.env.DB.prepare('SELECT id, org_id, name, emoji FROM classroom WHERE org_id = ? ORDER BY name, id').bind(orgId).all<ClassroomRow>(),
    c.env.DB
      .prepare(
        `SELECT cs.classroom_id, cs.user_id FROM classroom_staff cs JOIN classroom cl ON cl.id = cs.classroom_id
         WHERE cl.org_id = ? ORDER BY cs.user_id`,
      )
      .bind(orgId)
      .all<{ classroom_id: string; user_id: string }>(),
  ]);
  return c.json({
    classrooms: rooms.map((r) => view(r, staff.filter((s) => s.classroom_id === r.id).map((s) => s.user_id))),
  });
});

/**
 * The classrooms the caller works in: the acting teacher on a shared tablet when there is one, else the signed-in user.
 * Admins see every classroom of the org. (GET /orgs/:id/classrooms stays admin-only and also lists staff.)
 */
classroomRoutes.get('/orgs/:id/my-classrooms', async (c) => {
  const orgId = c.req.param('id');
  const viewer = c.var.actingUserId ?? c.var.userId;
  const role = await requireMemberOf(c.env, viewer, orgId);
  const sql =
    role === 'admin'
      ? 'SELECT id, org_id, name, emoji FROM classroom WHERE org_id = ? ORDER BY name, id'
      : `SELECT cl.id, cl.org_id, cl.name, cl.emoji FROM classroom cl JOIN classroom_staff cs ON cs.classroom_id = cl.id AND cs.user_id = ?2
         WHERE cl.org_id = ?1 ORDER BY cl.name, cl.id`;
  const stmt = c.env.DB.prepare(sql);
  const { results } = await (role === 'admin' ? stmt.bind(orgId) : stmt.bind(orgId, viewer)).all<ClassroomRow>();
  return c.json({ classrooms: results.map((r) => view(r, [])) });
});

classroomRoutes.post('/orgs/:id/classrooms', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const body = ClassroomBody.parse(await readJson(c));
  if (body.emoji?.startsWith(ASSET_PREFIX)) throw apiError('INVALID', 'emoji is not valid');
  const row: ClassroomRow = {
    id: newId(),
    org_id: orgId,
    name: body.name,
    emoji: body.assetKey !== undefined ? `${ASSET_PREFIX}${body.assetKey}` : body.emoji!,
  };
  await c.env.DB
    .prepare('INSERT INTO classroom (id, org_id, name, emoji) VALUES (?, ?, ?, ?)')
    .bind(row.id, row.org_id, row.name, row.emoji)
    .run();
  return c.json(view(row, []), 201);
});

/** Rename and/or re-badge a classroom. Admin of the classroom's org only. */
classroomRoutes.patch('/classrooms/:id', async (c) => {
  const id = c.req.param('id');
  const cl = await c.env.DB.prepare('SELECT id, org_id, name, emoji FROM classroom WHERE id = ?').bind(id).first<ClassroomRow>();
  if (!cl) throw apiError('NOT_FOUND', 'Classroom not found');
  await requireAdminOf(c.env, c.var.userId, cl.org_id);
  const body = ClassroomPatchBody.parse(await readJson(c));
  if (body.emoji?.startsWith(ASSET_PREFIX)) throw apiError('INVALID', 'emoji is not valid');
  const next: ClassroomRow = {
    ...cl,
    name: body.name ?? cl.name,
    emoji: body.assetKey !== undefined ? `${ASSET_PREFIX}${body.assetKey}` : (body.emoji ?? cl.emoji),
  };
  await c.env.DB.prepare('UPDATE classroom SET name = ?, emoji = ? WHERE id = ?').bind(next.name, next.emoji, id).run();
  const { results } = await c.env.DB.prepare('SELECT user_id FROM classroom_staff WHERE classroom_id = ? ORDER BY user_id').bind(id).all<{ user_id: string }>();
  return c.json(view(next, results.map((r) => r.user_id)));
});

/** Replace the classroom's staff set. Admin of the classroom's org; every user must be a member of that org. */
classroomRoutes.put('/classrooms/:id/staff', async (c) => {
  const id = c.req.param('id');
  const cl = await c.env.DB.prepare('SELECT id, org_id FROM classroom WHERE id = ?').bind(id).first<{ id: string; org_id: string }>();
  if (!cl) throw apiError('NOT_FOUND', 'Classroom not found');
  await requireAdminOf(c.env, c.var.userId, cl.org_id);
  const userIds = [...new Set(ClassroomStaffBody.parse(await readJson(c)).userIds)].sort();

  const { results: members } = await c.env.DB
    .prepare('SELECT user_id FROM org_member WHERE org_id = ? AND user_id IN (SELECT value FROM json_each(?))')
    .bind(cl.org_id, JSON.stringify(userIds))
    .all<{ user_id: string }>();
  if (members.length !== userIds.length) throw apiError('INVALID', 'Every staff member must belong to this organization');

  // Inserts re-check membership inside the transaction so a concurrent staff removal cannot be undone here.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM classroom_staff WHERE classroom_id = ?').bind(id),
    ...userIds.map((u) =>
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO classroom_staff (classroom_id, user_id)
           SELECT ?, ? WHERE EXISTS (SELECT 1 FROM org_member WHERE org_id = ? AND user_id = ?)`,
        )
        .bind(id, u, cl.org_id, u),
    ),
  ]);
  return c.json({ classroomId: id, userIds });
});
