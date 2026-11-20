import { Hono, type Context } from 'hono';
import {
  buildClientProfile,
  buildInitialSpeech,
  buildSessionContext,
  CheckinBody,
  FlagBody,
  StartSessionBody,
  type PlanInput,
  type SessionContextView,
  type SessionSong,
} from '@everthere/shared';
import type { AppEnv, Env } from '../env';
import { apiError, readJson } from '../http';
import { newId } from '../lib/ids';
import { childClientId } from '../lib/clientIds';
import { napster as makeNapster, NapsterError } from '../napster/client';
import {
  canReadTranscript,
  canSeeSummary,
  canStartSession,
  canStartSessionInOrg,
  canViewChild,
  canViewChildInOrg,
  daycareOrgOf,
  isAdminOf,
  isParentOf,
} from '../auth/access';
import * as creditGuard from '../services/creditGuard';
import { notifyFlag } from '../services/alerts';
import { normalizeTranscript } from '../lib/transcript';
import {
  ACTIVE_FOR_CHILD_SQL,
  decodeCursor,
  isActive,
  listForChild,
  loadSession,
  loadSessionSetup,
  sessionDetail,
  STALE_SESSION_MS,
  TEST_SESSION_CONTEXT,
  type SessionNapster,
  type SessionRow,
} from '../services/sessions';

type C = Context<AppEnv>;

/** The person a request is attributed to: the acting teacher on a shared tablet, else the signed-in user. */
const actorOf = (c: C): string => c.var.actingUserId ?? c.var.userId;

/** With an acting token, only sessions of the tablet's org are in reach (never home or other-org sessions). */
const inActingScope = (c: C, s: SessionRow): boolean => !c.var.actingUserId || (s.org_id != null && s.org_id === c.var.actingOrgId);

const isSessionCaregiver = (c: C, s: SessionRow): boolean => s.caregiver_user_id === actorOf(c) && inActingScope(c, s);

const isSessionOrgAdmin = async (c: C, s: SessionRow): Promise<boolean> =>
  s.org_id != null && inActingScope(c, s) && isAdminOf(c.env, actorOf(c), s.org_id);

const notFound = () => apiError('NOT_FOUND', 'Session not found');

/** The plan's song for the call's song button: only with a title; lyrics only when there are some. */
function songOf(plan: PlanInput): SessionSong | undefined {
  const title = plan.songTitle?.trim();
  if (!title) return undefined;
  const lyrics = plan.songLyrics?.trim();
  return lyrics ? { title, lyrics } : { title };
}

async function sessionOr404(c: C): Promise<SessionRow> {
  const s = await loadSession(c.env, c.req.param('id')!);
  if (!s) throw notFound();
  return s;
}

