import { Hono } from 'hono';
import { EnrollmentBody, OrgBody, OrgPatchBody, todayNoteExpiry } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError, readJson } from '../http';
import { caregiverChildIds, requireAdminOf, requireMemberOf } from '../auth/access';
import { createInvite } from '../lib/invites';
import { readyAvatarsByChild, type ReadyAvatar } from '../lib/readyAvatars';
import { newId } from '../lib/ids';
import { orgDayStart, orgMonthStart } from '../lib/orgTime';
import { forbidDemo, forbidDemoChange } from '../auth/demo';
import { MEDIA_URL_TTL_MS, signMediaUrl } from './media';

export const orgRoutes = new Hono<AppEnv>();

type OrgRow = { id: string; name: string; address: string | null; timezone: string; logo_key: string | null };
const orgView = async (env: Env, r: OrgRow) => ({
  id: r.id,
  name: r.name,
  address: r.address,
  timezone: r.timezone,
  logoKey: r.logo_key,
  /** Signed, 1 hour: the app shows the logo with this and never builds a media URL itself. */
  logoUrl: r.logo_key ? await signMediaUrl(env, r.logo_key, MEDIA_URL_TTL_MS) : null,
});

const KEY_TAIL = /^[A-Za-z0-9_-]{21}\.(jpg|png|webp)$/;
/** Logo keys are issued by the media route (Task 11) as `logo/<orgId>/<nanoid21>.<ext>`. */
function assertOwnLogoKey(key: string, orgId: string): void {
  const prefix = `logo/${orgId}/`;
  if (!key.startsWith(prefix) || !KEY_TAIL.test(key.slice(prefix.length))) throw apiError('INVALID', 'logoKey is not valid for this organization');
}

async function loadOrg(env: Env, orgId: string): Promise<OrgRow> {
  const org = await env.DB.prepare('SELECT id, name, address, timezone, logo_key FROM org WHERE id = ?').bind(orgId).first<OrgRow>();
  if (!org) throw apiError('NOT_FOUND', 'Organization not found');
  return org;
}

// ---- org ------------------------------------------------------------------------------------------------------

orgRoutes.post('/orgs', async (c) => {
  const body = OrgBody.parse(await readJson(c));
  const id = newId();
  // No logo on create: logo keys are logo/<orgId>/..., so the logo is uploaded and set with PATCH afterwards.
  const row: OrgRow = { id, name: body.name, address: body.address, timezone: body.timezone, logo_key: null };
  await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO org (id, name, logo_key, address, timezone) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, row.name, row.logo_key, row.address, row.timezone),
    c.env.DB.prepare(`INSERT INTO org_member (org_id, user_id, role) VALUES (?, ?, 'admin')`).bind(id, c.var.userId),
  ]);
  return c.json({ ...(await orgView(c.env, row)), role: 'admin' as const }, 201);
});

orgRoutes.get('/orgs/:id', async (c) => {
  const id = c.req.param('id');
  const role = await requireMemberOf(c.env, c.var.userId, id);
  return c.json({ ...(await orgView(c.env, await loadOrg(c.env, id))), role });
});

orgRoutes.patch('/orgs/:id', async (c) => {
  const id = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, id);
  const body = OrgPatchBody.parse(await readJson(c));
  forbidDemoChange(c, [[body.name, (await loadOrg(c.env, id)).name]]); // after the admin check: no probing
  if (body.logoKey) assertOwnLogoKey(body.logoKey, id);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) (sets.push('name = ?'), binds.push(body.name));
  if (body.address !== undefined) (sets.push('address = ?'), binds.push(body.address));
  if (body.timezone !== undefined) (sets.push('timezone = ?'), binds.push(body.timezone));
  if (body.logoKey !== undefined) (sets.push('logo_key = ?'), binds.push(body.logoKey));
  if (sets.length) await c.env.DB.prepare(`UPDATE org SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  return c.json({ ...(await orgView(c.env, await loadOrg(c.env, id))), role: 'admin' as const });
});

// ---- staff ----------------------------------------------------------------------------------------------------

orgRoutes.get('/orgs/:id/staff', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const [{ results: members }, { results: rooms }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT om.user_id, u.name, u.email, om.role, sp.user_id IS NOT NULL AS has_pin
         FROM org_member om
         LEFT JOIN user u ON u.id = om.user_id
         LEFT JOIN staff_pin sp ON sp.user_id = om.user_id AND sp.org_id = om.org_id
         WHERE om.org_id = ? ORDER BY om.role, u.name, om.user_id`,
      )
      .bind(orgId)
      .all<{ user_id: string; name: string | null; email: string | null; role: string; has_pin: number }>(),
    c.env.DB
      .prepare(
        `SELECT cs.user_id, cs.classroom_id FROM classroom_staff cs JOIN classroom cl ON cl.id = cs.classroom_id
         WHERE cl.org_id = ? ORDER BY cs.classroom_id`,
      )
      .bind(orgId)
      .all<{ user_id: string; classroom_id: string }>(),
  ]);
  return c.json({
    staff: members.map((m) => ({
      userId: m.user_id,
      name: m.name ?? '',
      email: m.email ?? '',
      role: m.role,
      hasPin: m.has_pin === 1,
      classroomIds: rooms.filter((r) => r.user_id === m.user_id).map((r) => r.classroom_id),
    })),
  });
});

