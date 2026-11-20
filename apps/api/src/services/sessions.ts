import { LIMITS, REASONS, type CallSituation, type PlanInput, type Reason } from '@everthere/shared';
import type { Env } from '../env';
import type { NapsterClient } from '../napster/client';
import { firstNameOf } from './avatars';
import { loadPlan } from './plans';

type E = Pick<Env, 'DB'>;

/** The slice of the Napster client the session flows use (injectable for tests). */
export type SessionNapster = Pick<NapsterClient, 'createConnection' | 'deleteConnection'>;

export const PAGE_SIZE = 20;
/** Child-session statuses that hold the per-child slot (with ended_at NULL). */
export const ACTIVE_CHILD_STATUSES = ['pending', 'started'] as const;
/** Test sessions are inserted with the column default 'active'. */
const LIVE_STATUSES = new Set<string>([...ACTIVE_CHILD_STATUSES, 'active']);
/** Children's age when no birthday is stored (typical daycare age). */
export const DEFAULT_CHILD_AGE = 3;

export type SessionRow = {
  id: string;
  napster_session_id: string | null;
  child_id: string | null;
  avatar_id: string;
  caregiver_user_id: string;
  org_id: string | null;
  reason: string | null;
  started_at: number;
  ended_at: number | null;
  duration_s: number | null;
  cost_usd: number | null;
  mood_after: string | null;
  caregiver_note: string | null;
  summary: string | null;
  mood_signal: string | null;
  status: string;
  kind: 'child' | 'test';
  transcript_json: string | null;
  napster_status: string | null;
  ended_reason: string | null;
};

export const loadSession = (env: E, id: string) => env.DB.prepare('SELECT * FROM comfort_session WHERE id = ?').bind(id).first<SessionRow>();

export const isActive = (s: Pick<SessionRow, 'status' | 'ended_at'>): boolean => s.ended_at == null && LIVE_STATUSES.has(s.status);

/**
 * A pending/started child session older than this can no longer be live (Napster caps sessions at sessionMaxMs),
 * so it stops holding the child's slot even if nothing has closed it yet (crash, lost end call). Sweeps close it later.
 */
export const STALE_SESSION_MS = LIMITS.sessionMaxMs + 120_000;

/** SQL predicate (bind: childId, startedAfterMs): an active child session that holds the child's slot. */
export const ACTIVE_FOR_CHILD_SQL = `SELECT 1 FROM comfort_session
  WHERE child_id = ? AND kind = 'child' AND status IN ('pending', 'started') AND ended_at IS NULL AND started_at > ?`;

/** Whole years from an ISO birthday (UTC) to `now`; DEFAULT_CHILD_AGE when missing or invalid. */
export function ageYears(birthday: string | null, now: number): number {
  const m = birthday ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday) : null;
  if (!m) return DEFAULT_CHILD_AGE;
  const d = new Date(now);
  let age = d.getUTCFullYear() - Number(m[1]);
  const month = d.getUTCMonth() + 1;
  if (month < Number(m[2]) || (month === Number(m[2]) && d.getUTCDate() < Number(m[3]))) age--;
  return Math.max(0, age);
}

export type SessionSetup = { plan: PlanInput; agentId: string | null };

/** Everything a child session needs from D1: the PlanInput (plan or defaults) and the avatar's agent id. */
export async function loadSessionSetup(env: E, childId: string, avatarId: string, now = Date.now()): Promise<SessionSetup | null> {
  const r = await env.DB
    .prepare(
      `SELECT c.name AS child_name, c.birthday, a.parent_title, a.napster_agent_id, u.name AS owner_name
       FROM child c JOIN avatar a ON a.id = ? LEFT JOIN user u ON u.id = a.user_id
       WHERE c.id = ?`,
    )
    .bind(avatarId, childId)
    .first<{ child_name: string; birthday: string | null; parent_title: string; napster_agent_id: string | null; owner_name: string | null }>();
  if (!r) return null;
  const p = await loadPlan(env, { childId, avatarId, parentTitle: r.parent_title }, now);
  const plan: PlanInput = {
    childName: r.child_name,
    childAgeYears: ageYears(r.birthday, now),
    parentTitle: p.parentTitle,
    parentFirstName: firstNameOf(r.owner_name ?? ''),
    nicknames: p.nicknames,
    tone: p.tone,
    favorites: p.favorites,
    phrases: p.phrases,
    songTitle: p.songTitle ?? undefined,
    songLyrics: p.songLyrics ?? undefined,
    neverTopics: p.neverTopics,
    todayNote: p.todayNote ?? undefined, // planView already dropped an expired note
  };
  return { plan, agentId: r.napster_agent_id };
}

/**
 * Why the call is happening and who is with the child (task 32), for the opening, the profile and the context.
 * Daycare when the session has an org (its name is the place, "their teacher, Jess"); home otherwise ("Ana").
 * Undefined for a test call or an unknown reason.
 */