export function sessionRoutes(opts: { napster?: SessionNapster } = {}) {
  const r = new Hono<AppEnv>();
  const client = (env: Env): SessionNapster => opts.napster ?? makeNapster(env.NAPSTER_API_KEY);

  r.post('/sessions', async (c) => {
    const b = StartSessionBody.parse(await readJson(c));
    const env = c.env;
    const actor = actorOf(c);
    const actingOrg = c.var.actingUserId ? c.var.actingOrgId : undefined;

    // 1. Access (org-scoped when acting on a tablet).
    const allowed = c.var.actingUserId
      ? actingOrg != null && (await canStartSessionInOrg(env, actor, b.childId, b.avatarId, actingOrg))
      : await canStartSession(env, actor, b.childId, b.avatarId);
    if (!allowed) throw apiError('FORBIDDEN', 'Cannot start a session for this child');

    // 2. Credit guard.
    await creditGuard.check(env, actor);

    const now = Date.now();
    const dailyLimit = await creditGuard.dailyLimitFor(env, actor);
    const setup = await loadSessionSetup(env, b.childId, b.avatarId, now);
    if (!setup?.agentId) throw apiError('INVALID', 'Avatar is not ready yet');
    const orgId = actingOrg ?? (await daycareOrgOf(env, actor, b.childId));
    // Never the raw child id (seeded ids contain dots): a stable derived id, asserted against Napster's pattern.
    const externalClientId = await childClientId(b.childId);

    // 3. Claim the child's slot atomically (also re-checks the daily limit, so parallel starts can't overshoot it).
    const sessionId = newId();
    const ins = await env.DB
      .prepare(
        `INSERT INTO comfort_session (id, child_id, avatar_id, caregiver_user_id, org_id, reason, started_at, status, kind)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 'child'
         WHERE NOT EXISTS (${ACTIVE_FOR_CHILD_SQL})
           AND (${creditGuard.DAILY_COUNT_SQL}) < ?`,
      )
      .bind(
        sessionId, b.childId, b.avatarId, actor, orgId, b.reason, now,
        b.childId, now - STALE_SESSION_MS,
        actor, creditGuard.utcDayStart(now), dailyLimit,
      )
      .run();
    if (!ins.meta.changes) {
      await creditGuard.check(env, actor); // RESTING if the daily limit was the reason
      throw apiError('SESSION_ACTIVE', 'A session is already running for this child');
    }

    // 4./5. Napster connection with the child's plan.
    const napster = client(env);
    let conn: { token: string; connectionId: string };
    try {
      conn = await napster.createConnection(setup.agentId, {
        channelType: 'webrtc',
        externalClientId,
        externalClientProfile: buildClientProfile(setup.plan),
        initialSpeech: buildInitialSpeech(setup.plan, b.reason),
        tags: { childId: b.childId, caregiverId: actor, reason: b.reason, sessionId, kind: 'child' },
      });
    } catch (e) {
      const busy = e instanceof NapsterError && e.code === 'BUSY';
      // Free the child's slot: a failed start must not block the next one.
      await env.DB
        .prepare(`UPDATE comfort_session SET status = 'failed', ended_at = ?, duration_s = 0, ended_reason = ? WHERE id = ? AND ended_at IS NULL`)
        .bind(Date.now(), busy ? 'busy' : 'napster_error', sessionId)
        .run();
      if (busy) throw apiError('AVATARS_BUSY', 'All avatars are busy, try again in a moment');
      console.error('createConnection failed', sessionId, e);
      throw apiError('INTERNAL', 'Could not start the session');
    }

    // 6. Mark started (unless it was ended while connecting).
    const dropConnection = () =>
      napster.deleteConnection(conn.connectionId).catch((e) => console.error('deleteConnection failed', conn.connectionId, e));
    let upd: D1Result;
    try {
      upd = await env.DB
        .prepare(`UPDATE comfort_session SET status = 'started', napster_session_id = ? WHERE id = ? AND status = 'pending' AND ended_at IS NULL`)
        .bind(conn.connectionId, sessionId)
        .run();
    } catch (e) {
      // The connection exists but we couldn't record it: drop it and free the slot, best-effort.
      console.error('marking session started failed', sessionId, e);
      await dropConnection();
      await env.DB
        .prepare(`UPDATE comfort_session SET status = 'failed', ended_at = ?, duration_s = 0, ended_reason = 'db_error', napster_session_id = ? WHERE id = ? AND ended_at IS NULL`)
        .bind(Date.now(), conn.connectionId, sessionId)
        .run()
        .catch((e2) => console.error('marking session failed also failed', sessionId, e2));
      throw apiError('INTERNAL', 'Could not start the session');
    }
    if (!upd.meta.changes) {
      await env.DB.prepare('UPDATE comfort_session SET napster_session_id = ? WHERE id = ?').bind(conn.connectionId, sessionId).run();
      await dropConnection();
      throw apiError('INVALID', 'The session was ended while it was starting');
    }
    return c.json({ sessionId, token: conn.token });
  });

  r.get('/sessions/:id/context', async (c) => {
    const s = await sessionOr404(c);
    if (!isSessionCaregiver(c, s)) throw notFound();
    if (!isActive(s)) throw apiError('INVALID', 'Session is not active');
    // Test calls never sing: they have no child and so no plan.
    if (s.kind === 'test' || !s.child_id) return c.json({ systemMessage: TEST_SESSION_CONTEXT } satisfies SessionContextView);
    const setup = await loadSessionSetup(c.env, s.child_id, s.avatar_id);
    if (!setup) throw notFound();
    // Anyone who may read the context may get the song: the avatar sings it in the call anyway.
    const song = songOf(setup.plan);
    const view: SessionContextView = { systemMessage: buildSessionContext(setup.plan), ...(song ? { song } : {}) };
    return c.json(view);
  });

  r.post('/sessions/:id/flags', async (c) => {
    const s = await sessionOr404(c);
    const allowed =
      isSessionCaregiver(c, s) || (s.child_id != null && inActingScope(c, s) && (await isParentOf(c.env, actorOf(c), s.child_id)));
    if (!allowed) throw notFound();
    const b = FlagBody.parse(await readJson(c));
    if (b.source === 'live' && !isActive(s)) throw apiError('INVALID', 'Live flags are only accepted while the session is active');
    const id = newId();
    await c.env.DB
      .prepare('INSERT INTO session_flag (id, session_id, source, category, quote, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, s.id, b.source, b.category, b.quote, b.severity, Date.now())
      .run();
    if (s.kind === 'child') await notifyFlag(c.env, s.id, { category: b.category, severity: b.severity, quote: b.quote });
    return c.json({ id });
  });

  r.post('/sessions/:id/end', async (c) => {
    const s = await sessionOr404(c);
    // The signed-in person who started the session may always end it: a stale acting token must never keep it running.
    const startedBySignedIn = s.caregiver_user_id === c.var.userId;
    if (!startedBySignedIn && !isSessionCaregiver(c, s) && !(await isSessionOrgAdmin(c, s))) throw notFound();
    const now = Date.now();
    // Idempotent: only the first call sets ended_at / status / duration.
    await c.env.DB
      .prepare(
        `UPDATE comfort_session
         SET ended_at = ?, status = 'closed',
             duration_s = COALESCE(duration_s, MAX(0, CAST((? - started_at) / 1000 AS INTEGER))),
             ended_reason = COALESCE(ended_reason, 'ended')
         WHERE id = ? AND ended_at IS NULL`,
      )
      .bind(now, now, s.id)
      .run();
    // Re-read after our update: a start that raced us may have recorded its connection id since `s` was loaded.
    const cur = (await loadSession(c.env, s.id))!;
    if (cur.napster_session_id) {
      // Best-effort: an expired connection (400 ConnectionNotFound) resolves in the client; any other error is logged and ignored.
      // napster_session_id is the connection id: the REST session id equals it (docs/notes/napster-events.md section 2).
      const connId = cur.napster_session_id;
      await client(c.env)
        .deleteConnection(connId)
        .catch((e) => console.error('deleteConnection failed', s.id, connId, e));
    }
    return c.json({ id: cur.id, endedAt: cur.ended_at, durationS: cur.duration_s, status: cur.status });
  });

  r.post('/sessions/:id/checkin', async (c) => {
    const s = await sessionOr404(c);
    if (!isSessionCaregiver(c, s) && !(await isSessionOrgAdmin(c, s))) throw notFound();
    if (s.kind !== 'child' || s.ended_at == null) throw apiError('INVALID', 'Check-in is only possible after the session has ended');
    const b = CheckinBody.parse(await readJson(c));
    await c.env.DB
      .prepare('UPDATE comfort_session SET mood_after = ?, caregiver_note = COALESCE(?, caregiver_note) WHERE id = ?')
      .bind(b.moodAfter, b.note || null, s.id)
      .run();
    return c.json({ ok: true });
  });

  r.get('/sessions', async (c) => {
    const childId = c.req.query('childId');
    if (!childId) throw apiError('INVALID', 'childId is required');
    const rawCursor = c.req.query('cursor');
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) throw apiError('INVALID', 'Invalid cursor');
    const actor = actorOf(c);
    const allowed = c.var.actingUserId
      ? c.var.actingOrgId != null && (await canViewChildInOrg(c.env, actor, childId, c.var.actingOrgId))
      : await canViewChild(c.env, actor, childId);
    if (!allowed) throw apiError('FORBIDDEN', 'No access to this child');
    return c.json(await listForChild(c.env, childId, cursor, c.var.actingUserId ? c.var.actingOrgId : undefined));
  });

  r.get('/sessions/:id', async (c) => {
    const s = await sessionOr404(c);
    const actor = actorOf(c);
    if (!inActingScope(c, s) || !(await canSeeSummary(c.env, actor, s.id))) throw notFound();
    const d = await sessionDetail(c.env, s.id);
    if (!d) throw notFound();
    const view = { ...d.view, caregiverNote: s.caregiver_note };
    if (!(await canReadTranscript(c.env, actor, s.id))) return c.json(view);
    let transcript: unknown = null;
    if (d.transcriptJson) {
      try {
        const lines: unknown = JSON.parse(d.transcriptJson);
        // Only what the child and the avatar said: system lines are internal. Times are epoch ms whatever was stored
        // (rows from before device test P-2 hold Napster's unix seconds; seeded rows hold ISO strings).
        transcript = Array.isArray(lines) ? normalizeTranscript(lines).filter((l) => l.role === 'User' || l.role === 'Assistant') : null;
      } catch {
        transcript = null;
      }
    }
    return c.json({ ...view, transcript });
  });

  return r;
}
