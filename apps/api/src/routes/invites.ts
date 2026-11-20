import { Hono } from 'hono';
import { InviteCodeBody, InviteCreateBody, InviteRedeemBody } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError } from '../http';
import { isParentOf } from '../auth/access';
import { assertPinFormat, hashPin } from '../auth/acting';
import { createInvite, loadLiveInvite, newId, normalizeCode, peekInvite } from '../lib/invites';
import { hitRateLimit } from '../services/demo';

export const inviteRoutes = new Hono<AppEnv>();

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw apiError('INVALID', 'Invalid JSON body');
  }
}

// Parent-only creation of co_parent / home_caregiver invites. Staff and enrollment invites are admin-created (Task 10).
inviteRoutes.post('/invites', async (c) => {
  const userId = c.var.userId;
  const body = InviteCreateBody.parse(await readJson(c));

  const member = await c.env.DB
    .prepare('SELECT 1 FROM family_member WHERE family_id = ? AND user_id = ?')
    .bind(body.familyId, userId)
    .first();
  if (!member) throw apiError('FORBIDDEN', 'Not a parent in this family');

  if (body.type === 'co_parent') {
    return c.json(await createInvite(c.env, { type: 'co_parent', payload: { familyId: body.familyId }, createdBy: userId }));
  }

  const childIds = [...new Set(body.childIds)];
  for (const childId of childIds) {
    const ch = await c.env.DB.prepare('SELECT family_id FROM child WHERE id = ?').bind(childId).first<{ family_id: string }>();
    if (!ch || ch.family_id !== body.familyId || !(await isParentOf(c.env, userId, childId))) {
      throw apiError('FORBIDDEN', 'Not a parent of this child');
    }
  }
  return c.json(
    await createInvite(c.env, { type: 'home_caregiver', payload: { familyId: body.familyId, childIds }, createdBy: userId }),
  );
});

/** Peek and redeem share one budget per signed-in user, so invite codes can't be guessed by brute force. */
export const INVITE_TRY_LIMIT = 10;
export const INVITE_TRY_WINDOW_MS = 60_000;

async function limitInviteTries(env: Env, userId: string): Promise<void> {
  if (!(await hitRateLimit(env, `invite-try:${userId}`, INVITE_TRY_LIMIT, INVITE_TRY_WINDOW_MS))) {
    throw apiError('RATE_LIMITED', 'Too many tries. Please wait a minute and try again.');
  }
}

inviteRoutes.post('/invites/peek', async (c) => {
  await limitInviteTries(c.env, c.var.userId);
  const { code } = InviteCodeBody.parse(await readJson(c));
  return c.json(await peekInvite(c.env, code));
});