export async function loadCallSituation(
  env: E,
  s: { reason: string | null; caregiver_user_id: string; org_id: string | null },
): Promise<CallSituation | undefined> {
  if (!s.reason || !(s.reason in REASONS)) return undefined;
  const r = await env.DB
    .prepare('SELECT u.name AS caregiver, o.name AS org FROM user u LEFT JOIN org o ON o.id = ? WHERE u.id = ?')
    .bind(s.org_id, s.caregiver_user_id)
    .first<{ caregiver: string | null; org: string | null }>();
  const first = firstNameOf(r?.caregiver ?? '');
  const daycare = s.org_id != null;
  return {
    reason: s.reason as Reason,
    setting: daycare ? 'daycare' : 'home',
    ...(first ? { caregiverName: daycare ? `their teacher, ${first}` : first } : {}),
    ...(daycare && r?.org?.trim() ? { placeName: r.org.trim() } : {}),
  };
}

export const TEST_SESSION_CONTEXT =
  'This is a short test call with the grown-up who made you, so they can hear how you look and sound. Say hello warmly and keep it brief.';

// ---------------------------------------------------------------------------------------------------------------
// Views

type FlagRow = { id: string; session_id: string; source: string; category: string; quote: string | null; severity: string; created_at: number; acknowledged_at: number | null };
type ItemRow = SessionRow & { child_name: string | null; caregiver_name: string | null; view_parent_title: string };

/**
 * `view_parent_title`: what the child calls the parent whose avatar was in this session (the comfort plan title for
 * (child, avatar), else the avatar's own title, else "Mom"), so a co-parent sees "Daddy" on Dad's sessions.
 */
const ITEM_SELECT = `SELECT s.*, c.name AS child_name, u.name AS caregiver_name,
    COALESCE(NULLIF(cp.parent_title, ''), NULLIF(a.parent_title, ''), 'Mom') AS view_parent_title
  FROM comfort_session s LEFT JOIN child c ON c.id = s.child_id LEFT JOIN user u ON u.id = s.caregiver_user_id
  LEFT JOIN avatar a ON a.id = s.avatar_id
  LEFT JOIN comfort_plan cp ON cp.child_id = s.child_id AND cp.avatar_id = s.avatar_id`;

const flagView = (f: FlagRow) => ({
  id: f.id,
  source: f.source,
  category: f.category,
  severity: f.severity,
  quote: f.quote,
  createdAt: f.created_at,
  acknowledgedAt: f.acknowledged_at,
});

function itemView(r: ItemRow, flags: FlagRow[]) {
  return {
    id: r.id,
    child: r.child_id ? { id: r.child_id, name: r.child_name ?? '' } : null,
    caregiverName: r.caregiver_name ?? '',
    parentTitle: r.view_parent_title,
    reason: r.reason,
    startedAt: r.started_at,
    durationS: r.duration_s,
    moodAfter: r.mood_after,
    summary: r.summary,
    moodSignal: r.mood_signal,
    flags: flags.map(flagView),
  };
}

async function flagsFor(env: E, ids: string[]): Promise<Map<string, FlagRow[]>> {
  const by = new Map<string, FlagRow[]>();
  if (!ids.length) return by;
  const { results } = await env.DB
    .prepare(`SELECT * FROM session_flag WHERE session_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`)
    .bind(...ids)
    .all<FlagRow>();
  for (const f of results) by.set(f.session_id, [...(by.get(f.session_id) ?? []), f]);
  return by;
}

export async function sessionDetail(env: E, id: string) {
  const r = await env.DB.prepare(`${ITEM_SELECT} WHERE s.id = ?`).bind(id).first<ItemRow>();
  if (!r) return null;
  const flags = await flagsFor(env, [id]);
  return { view: itemView(r, flags.get(id) ?? []), transcriptJson: r.transcript_json };
}

/** Opaque cursor: base64url("<started_at>|<id>") of the last item on the page. */
export const encodeCursor = (startedAt: number, id: string): string =>
  btoa(`${startedAt}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function decodeCursor(cursor: string): { startedAt: number; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(cursor)) return null;
  let raw: string;
  try {
    raw = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  const i = raw.indexOf('|');
  const startedAt = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  if (i < 1 || !Number.isSafeInteger(startedAt) || !id) return null;
  return { startedAt, id };
}

/**
 * Child sessions for one child, newest first (started_at desc, id desc). Test and failed sessions are excluded.
 * `orgId` (acting on a shared tablet) limits the list to that org's sessions: no home or other-org sessions.
 */
export async function listForChild(env: E, childId: string, cursor: { startedAt: number; id: string } | null, orgId?: string) {
  const binds: unknown[] = [childId];
  let where = '';
  if (orgId !== undefined) {
    where += ' AND s.org_id = ?';
    binds.push(orgId);
  }
  if (cursor) {
    where += ' AND (s.started_at < ? OR (s.started_at = ? AND s.id < ?))';
    binds.push(cursor.startedAt, cursor.startedAt, cursor.id);
  }
  const { results } = await env.DB
    .prepare(
      `${ITEM_SELECT} WHERE s.child_id = ? AND s.kind = 'child' AND s.status != 'failed'${where}
       ORDER BY s.started_at DESC, s.id DESC LIMIT ${PAGE_SIZE + 1}`,
    )
    .bind(...binds)
    .all<ItemRow>();
  const page = results.slice(0, PAGE_SIZE);
  const flags = await flagsFor(env, page.map((r) => r.id));
  const last = page[page.length - 1];
  return {
    items: page.map((r) => itemView(r, flags.get(r.id) ?? [])),
    nextCursor: results.length > PAGE_SIZE && last ? encodeCursor(last.started_at, last.id) : null,
  };
}