/**
 * The shared tablet's "who's teaching?" list: names and whether a PIN exists, nothing else. Any org member may ask, but
 * only from a device registered to this org (so the list is not an org-wide directory for every teacher account).
 */
orgRoutes.get('/orgs/:id/staff/switch', async (c) => {
  const orgId = c.req.param('id');
  await requireMemberOf(c.env, c.var.userId, orgId);
  const deviceId = c.req.query('deviceId');
  const dev = deviceId ? await c.env.DB.prepare('SELECT 1 FROM device WHERE id = ? AND org_id = ?').bind(deviceId, orgId).first() : null;
  if (!dev) throw apiError('DEVICE_UNKNOWN', 'This device is not registered to this organization');
  const { results } = await c.env.DB
    .prepare(
      `SELECT om.user_id, u.name, sp.user_id IS NOT NULL AS has_pin
       FROM org_member om
       LEFT JOIN user u ON u.id = om.user_id
       LEFT JOIN staff_pin sp ON sp.user_id = om.user_id AND sp.org_id = om.org_id
       WHERE om.org_id = ? ORDER BY u.name, om.user_id`,
    )
    .bind(orgId)
    .all<{ user_id: string; name: string | null; has_pin: number }>();
  return c.json({ staff: results.map((m) => ({ userId: m.user_id, name: m.name ?? '', hasPin: m.has_pin === 1 })) });
});

orgRoutes.delete('/orgs/:id/staff/:userId', forbidDemo, async (c) => {
  const orgId = c.req.param('id');
  const target = c.req.param('userId');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const member = await c.env.DB.prepare('SELECT role FROM org_member WHERE org_id = ? AND user_id = ?').bind(orgId, target).first();
  if (!member) throw apiError('NOT_FOUND', 'Not a member of this organization');

  // One transaction: the member delete refuses the last admin; the cleanup runs only if the member row is gone.
  const gone = `NOT EXISTS (SELECT 1 FROM org_member WHERE org_id = ? AND user_id = ?)`;
  const [del] = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `DELETE FROM org_member WHERE org_id = ? AND user_id = ?
         AND (role <> 'admin' OR (SELECT COUNT(*) FROM org_member WHERE org_id = ? AND role = 'admin') > 1)`,
      )
      .bind(orgId, target, orgId),
    c.env.DB
      .prepare(`DELETE FROM classroom_staff WHERE user_id = ? AND classroom_id IN (SELECT id FROM classroom WHERE org_id = ?) AND ${gone}`)
      .bind(target, orgId, orgId, target),
    c.env.DB.prepare(`DELETE FROM staff_pin WHERE user_id = ? AND org_id = ? AND ${gone}`).bind(target, orgId, orgId, target),
  ]);
  if (del?.meta.changes !== 1) throw apiError('INVALID', 'An organization needs at least one admin');
  return c.json({ ok: true });
});

orgRoutes.post('/orgs/:id/invites/staff', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  return c.json(await createInvite(c.env, { type: 'staff', payload: { orgId }, createdBy: c.var.userId }));
});

// ---- enrollments ----------------------------------------------------------------------------------------------

type EnrollmentRow = {
  id: string;
  org_id: string;
  classroom_id: string;
  child_name: string;
  invite_code: string;
  child_id: string | null;
  status: 'invited' | 'linked';
  created_at: number;
};
const enrollmentView = (r: EnrollmentRow) => ({
  id: r.id,
  orgId: r.org_id,
  classroomId: r.classroom_id,
  childName: r.child_name,
  inviteCode: r.invite_code,
  childId: r.child_id,
  status: r.status,
  createdAt: r.created_at,
});