inviteRoutes.post('/invites/redeem', async (c) => {
  const userId = c.var.userId;
  await limitInviteTries(c.env, userId);
  const body = InviteRedeemBody.parse(await readJson(c));
  const code = normalizeCode(body.code);

  const inv = await loadLiveInvite(c.env, code);
  if (inv.created_by === userId) throw apiError('INVITE_INVALID', 'You cannot redeem your own invite');
  // Invites never cross the demo boundary: a real account can't join the demo world, nor a demo account a real one.
  const creator = await c.env.DB.prepare('SELECT is_demo FROM user WHERE id = ?').bind(inv.created_by).first<{ is_demo: number }>();
  if ((creator?.is_demo ?? 0) !== (c.var.me.isDemo ?? 0)) throw apiError('INVITE_INVALID', 'Invite code is not valid');

  const now = Date.now();
  // Every effect statement is guarded by "this user holds the claim", so they all no-op if the claim loses the race.
  // The per-request nonce identifies this request's claim even when another request (same user, same ms) lost it.
  const nonce = newId();
  const G = `EXISTS (SELECT 1 FROM invite_code WHERE code = ? AND claim_nonce = ?)`;
  const g = [code, nonce];
  const claim = c.env.DB
    .prepare(
      `UPDATE invite_code SET used_by = ?, used_at = ?, claim_nonce = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, now, nonce, code, now);
  const effects = await buildEffects(c.env, inv.type, inv.data, userId, body, G, g, now);

  const results = await c.env.DB.batch([claim, ...effects]);
  if (results[0]?.meta.changes !== 1) throw apiError('INVITE_INVALID', 'Invite code is not valid');
  return c.json({ ok: true, type: inv.type });
});

async function buildEffects(
  env: Env,
  type: string,
  data: Record<string, any>,
  userId: string,
  body: { existingChildId?: string; pin?: string },
  G: string,
  g: unknown[],
  now: number,
): Promise<D1PreparedStatement[]> {
  const P = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds);

  if (type === 'staff') {
    assertPinFormat(body.pin);
    const orgId = String(data.orgId ?? '');
    const pinHash = await hashPin(body.pin);
    return [
      P(`INSERT OR IGNORE INTO org_member (org_id, user_id, role) SELECT ?, ?, 'teacher' WHERE ${G}`, orgId, userId, ...g),
      P(
        `INSERT INTO staff_pin (user_id, org_id, pin_hash) SELECT ?, ?, ? WHERE ${G}
         ON CONFLICT(user_id, org_id) DO UPDATE SET pin_hash = excluded.pin_hash`,
        userId,
        orgId,
        pinHash,
        ...g,
      ),
    ];
  }

  if (type === 'co_parent') {
    return [
      P(`INSERT OR IGNORE INTO family_member (family_id, user_id, role) SELECT ?, ?, 'parent' WHERE ${G}`, String(data.familyId ?? ''), userId, ...g),
    ];
  }

  if (type === 'home_caregiver') {
    const familyId = String(data.familyId ?? '');
    const childIds: string[] = Array.isArray(data.childIds) ? data.childIds.map(String) : [];
    return childIds.map((childId) =>
      P(
        `INSERT INTO connection (id, child_id, kind, org_id, caregiver_user_id, transcript_access)
         SELECT ?, c.id, 'home', NULL, ?, 0 FROM child c
         WHERE c.id = ? AND c.family_id = ? AND ${G}
           AND NOT EXISTS (SELECT 1 FROM connection x WHERE x.child_id = c.id AND x.kind = 'home' AND x.caregiver_user_id = ?)`,
        newId(),
        userId,
        childId,
        familyId,
        ...g,
        userId,
      ),
    );
  }

  if (type === 'parent_enrollment') {
    const enrollment = await env.DB
      .prepare('SELECT id, org_id, classroom_id, child_name, status FROM enrollment WHERE id = ?')
      .bind(String(data.enrollmentId ?? ''))
      .first<{ id: string; org_id: string; classroom_id: string; child_name: string; status: string }>();
    if (!enrollment || enrollment.status !== 'invited' || enrollment.org_id !== data.orgId) {
      throw apiError('INVITE_INVALID', 'Invite code is not valid');
    }
    const org = await env.DB.prepare('SELECT timezone FROM org WHERE id = ?').bind(enrollment.org_id).first<{ timezone: string }>();
    if (!org) throw apiError('INVITE_INVALID', 'Invite code is not valid');

    const fam = await env.DB
      .prepare('SELECT family_id FROM family_member WHERE user_id = ? ORDER BY family_id LIMIT 1')
      .bind(userId)
      .first<{ family_id: string }>();

    const stmts: D1PreparedStatement[] = [];
    let familyId = fam?.family_id;
    let childId: string;

    if (body.existingChildId) {
      if (!(await isParentOf(env, userId, body.existingChildId))) throw apiError('FORBIDDEN', 'Not a parent of this child');
      childId = body.existingChildId;
    } else {
      childId = newId();
    }
    if (!familyId) {
      familyId = newId();
      stmts.push(
        P(`INSERT INTO family (id, created_at) SELECT ?, ? WHERE ${G}`, familyId, now, ...g),
        P(`INSERT INTO family_member (family_id, user_id, role) SELECT ?, ?, 'parent' WHERE ${G}`, familyId, userId, ...g),
      );
    }
    if (!body.existingChildId) {
      stmts.push(
        P(
          `INSERT INTO child (id, family_id, name, timezone) SELECT ?, ?, ?, ? WHERE ${G}`,
          childId,
          familyId,
          enrollment.child_name,
          org.timezone,
          ...g,
        ),
      );
    }
    stmts.push(
      P(
        `INSERT INTO connection (id, child_id, kind, org_id, caregiver_user_id, transcript_access)
         SELECT ?, ?, 'daycare', ?, NULL, 0 WHERE ${G}
           AND NOT EXISTS (SELECT 1 FROM connection x WHERE x.child_id = ? AND x.kind = 'daycare' AND x.org_id = ?)`,
        newId(),
        childId,
        enrollment.org_id,
        ...g,
        childId,
        enrollment.org_id,
      ),
      P(`INSERT OR IGNORE INTO classroom_child (classroom_id, child_id) SELECT ?, ? WHERE ${G}`, enrollment.classroom_id, childId, ...g),
      P(
        `UPDATE enrollment SET child_id = ?, status = 'linked' WHERE id = ? AND status = 'invited' AND ${G}`,
        childId,
        enrollment.id,
        ...g,
      ),
    );
    return stmts;
  }

  throw apiError('INVITE_INVALID', 'Invite code is not valid');
}
