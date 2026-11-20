import type { Env } from '../env';
import { apiError } from '../http';

type E = Pick<Env, 'DB'>;

/**
 * Access control. Every predicate is deny-by-default and evaluated against D1 on each call (no caching),
 * so removing a classroom_staff / connection / family_member row takes effect immediately.
 *
 * Caregiver paths for a (user, child) pair:
 *  - teacher: classroom_staff -> classroom -> classroom_child(child), AND an org_member row (teacher/admin) in that
 *    classroom's org (defense in depth against stale classroom_staff), AND a daycare connection of the child
 *    to that same classroom's org;
 *  - admin:   org_member(role=admin) of an org the child has a daycare connection to;
 *  - home:    connection(kind='home', caregiver_user_id = user).
 */

// Each SELECT yields (child_id, org_id, ta = transcript_access, kind) for one caregiver path; `?` = user id.
const TEACHER_PATH = `
  SELECT cc.child_id AS child_id, cn.org_id AS org_id, cn.transcript_access AS ta, 'daycare' AS kind
  FROM classroom_staff cs
  JOIN classroom cl ON cl.id = cs.classroom_id
  JOIN classroom_child cc ON cc.classroom_id = cl.id
  JOIN connection cn ON cn.child_id = cc.child_id AND cn.kind = 'daycare' AND cn.org_id = cl.org_id
  JOIN org_member om ON om.org_id = cl.org_id AND om.user_id = cs.user_id AND om.role IN ('teacher', 'admin')
  WHERE cs.user_id = ?`;
const ADMIN_PATH = `
  SELECT cn.child_id AS child_id, cn.org_id AS org_id, cn.transcript_access AS ta, 'daycare' AS kind
  FROM org_member om
  JOIN connection cn ON cn.org_id = om.org_id AND cn.kind = 'daycare'
  WHERE om.user_id = ? AND om.role = 'admin'`;
const HOME_PATH = `
  SELECT cn.child_id AS child_id, NULL AS org_id, cn.transcript_access AS ta, 'home' AS kind
  FROM connection cn
  WHERE cn.caregiver_user_id = ? AND cn.kind = 'home'`;
const CAREGIVER_PATHS = `${TEACHER_PATH} UNION ALL ${ADMIN_PATH} UNION ALL ${HOME_PATH}`;

async function exists(env: E, sql: string, ...binds: unknown[]): Promise<boolean> {
  const row = await env.DB.prepare(sql).bind(...binds).first();
  return row != null;
}

export function isParentOf(env: E, userId: string, childId: string): Promise<boolean> {
  return exists(
    env,
    `SELECT 1 FROM child c JOIN family_member fm ON fm.family_id = c.family_id
     WHERE c.id = ? AND fm.user_id = ? LIMIT 1`,
    childId,
    userId,
  );
}

export function isAdminOf(env: E, userId: string, orgId: string): Promise<boolean> {
  return exists(env, `SELECT 1 FROM org_member WHERE org_id = ? AND user_id = ? AND role = 'admin' LIMIT 1`, orgId, userId);
}

export type OrgRole = 'admin' | 'teacher';