orgRoutes.post('/orgs/:id/enrollments', async (c) => {
  const orgId = c.req.param('id');
  const userId = c.var.userId;
  await requireAdminOf(c.env, userId, orgId);
  const body = EnrollmentBody.parse(await readJson(c));
  const cl = await c.env.DB.prepare('SELECT org_id FROM classroom WHERE id = ?').bind(body.classroomId).first<{ org_id: string }>();
  if (!cl || cl.org_id !== orgId) throw apiError('INVALID', 'classroomId is not a classroom of this organization');

  const id = newId();
  const { code, expiresAt } = await createInvite(c.env, { type: 'parent_enrollment', payload: { orgId, enrollmentId: id }, createdBy: userId });
  const row: EnrollmentRow = {
    id,
    org_id: orgId,
    classroom_id: body.classroomId,
    child_name: body.childName,
    invite_code: code,
    child_id: null,
    status: 'invited',
    created_at: Date.now(),
  };
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO enrollment (id, org_id, classroom_id, child_name, invite_code, child_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'invited', ?)`,
      )
      .bind(row.id, row.org_id, row.classroom_id, row.child_name, row.invite_code, row.created_at)
      .run();
  } catch (err) {
    await c.env.DB.prepare('DELETE FROM invite_code WHERE code = ? AND used_at IS NULL').bind(code).run();
    throw err;
  }
  return c.json({ enrollment: enrollmentView(row), code, expiresAt }, 201);
});

orgRoutes.get('/orgs/:id/enrollments', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, org_id, classroom_id, child_name, invite_code, child_id, status, created_at
       FROM enrollment WHERE org_id = ? ORDER BY created_at, id`,
    )
    .bind(orgId)
    .all<EnrollmentRow>();
  return c.json({ enrollments: results.map(enrollmentView) });
});

// ---- roster ---------------------------------------------------------------------------------------------------

type RosterTile = {
  enrollmentId: string;
  childId?: string;
  name: string;
  photoUrl?: string;
  status: 'invite_sent' | 'setup_pending' | 'ready';
  readyAvatars: ReadyAvatar[];
};

/**
 * Caregiver view: the shared tablet's acting teacher when present (actingMiddleware already validated the token
 * for this org), else the signed-in user. Admins see every enrollment; teachers only their staffed classrooms.
 */
orgRoutes.get('/orgs/:id/roster', async (c) => {
  const orgId = c.req.param('id');
  const viewer = c.var.actingUserId ?? c.var.userId;
  const role = await requireMemberOf(c.env, viewer, orgId);
  const classroomId = c.req.query('classroomId') || undefined;

  const { results: rows } = await c.env.DB
    .prepare(
      `SELECT e.id, e.classroom_id, e.child_name, e.child_id, ch.name AS child_display, ch.photo_key AS child_photo
       FROM enrollment e LEFT JOIN child ch ON ch.id = e.child_id
       WHERE e.org_id = ? AND (? IS NULL OR e.classroom_id = ?)
       ORDER BY e.created_at, e.id`,
    )
    .bind(orgId, classroomId ?? null, classroomId ?? null)
    .all<{ id: string; classroom_id: string; child_name: string; child_id: string | null; child_display: string | null; child_photo: string | null }>();

  const visibleChildren = new Set(await caregiverChildIds(c.env, viewer));
  let staffed: Set<string> | null = null; // null = admin, no classroom restriction
  if (role !== 'admin') {
    const { results } = await c.env.DB
      .prepare(`SELECT cs.classroom_id FROM classroom_staff cs JOIN classroom cl ON cl.id = cs.classroom_id WHERE cs.user_id = ? AND cl.org_id = ?`)
      .bind(viewer, orgId)
      .all<{ classroom_id: string }>();
    staffed = new Set(results.map((r) => r.classroom_id));
  }
  const visible = rows.filter(
    (r) => (staffed === null || staffed.has(r.classroom_id)) && (r.child_id === null || visibleChildren.has(r.child_id)),
  );

  const childIds = [...new Set(visible.map((r) => r.child_id).filter((x): x is string => x !== null))];
  const avatars = await readyAvatarsByChild(c.env, childIds);

  const photos = new Map<string, string>();
  for (const r of visible) if (r.child_id && r.child_photo) photos.set(r.child_id, await signMediaUrl(c.env, r.child_photo, MEDIA_URL_TTL_MS));

  const tiles: RosterTile[] = visible.map((r) => {
    if (r.child_id === null) return { enrollmentId: r.id, name: r.child_name, status: 'invite_sent', readyAvatars: [] };
    const readyAvatars = avatars.get(r.child_id) ?? [];
    return {
      enrollmentId: r.id,
      childId: r.child_id,
      name: r.child_display ?? r.child_name,
      ...(photos.has(r.child_id) ? { photoUrl: photos.get(r.child_id) } : {}),
      status: readyAvatars.length ? 'ready' : 'setup_pending',
      readyAvatars,
    };
  });
  return c.json({ tiles });
});

