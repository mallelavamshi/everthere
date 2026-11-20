import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { newId } from '../lib/ids';

export const familyRoutes = new Hono<AppEnv>();

export type FamilyRow = { id: string; createdAt: number };

/** The caller's family, creating one if they have none. Idempotent. */
export async function ensureFamily(env: Pick<Env, 'DB'>, userId: string): Promise<FamilyRow> {
  const find = () =>
    env.DB
      .prepare(
        `SELECT f.id AS id, f.created_at AS createdAt FROM family f JOIN family_member fm ON fm.family_id = f.id
         WHERE fm.user_id = ? ORDER BY f.created_at, f.id LIMIT 1`,
      )
      .bind(userId)
      .first<FamilyRow>();
  const id = newId();
  // Conditional inserts in one (transactional) batch: concurrent first calls cannot create two families.
  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO family (id, created_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM family_member WHERE user_id = ?)')
      .bind(id, Date.now(), userId),
    env.DB
      .prepare(
        `INSERT INTO family_member (family_id, user_id, role) SELECT ?, ?, 'parent'
         WHERE NOT EXISTS (SELECT 1 FROM family_member WHERE user_id = ?) AND EXISTS (SELECT 1 FROM family WHERE id = ?)`,
      )
      .bind(id, userId, userId, id),
  ]);
  return (await find())!;
}

familyRoutes.post('/families', async (c) => c.json(await ensureFamily(c.env, c.var.userId)));