/** The user's role in the org, or null when not a member. */
export async function memberRole(env: E, userId: string, orgId: string): Promise<OrgRole | null> {
  const row = await env.DB
    .prepare('SELECT role FROM org_member WHERE org_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .first<{ role: OrgRole }>();
  return row?.role ?? null;
}

export async function isMemberOf(env: E, userId: string, orgId: string): Promise<boolean> {
  return (await memberRole(env, userId, orgId)) !== null;
}

/** Sorted, de-duplicated ids of every child this user cares for (teacher, admin or home caregiver). */
export async function caregiverChildIds(env: E, userId: string): Promise<string[]> {
  const { results } = await env.DB
    .prepare(`SELECT DISTINCT child_id FROM (${CAREGIVER_PATHS}) ORDER BY child_id`)
    .bind(userId, userId, userId)
    .all<{ child_id: string }>();
  return results.map((r) => r.child_id);
}

async function isCaregiverOf(env: E, userId: string, childId: string): Promise<boolean> {
  return exists(env, `SELECT 1 FROM (${CAREGIVER_PATHS}) WHERE child_id = ? LIMIT 1`, userId, userId, userId, childId);
}

export async function canViewChild(env: E, userId: string, childId: string): Promise<boolean> {
  return (await isParentOf(env, userId, childId)) || (await isCaregiverOf(env, userId, childId));
}

function isApprovedFamilyAvatar(env: E, childId: string, avatarId: string): Promise<boolean> {
  return exists(
    env,
    `SELECT 1 FROM avatar a
     JOIN child c ON c.id = ?
     JOIN family_member fm ON fm.family_id = c.family_id AND fm.user_id = a.user_id
     WHERE a.id = ? AND a.status = 'approved' LIMIT 1`,
    childId,
    avatarId,
  );
}

/** Caregiver of the child + approved avatar owned by a parent in the child's family. */
export async function canStartSession(env: E, userId: string, childId: string, avatarId: string): Promise<boolean> {
  if (!(await isCaregiverOf(env, userId, childId))) return false;
  return isApprovedFamilyAvatar(env, childId, avatarId);
}

/** Teacher/admin paths only (both already require a daycare connection of the child to the path's org). */
const DAYCARE_PATHS = `${TEACHER_PATH} UNION ALL ${ADMIN_PATH}`;

/**
 * For a teacher acting on a shared tablet of `orgId`: like canStartSession, but the child must be reached through
 * that org (teacher of one of its classrooms, or its admin) with a daycare connection to it. The home path and
 * other orgs never count, so a tablet can't reach the teacher's home-caregiver children or another org's children.
 */
export async function canStartSessionInOrg(env: E, userId: string, childId: string, avatarId: string, orgId: string): Promise<boolean> {
  if (!(await canViewChildInOrg(env, userId, childId, orgId))) return false;
  return isApprovedFamilyAvatar(env, childId, avatarId);
}

/** The user reaches the child as teacher/admin of `orgId` (daycare path only). */
export function canViewChildInOrg(env: E, userId: string, childId: string, orgId: string): Promise<boolean> {
  return exists(env, `SELECT 1 FROM (${DAYCARE_PATHS}) WHERE child_id = ? AND org_id = ? LIMIT 1`, userId, userId, childId, orgId);
}

/** Org of the user's daycare path (teacher/admin) to the child, or null (home caregiver only / no access). */
export async function daycareOrgOf(env: E, userId: string, childId: string): Promise<string | null> {
  const row = await env.DB
    .prepare(`SELECT org_id FROM (${DAYCARE_PATHS}) WHERE child_id = ? ORDER BY org_id LIMIT 1`)
    .bind(userId, userId, childId)
    .first<{ org_id: string }>();
  return row?.org_id ?? null;
}

type SessionRow = { child_id: string | null; org_id: string | null; kind: string; avatar_owner: string | null };

async function loadSession(env: E, sessionId: string): Promise<SessionRow | null> {
  return env.DB
    .prepare(
      `SELECT s.child_id, s.org_id, s.kind, a.user_id AS avatar_owner
       FROM comfort_session s LEFT JOIN avatar a ON a.id = s.avatar_id WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<SessionRow>();
}

export async function canReadTranscript(env: E, userId: string, sessionId: string): Promise<boolean> {
  const s = await loadSession(env, sessionId);
  if (!s) return false;
  if (s.kind === 'test') return s.avatar_owner === userId; // test sessions: avatar owner only
  if (!s.child_id) return false;
  if (await isParentOf(env, userId, s.child_id)) return true;
  // Daycare staff: flag on the daycare connection for this session's child + org. Home: the caregiver's own
  // connection, and only for home sessions (org_id NULL): a nanny's flag never opens the child's daycare sessions.
  return exists(
    env,
    `SELECT 1 FROM (${CAREGIVER_PATHS})
     WHERE child_id = ? AND ta = 1
       AND ((kind = 'daycare' AND org_id = ?) OR (kind = 'home' AND ? IS NULL)) LIMIT 1`,
    userId,
    userId,
    userId,
    s.child_id,
    s.org_id,
    s.org_id,
  );
}

export async function canSeeSummary(env: E, userId: string, sessionId: string): Promise<boolean> {
  const s = await loadSession(env, sessionId);
  if (!s) return false;
  if (s.kind === 'test') return s.avatar_owner === userId;
  if (!s.child_id) return false;
  return canViewChild(env, userId, s.child_id);
}

function forbid(msg: string): never {
  throw apiError('FORBIDDEN', msg);
}

export async function requireParentOf(env: E, userId: string, childId: string): Promise<void> {
  if (!(await isParentOf(env, userId, childId))) forbid('Not a parent of this child');
}
export async function requireAdminOf(env: E, userId: string, orgId: string): Promise<void> {
  if (!(await isAdminOf(env, userId, orgId))) forbid('Not an admin of this organization');
}
export async function requireMemberOf(env: E, userId: string, orgId: string): Promise<OrgRole> {
  const role = await memberRole(env, userId, orgId);
  if (!role) forbid('Not a member of this organization');
  return role;
}
export async function requireViewChild(env: E, userId: string, childId: string): Promise<void> {
  if (!(await canViewChild(env, userId, childId))) forbid('No access to this child');
}
export async function requireStartSession(env: E, userId: string, childId: string, avatarId: string): Promise<void> {
  if (!(await canStartSession(env, userId, childId, avatarId))) forbid('Cannot start a session for this child');
}
export async function requireReadTranscript(env: E, userId: string, sessionId: string): Promise<void> {
  if (!(await canReadTranscript(env, userId, sessionId))) forbid('No access to this transcript');
}
export async function requireSeeSummary(env: E, userId: string, sessionId: string): Promise<void> {
  if (!(await canSeeSummary(env, userId, sessionId))) forbid('No access to this session');
}
