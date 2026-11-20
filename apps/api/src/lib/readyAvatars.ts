import type { Env } from '../env';

export type ReadyAvatar = { avatarId: string; parentTitle: string; parentName?: string };

/** The parent's first name for "Send to Sarah", or undefined when the account has no usable name. */
const firstName = (name: string | null): string | undefined => name?.trim().split(/\s+/)[0] || undefined;

/**
 * Approved avatars of each child's family, with what the child calls that parent (the comfort plan title, else the
 * avatar's own title, else "Mom") and the parent's first name. Children without one are simply absent from the map.
 */
export async function readyAvatarsByChild(env: Pick<Env, 'DB'>, childIds: string[]): Promise<Map<string, ReadyAvatar[]>> {
  const out = new Map<string, ReadyAvatar[]>();
  if (!childIds.length) return out;
  const { results } = await env.DB
    .prepare(
      `SELECT ch.id AS child_id, a.id AS avatar_id,
              COALESCE(NULLIF(cp.parent_title, ''), NULLIF(a.parent_title, ''), 'Mom') AS parent_title, u.name AS parent_name
       FROM child ch
       JOIN family_member fm ON fm.family_id = ch.family_id
       JOIN avatar a ON a.user_id = fm.user_id AND a.status = 'approved'
       LEFT JOIN user u ON u.id = a.user_id
       LEFT JOIN comfort_plan cp ON cp.child_id = ch.id AND cp.avatar_id = a.id
       WHERE ch.id IN (SELECT value FROM json_each(?))
       ORDER BY ch.id, a.id`,
    )
    .bind(JSON.stringify(childIds))
    .all<{ child_id: string; avatar_id: string; parent_title: string; parent_name: string | null }>();
  for (const r of results) {
    const list = out.get(r.child_id) ?? [];
    const parentName = firstName(r.parent_name);
    list.push({ avatarId: r.avatar_id, parentTitle: r.parent_title, ...(parentName ? { parentName } : {}) });
    out.set(r.child_id, list);
  }
  return out;
}