// ---- dashboard + flags ----------------------------------------------------------------------------------------

/** Sessions the dashboard counts: real comfort calls only (no test calls, no failed starts). Cost still sums everything. */
const COUNTED = `kind = 'child' AND status != 'failed'`;

orgRoutes.get('/orgs/:id/dashboard', async (c) => {
  const orgId = c.req.param('id');
  await requireAdminOf(c.env, c.var.userId, orgId);
  const org = await loadOrg(c.env, orgId);
  const now = Date.now();
  const dayStart = orgDayStart(org.timezone, now);
  const dayEnd = todayNoteExpiry(org.timezone, now);
  const monthStart = orgMonthStart(org.timezone, now);

  const [ready, today, month, flags] = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `SELECT COUNT(DISTINCT cn.child_id) AS n
         FROM connection cn JOIN child ch ON ch.id = cn.child_id
         WHERE cn.kind = 'daycare' AND cn.org_id = ?
           AND EXISTS (SELECT 1 FROM family_member fm JOIN avatar a ON a.user_id = fm.user_id AND a.status = 'approved'
                       WHERE fm.family_id = ch.family_id)`,
      )
      .bind(orgId),
    c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM comfort_session WHERE org_id = ? AND started_at >= ? AND started_at < ? AND ${COUNTED}`)
      .bind(orgId, dayStart, dayEnd),
    c.env.DB
      .prepare(
        `SELECT COUNT(CASE WHEN ${COUNTED} THEN 1 END) AS n, COALESCE(SUM(cost_usd), 0) AS cost
         FROM comfort_session WHERE org_id = ? AND started_at >= ? AND started_at < ?`,
      )
      .bind(orgId, monthStart, dayEnd),
    c.env.DB
      .prepare(
        `SELECT f.id, f.session_id, ch.name AS child_name, f.category, f.quote, f.severity, f.created_at
         FROM session_flag f
         JOIN comfort_session s ON s.id = f.session_id
         LEFT JOIN child ch ON ch.id = s.child_id
         WHERE s.org_id = ? AND f.acknowledged_at IS NULL
         ORDER BY f.created_at DESC, f.id LIMIT 200`,
      )
      .bind(orgId),
  ]);
  const one = (r: D1Result | undefined) => (r?.results[0] ?? {}) as { n?: number; cost?: number };
  type FlagRow = { id: string; session_id: string; child_name: string | null; category: string; quote: string | null; severity: string; created_at: number };
  return c.json({
    readyCount: one(ready).n ?? 0,
    todaySessions: one(today).n ?? 0,
    openFlags: ((flags?.results ?? []) as FlagRow[]).map((f) => ({
      id: f.id,
      sessionId: f.session_id,
      childName: f.child_name ?? '',
      category: f.category,
      quote: f.quote,
      severity: f.severity,
      createdAt: f.created_at,
    })),
    monthSessions: one(month).n ?? 0,
    monthCostUsd: Math.round((one(month).cost ?? 0) * 100) / 100,
  });
});

orgRoutes.post('/flags/:id/ack', async (c) => {
  const id = c.req.param('id');
  const flag = await c.env.DB
    .prepare('SELECT f.id, s.org_id FROM session_flag f JOIN comfort_session s ON s.id = f.session_id WHERE f.id = ?')
    .bind(id)
    .first<{ id: string; org_id: string | null }>();
  if (!flag) throw apiError('NOT_FOUND', 'Flag not found');
  if (!flag.org_id) throw apiError('FORBIDDEN', 'Not a daycare flag');
  await requireAdminOf(c.env, c.var.userId, flag.org_id);
  await c.env.DB
    .prepare('UPDATE session_flag SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL')
    .bind(c.var.userId, Date.now(), id)
    .run();
  return c.json({ ok: true });
});
