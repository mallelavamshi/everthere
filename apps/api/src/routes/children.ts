import { Hono } from 'hono';
import { ChildBody } from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError } from '../http';
import { caregiverChildIds, isParentOf, requireParentOf, requireViewChild } from '../auth/access';
import { newId } from '../lib/ids';
import { isOwnedKey } from '../lib/mediaKeys';
import { defaultNapsterDeleteSession, type NapsterSessionDeleter } from '../napster/sessions';
import { ensureFamily } from './families';
import { forbidDemo, forbidDemoChange } from '../auth/demo';
import { MEDIA_URL_TTL_MS, signMediaUrl } from './media';

type ChildRow = { id: string; family_id: string; name: string; photo_key: string | null; birthday: string | null; timezone: string };

type FamilyAvatar = { avatarId: string; ownerUserId: string; ownerName: string; parentTitle: string; status: string; isMine: boolean };

const photoUrlOf = async (env: Env, r: ChildRow) => (r.photo_key ? { photoUrl: await signMediaUrl(env, r.photo_key, MEDIA_URL_TTL_MS) } : {});

/** One entry per avatar owned by any member of the child's family (parents only). */
async function familyAvatarsOf(env: Env, familyId: string, userId: string): Promise<FamilyAvatar[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT a.id, a.user_id, u.name, a.parent_title, a.status
       FROM avatar a JOIN family_member fm ON fm.user_id = a.user_id JOIN user u ON u.id = a.user_id
       WHERE fm.family_id = ? ORDER BY a.id`,
    )
    .bind(familyId)
    .all<{ id: string; user_id: string; name: string; parent_title: string; status: string }>();
  return results.map((a) => ({
    avatarId: a.id,
    ownerUserId: a.user_id,
    ownerName: a.name,
    parentTitle: a.parent_title,
    status: a.status,
    isMine: a.user_id === userId,
  }));
}

const full = async (env: Env, r: ChildRow, userId: string) => ({
  id: r.id,
  familyId: r.family_id,
  name: r.name,
  photoKey: r.photo_key,
  ...(await photoUrlOf(env, r)),
  birthday: r.birthday,
  timezone: r.timezone,
  familyAvatars: await familyAvatarsOf(env, r.family_id, userId),
});
// Caregivers never see raw storage keys, only a signed URL.
const limited = async (env: Env, r: ChildRow) => ({ id: r.id, name: r.name, ...(await photoUrlOf(env, r)) });

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw apiError('INVALID', 'Invalid JSON body');
  }
}

/** Child photo keys must be child/<familyId>/<nanoid>.<ext> for the child's own family (Task 11 issues them). */
function assertOwnPhotoKey(key: string, familyId: string): void {
  if (!isOwnedKey(key, 'child', familyId)) throw apiError('INVALID', 'photoKey is not valid for this family');
}

async function deleteObject(bucket: R2Bucket, key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await bucket.delete(key);
  } catch (err) {
    console.error('R2 delete failed', key, err);
  }
}

// `callsParent` is accepted by ChildBody but has no child column yet; it is validated and not stored.
export function childRoutes(opts: { napsterDeleteSession?: NapsterSessionDeleter } = {}) {
  const r = new Hono<AppEnv>();

  r.get('/children', async (c) => {
    const userId = c.var.userId;
    const { results: own } = await c.env.DB
      .prepare(
        `SELECT c.* FROM child c JOIN family_member fm ON fm.family_id = c.family_id
         WHERE fm.user_id = ? ORDER BY c.name, c.id`,
      )
      .bind(userId)
      .all<ChildRow>();
    const ownIds = new Set(own.map((x) => x.id));
    const cared: ChildRow[] = [];
    for (const id of await caregiverChildIds(c.env, userId)) {
      if (ownIds.has(id)) continue;
      const row = await c.env.DB.prepare('SELECT * FROM child WHERE id = ?').bind(id).first<ChildRow>();
      if (row) cared.push(row);
    }
    return c.json({
      children: [
        ...(await Promise.all(own.map((x) => full(c.env, x, userId)))),
        ...(await Promise.all(cared.map((x) => limited(c.env, x)))),
      ],
    });
  });

  r.post('/children', async (c) => {
    const userId = c.var.userId;
    const body = ChildBody.parse(await readJson(c));
    const fam = await ensureFamily(c.env, userId);
    if (body.photoKey) assertOwnPhotoKey(body.photoKey, fam.id);
    const id = newId();
    await c.env.DB
      .prepare('INSERT INTO child (id, family_id, name, photo_key, birthday, timezone) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, fam.id, body.name, body.photoKey ?? null, body.birthday, body.timezone)
      .run();
    return c.json(
      { id, familyId: fam.id, name: body.name, photoKey: body.photoKey ?? null, birthday: body.birthday, timezone: body.timezone },
      201,
    );
  });

  r.get('/children/:id', async (c) => {
    const userId = c.var.userId;
    const id = c.req.param('id');
    await requireViewChild(c.env, userId, id);
    const row = await c.env.DB.prepare('SELECT * FROM child WHERE id = ?').bind(id).first<ChildRow>();
    if (!row) throw apiError('NOT_FOUND', 'Child not found');
    return c.json((await isParentOf(c.env, userId, id)) ? await full(c.env, row, userId) : await limited(c.env, row));
  });

  r.patch('/children/:id', async (c) => {
    const userId = c.var.userId;
    const id = c.req.param('id');
    await requireParentOf(c.env, userId, id);
    const body = ChildBody.partial().parse(await readJson(c));
    const before = await c.env.DB
      .prepare('SELECT family_id, name, photo_key FROM child WHERE id = ?')
      .bind(id)
      .first<{ family_id: string; name: string; photo_key: string | null }>();
    if (!before) throw apiError('NOT_FOUND', 'Child not found');
    // Demo accounts keep the seeded name and portrait (a photo change would delete the seeded R2 object).
    forbidDemoChange(c, [[body.name, before.name], [body.photoKey, before.photo_key]]);
    if (body.photoKey) assertOwnPhotoKey(body.photoKey, before.family_id);
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (body.name !== undefined) (sets.push('name = ?'), binds.push(body.name));
    if (body.birthday !== undefined) (sets.push('birthday = ?'), binds.push(body.birthday));
    if (body.timezone !== undefined) (sets.push('timezone = ?'), binds.push(body.timezone));
    if (body.photoKey !== undefined) (sets.push('photo_key = ?'), binds.push(body.photoKey));
    if (sets.length) await c.env.DB.prepare(`UPDATE child SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
    if (body.photoKey !== undefined && before.photo_key && before.photo_key !== body.photoKey) await deleteObject(c.env.MEDIA, before.photo_key);
    const row = await c.env.DB.prepare('SELECT * FROM child WHERE id = ?').bind(id).first<ChildRow>();
    return c.json(await full(c.env, row!, userId));
  });

  r.delete('/children/:id', forbidDemo, async (c) => {
    const userId = c.var.userId;
    const id = c.req.param('id');
    await requireParentOf(c.env, userId, id);
    const child = await c.env.DB.prepare('SELECT photo_key FROM child WHERE id = ?').bind(id).first<{ photo_key: string | null }>();
    if (!child) throw apiError('NOT_FOUND', 'Child not found');

    const { results: sessions } = await c.env.DB
      .prepare('SELECT id, napster_session_id FROM comfort_session WHERE child_id = ?')
      .bind(id)
      .all<{ id: string; napster_session_id: string | null }>();

    // Remote first: if Napster fails (other than 404) nothing is deleted locally and the call can be retried.
    const deleteRemote = opts.napsterDeleteSession ?? defaultNapsterDeleteSession(c.env);
    for (const s of sessions) {
      if (!s.napster_session_id) continue;
      try {
        await deleteRemote(s.napster_session_id);
      } catch (err) {
        console.error(err);
        throw apiError('INTERNAL', 'Could not delete session data at the voice provider; nothing was deleted');
      }
    }

    const P = (sql: string, ...b: unknown[]) => c.env.DB.prepare(sql).bind(...b);
    const sessionIds = `SELECT id FROM comfort_session WHERE child_id = ?`;
    const flagIds = `SELECT id FROM session_flag WHERE session_id IN (${sessionIds})`;
    await c.env.DB.batch([
      P(`DELETE FROM alert WHERE ref_id IN (${sessionIds}) OR ref_id IN (${flagIds})`, id, id),
      P(`DELETE FROM session_flag WHERE session_id IN (${sessionIds})`, id),
      P('DELETE FROM comfort_session WHERE child_id = ?', id),
      P('DELETE FROM comfort_plan WHERE child_id = ?', id),
      P('DELETE FROM connection WHERE child_id = ?', id),
      P('DELETE FROM classroom_child WHERE child_id = ?', id),
      P(`UPDATE enrollment SET child_id = NULL, status = 'invited' WHERE child_id = ?`, id),
      P('DELETE FROM child WHERE id = ?', id),
    ]);
    await deleteObject(c.env.MEDIA, child.photo_key);
    return c.json({ ok: true });
  });

  return r;
}
