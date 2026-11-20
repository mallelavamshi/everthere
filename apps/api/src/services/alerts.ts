import type { Env } from '../env';
import { newId } from '../lib/ids';

type E = Pick<Env, 'DB'>;

export type FlagAlertInput = { category: string; severity: string; quote: string | null };

export const ALERT_BODY_MAX = 140;

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One `flag` alert per recipient: every family member (parent) of the session's child, plus every admin of the
 * session's org when it has one. Recipients are de-duplicated. Test sessions (no child) alert no one.
 */
export async function notifyFlag(env: E, sessionId: string, flag: FlagAlertInput): Promise<number> {
  const s = await env.DB
    .prepare(
      `SELECT s.org_id, c.name AS child_name, c.family_id
       FROM comfort_session s JOIN child c ON c.id = s.child_id WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<{ org_id: string | null; child_name: string; family_id: string }>();
  if (!s) return 0;
  const { results } = await env.DB
    .prepare(
      `SELECT user_id FROM family_member WHERE family_id = ?
       UNION
       SELECT user_id FROM org_member WHERE org_id = ? AND role = 'admin'`,
    )
    .bind(s.family_id, s.org_id)
    .all<{ user_id: string }>();
  const users = [...new Set(results.map((r) => r.user_id))];
  if (!users.length) return 0;
  const now = Date.now();
  const title = `⚑ Heads up about ${s.child_name}`;
  const body = clip(flag.quote ?? '', ALERT_BODY_MAX);
  await env.DB.batch(
    users.map((u) =>
      env.DB
        .prepare(`INSERT INTO alert (id, user_id, kind, ref_id, title, body, created_at) VALUES (?, ?, 'flag', ?, ?, ?, ?)`)
        .bind(newId(), u, sessionId, title, body, now),
    ),
  );
  return users.length;
}

export const TEST_SUMMARY_TITLE = 'Your test call is ready to review';

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/**
 * "Summary ready" alerts (kind `summary`, ref = session). Child sessions: every parent of the child, de-duplicated;
 * never the caregiver who ran it or daycare admins. Test sessions: only the avatar's owner.
 */
export async function notifySummary(env: E, sessionId: string, summary: string): Promise<number> {
  const s = await env.DB
    .prepare(
      `SELECT s.kind, c.name AS child_name, c.family_id, a.user_id AS owner_id
       FROM comfort_session s LEFT JOIN child c ON c.id = s.child_id LEFT JOIN avatar a ON a.id = s.avatar_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<{ kind: string; child_name: string | null; family_id: string | null; owner_id: string | null }>();
  if (!s) return 0;
  let users: string[];
  let title: string;
  if (s.kind === 'test') {
    if (!s.owner_id) return 0;
    users = [s.owner_id];
    title = TEST_SUMMARY_TITLE;
  } else {
    if (!s.family_id || !s.child_name) return 0;
    const { results } = await env.DB
      .prepare('SELECT DISTINCT user_id FROM family_member WHERE family_id = ?')
      .bind(s.family_id)
      .all<{ user_id: string }>();
    users = [...new Set(results.map((r) => r.user_id))];
    title = `💛 ${firstName(s.child_name)}'s comfort session`;
  }
  if (!users.length) return 0;
  const now = Date.now();
  await env.DB.batch(
    users.map((u) =>
      env.DB
        .prepare(`INSERT INTO alert (id, user_id, kind, ref_id, title, body, created_at) VALUES (?, ?, 'summary', ?, ?, ?, ?)`)
        .bind(newId(), u, sessionId, title, summary, now),
    ),
  );
  return users.length;
}
