import type { Env } from '../env';
import { newId } from '../lib/ids';
import { quotesOverlap } from '../lib/quotes';
import { normalizeTranscript } from '../lib/transcript';
import { napster as makeNapster, type NapsterClient } from '../napster/client';
import * as creditGuard from './creditGuard';
import { notifyFlag, notifySummary } from './alerts';
import { summarize, type SummaryDeps, type SummaryFlag } from './summary';

export type FinalizeNapster = Pick<NapsterClient, 'getSession'>;
export type FinalizeDeps = SummaryDeps & { napster?: FinalizeNapster };
/** done: summarized now; already: someone else summarized it; pending: Napster hasn't closed it; skipped: nothing to do. */
export type FinalizeOutcome = 'done' | 'already' | 'pending' | 'skipped';

type Row = {
  id: string;
  kind: 'child' | 'test';
  napster_session_id: string | null;
  reason: string | null;
  started_at: number;
  ended_at: number | null;
  summary: string | null;
  child_name: string | null;
  parent_title: string | null;
  caregiver_name: string | null;
};

const firstName = (name: string | null): string | null => (name ? name.trim().split(/\s+/)[0] || null : null);

/**
 * Statement marking a session ended (idempotent: keeps an existing ended_at / reason / duration). Live statuses
 * become 'closed'; 'failed' stays. Bind order handled here.
 */
export function markEndedStmt(env: Pick<Env, 'DB'>, sessionId: string, endedAt: number, reason: string): D1PreparedStatement {
  return env.DB
    .prepare(
      `UPDATE comfort_session
       SET ended_at = COALESCE(ended_at, ?),
           status = CASE WHEN status IN ('pending', 'started', 'active') THEN 'closed' ELSE status END,
           ended_reason = COALESCE(ended_reason, ?),
           duration_s = COALESCE(duration_s, MAX(0, CAST((COALESCE(ended_at, ?) - started_at) / 1000 AS INTEGER)))
       WHERE id = ?`,
    )
    .bind(endedAt, reason, endedAt, sessionId);
}

export { quotesOverlap };

/** Inserts the model's flags as source 'post', skipping any that repeat an existing flag; alerts for each new one. */
async function storePostFlags(env: Env, sessionId: string, flags: SummaryFlag[]): Promise<number> {
  if (!flags.length) return 0;
  const { results } = await env.DB
    .prepare(`SELECT category, quote FROM session_flag WHERE session_id = ?`)
    .bind(sessionId)
    .all<{ category: string; quote: string | null }>();
  const seen = [...results];
  const fresh: SummaryFlag[] = [];
  for (const f of flags) {
    if (seen.some((x) => x.category === f.category && quotesOverlap(x.quote, f.quote))) continue;
    seen.push(f);
    fresh.push(f);
  }
  if (!fresh.length) return 0;
  const now = Date.now();
  await env.DB.batch(
    fresh.map((f) =>
      env.DB
        .prepare(`INSERT INTO session_flag (id, session_id, source, category, quote, severity, created_at) VALUES (?, ?, 'post', ?, ?, ?, ?)`)
        .bind(newId(), sessionId, f.category, f.quote || null, f.severity, now),
    ),
  );
  for (const f of fresh) await notifyFlag(env, sessionId, { category: f.category, severity: f.severity, quote: f.quote || null });
  return fresh.length;
}

/**
 * Completes a finished session: transcript + cost (recorded once, even across duplicate webhooks and cron sweeps),
 * summary, mood signal, post flags (child sessions only) and the "summary ready" alerts. Idempotent: a session that
 * already has a summary is left alone, and a session Napster hasn't closed yet (no cost) is left for the cron.
 */
export async function finalizeSession(env: Env, sessionId: string, deps: FinalizeDeps = {}): Promise<FinalizeOutcome> {
  const s = await env.DB
    .prepare(
      `SELECT s.id, s.kind, s.napster_session_id, s.reason, s.started_at, s.ended_at, s.summary,
              c.name AS child_name, COALESCE(p.parent_title, a.parent_title) AS parent_title, u.name AS caregiver_name
       FROM comfort_session s
       LEFT JOIN child c ON c.id = s.child_id
       LEFT JOIN avatar a ON a.id = s.avatar_id
       LEFT JOIN comfort_plan p ON p.child_id = s.child_id AND p.avatar_id = s.avatar_id
       LEFT JOIN user u ON u.id = s.caregiver_user_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<Row>();
  if (!s) return 'skipped';
  if (s.summary != null) return 'already';
  if (!s.napster_session_id) return 'skipped';

  const napster = deps.napster ?? makeNapster(env.NAPSTER_API_KEY);
  const ns = await napster.getSession(s.napster_session_id);
  // No cost yet means Napster hasn't closed it: leave it for the cron. A session Napster reports as closed but
  // without a cost is final, with cost 0 (otherwise it would sit pending until the sweep gives up).
  const napsterClosed = /^closed$/i.test(ns.status ?? '');
  if (ns.cost == null && !napsterClosed) return 'pending';

  // 1./2. Transcript + cost, and the credit guard, in one batch. The cost write is guarded on cost_usd IS NULL and
  // the credit-guard statement only fires when that write changed the row, so a second finalize never double-counts.
  const cost = typeof ns.cost === 'number' && Number.isFinite(ns.cost) ? ns.cost : 0;
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    markEndedStmt(env, s.id, s.ended_at ?? now, 'napster_closed'),
    env.DB
      .prepare(
        `UPDATE comfort_session
         SET cost_usd = ?, transcript_json = ?, duration_s = COALESCE(duration_s, ?), napster_status = ?
         WHERE id = ? AND cost_usd IS NULL`,
      )
      .bind(cost, JSON.stringify(normalizeTranscript(ns.items)), Math.max(0, Math.round(((s.ended_at ?? now) - s.started_at) / 1000)), ns.status, s.id),
  ];
  const record = creditGuard.recordIfChangedStmt(env, cost);
  if (record) stmts.push(record);
  await env.DB.batch(stmts);

  // 3. Summary (never throws; falls back to a friendly placeholder).
  const result = await summarize(env, ns.items, {
    kind: s.kind,
    childFirstName: firstName(s.child_name),
    parentTitle: s.parent_title ?? '',
    reason: s.reason,
    caregiverName: firstName(s.caregiver_name),
  }, deps);

  // 4. Store it; only the writer that wins this guarded update fans out flags and alerts.
  const upd = await env.DB
    .prepare('UPDATE comfort_session SET summary = ?, mood_signal = ? WHERE id = ? AND summary IS NULL')
    .bind(result.summary, result.moodSignal, s.id)
    .run();
  if (!upd.meta.changes) return 'already';
  if (s.kind === 'child') await storePostFlags(env, s.id, result.flags);

  // 5. "Summary ready" (test sessions: the avatar owner only).
  await notifySummary(env, s.id, result.summary);
  return 'done';
}
