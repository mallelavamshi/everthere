import { DemoFixture, SYNTHETIC_CONSENT_NAME, todayNoteExpiry } from '@everthere/shared';
import type { Env } from '../env';
import { apiError } from '../http';
import { hashPin } from '../auth/acting';

type E = Pick<Env, 'DB'>;

const DAY_MS = 86_400_000;

// ---- rate limiting --------------------------------------------------------------------------------------------

/**
 * Counts one request against `key` in the current fixed window and reports whether it is within `limit`.
 * The increment is a single atomic upsert, so concurrent requests can never both see a stale count.
 */
export async function hitRateLimit(env: E, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await env.DB
    .prepare(
      `INSERT INTO rate_limit (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** Drops rate-limit windows that ended long ago (run by the nightly cron). */
export async function pruneRateLimits(env: E, now = Date.now(), keepMs = 10 * 60_000): Promise<void> {
  await env.DB.prepare('DELETE FROM rate_limit WHERE window_start < ?').bind(now - keepMs).run();
}

// ---- fixture application --------------------------------------------------------------------------------------

/**
 * Fixture timestamps are as of `seededAt`. Each apply moves them forward by the whole days elapsed since then, so
 * "yesterday's" sessions stay yesterday's (time of day is kept) and invites stay valid.
 */
export const dayShift = (seededAt: number, now: number): number => Math.max(0, Math.floor((now - seededAt) / DAY_MS)) * DAY_MS;

const IN = 'IN (SELECT value FROM json_each(?))';
const NOT_IN = `NOT ${IN}`;
const J = (xs: readonly string[]) => JSON.stringify(xs);

async function ids(env: E, sql: string, ...binds: unknown[]): Promise<string[]> {
  const { results } = await env.DB.prepare(sql).bind(...binds).all<{ id: string }>();
  return results.map((r) => r.id);
}

/**
 * The demo scope, computed once before any write so the batch below sees a consistent picture.
 * - demo users: is_demo = 1, plus the fixture's users (about to be marked).
 * - demo families / orgs: the fixture's own, plus "extra" ones whose members are ALL demo users (made by a judge
 *   through a demo account). A real family or daycare that a demo user merely joined is not demo: only the demo
 *   user's membership in it is undone.
 */
async function demoScope(env: E, f: DemoFixture) {
  const fxUsers = f.users.map((u) => u.id);
  const users = [...new Set([...(await ids(env, 'SELECT id FROM user WHERE is_demo = 1')), ...fxUsers])];
  const allDemo = (table: 'family_member' | 'org_member', col: 'family_id' | 'org_id') =>
    ids(
      env,
      `SELECT m.${col} AS id FROM ${table} m LEFT JOIN user u ON u.id = m.user_id
       GROUP BY m.${col} HAVING MIN(CASE WHEN u.is_demo = 1 OR u.id ${IN} THEN 1 ELSE 0 END) = 1`,
      J(fxUsers),
    );
  const fxFamilies = new Set(f.families.map((x) => x.id));
  const fxOrgs = new Set(f.orgs.map((x) => x.id));
  const extraFamilies = (await allDemo('family_member', 'family_id')).filter((id) => !fxFamilies.has(id));
  const extraOrgs = (await allDemo('org_member', 'org_id')).filter((id) => !fxOrgs.has(id));
  const families = [...fxFamilies, ...extraFamilies];
  const orgs = [...fxOrgs, ...extraOrgs];
  const children = await ids(env, `SELECT id FROM child WHERE family_id ${IN}`, J(families));
  return { users, families, orgs, extraFamilies, extraOrgs, children };
}

type Stmt = D1PreparedStatement;

/** `INSERT ... ON CONFLICT (pk) DO UPDATE SET <update>` (or DO NOTHING). Table and column names are constants here. */
function upsert(env: E, table: string, row: Record<string, unknown>, pk: string[], update: string[] | 'nothing' | 'all' = 'all'): Stmt {
  const cols = Object.keys(row);
  const set = update === 'nothing' ? [] : update === 'all' ? cols.filter((c) => !pk.includes(c)) : update;
  const conflict = set.length ? `DO UPDATE SET ${set.map((c) => `\`${c}\` = excluded.\`${c}\``).join(', ')}` : 'DO NOTHING';
  const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT (${pk.map((c) => `\`${c}\``).join(', ')}) ${conflict}`;
  return env.DB.prepare(sql).bind(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

/** Re-asserts the fixture's users as demo users (names and emails as seeded). */
function userStmts(env: E, f: DemoFixture): Stmt[] {
  const out: Stmt[] = [];
  for (const u of f.users) {
    out.push(
      upsert(env, 'user', { id: u.id, name: u.name, email: u.email, avatar_emoji: u.avatarEmoji, created_at: f.seededAt, is_demo: 1 }, ['id'], [
        'name', 'email', 'avatar_emoji', 'is_demo',
      ]),
    );
  }
  return out;
}

/** The synthetic avatars (seed only: the nightly reset keeps avatars as they are). */
function avatarStmts(env: E, f: DemoFixture): Stmt[] {
  return f.avatars.map((a) =>
    upsert(
      env,
      'avatar',
      {
        id: a.id,
        user_id: a.userId,
        napster_companion_id: a.napsterCompanionId,
        napster_agent_id: a.napsterAgentId,
        voice_id: a.voiceId,
        photo_key: a.photoKey,
        status: 'approved',
        approved_at: a.consentAt,
        consent_name: SYNTHETIC_CONSENT_NAME,
        consent_at: a.consentAt,
        is_synthetic: 1,
        parent_title: a.parentTitle,
        created_at: a.consentAt,
      },
      ['id'],
    ),
  );
}

/**
 * Deletes what was added to the demo world since `opts.cutoff` (the EARLIEST seed time, so a re-seed never moves it
 * later), and anything else in demo scope that is not part of
 * the fixture), then re-upserts every fixture row. One D1 batch, so it is all-or-nothing. Avatars, the stored
 * fixture and the personas are only written by the seed (`opts.seed`); Napster and Clerk are never called.
 */
async function applyFixture(env: E, f: DemoFixture, now: number, opts: { seed: boolean; cutoff: number }): Promise<void> {
  const scope = await demoScope(env, f);
  const shift = dayShift(f.seededAt, now);
  const t = (ms: number) => ms + shift;
  const tn = (ms: number | null) => (ms === null ? null : ms + shift);
  const S = opts.cutoff; // "created after the seed" means after the first seed

  const fx = {
    sessions: J(f.sessions.map((x) => x.id)),
    flags: J(f.flags.map((x) => x.id)),
    alerts: J(f.alerts.map((x) => x.id)),
    invites: J(f.invites.map((x) => x.code)),
    enrollments: J(f.enrollments.map((x) => x.id)),
    children: J(f.children.map((x) => x.id)),
    connections: J(f.connections.map((x) => x.id)),
    classrooms: J(f.classrooms.map((x) => x.id)),
    plans: J(f.plans.map((x) => `${x.childId}|${x.avatarId}`)),
    familyMembers: J(f.familyMembers.map((x) => `${x.familyId}|${x.userId}`)),
    orgMembers: J(f.orgMembers.map((x) => `${x.orgId}|${x.userId}`)),
    classroomChildren: J(f.classroomChildren.map((x) => `${x.classroomId}|${x.childId}`)),
    classroomStaff: J(f.classroomStaff.map((x) => `${x.classroomId}|${x.userId}`)),
  };
  const U = J(scope.users);
  const F = J(scope.families);
  const O = J(scope.orgs);
  const C = J(scope.children);
  const XF = J(scope.extraFamilies);
  const XO = J(scope.extraOrgs);

  // Children that go: in a demo family but not in the fixture.
  const delChildren = await ids(env, `SELECT id FROM child WHERE family_id ${IN} AND id ${NOT_IN}`, F, fx.children);
  const DC = J(delChildren);
  // Sessions that go: added since the seed in demo scope (child of a demo family, at a demo daycare, or a test call
  // on a demo user's avatar) and already ended (a judge mid-call keeps theirs; the next reset takes it), plus every
  // session of a child or daycare that goes entirely.
  const delSessions = await ids(
    env,
    `SELECT id FROM comfort_session WHERE id ${NOT_IN} AND (
       (started_at > ? AND ended_at IS NOT NULL AND (child_id ${IN} OR org_id ${IN}
          OR (kind = 'test' AND avatar_id IN (SELECT id FROM avatar WHERE user_id ${IN}))))
       OR child_id ${IN} OR org_id ${IN})`,
    fx.sessions, S, C, O, U, DC, XO,
  );
  const DS = J(delSessions);
  const delFlags = await ids(
    env,
    `SELECT id FROM session_flag WHERE id ${NOT_IN} AND (session_id ${IN} OR (session_id ${IN} AND created_at > ?))`,
    fx.flags, DS, fx.sessions, S,
  );
  const DF = J(delFlags);

  const P = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b);
  const ROOMS_O = `(SELECT id FROM classroom WHERE org_id ${IN})`;

  const stmts: Stmt[] = [];
  if (opts.seed) {
    stmts.push(
      upsert(env, 'demo_fixture', { id: 1, json: JSON.stringify(f), seeded_at: f.seededAt, first_seeded_at: opts.cutoff }, ['id']),
      P('DELETE FROM demo_persona'),
      upsert(env, 'demo_persona', { persona: 'parent', user_id: f.personas.parent }, ['persona']),
      upsert(env, 'demo_persona', { persona: 'teacher', user_id: f.personas.teacher }, ['persona']),
    );
  }
  stmts.push(...userStmts(env, f));
  if (opts.seed) stmts.push(...avatarStmts(env, f));

  // ---- delete phase (children before parents) ----
  stmts.push(
    P(
      `DELETE FROM alert WHERE id ${NOT_IN} AND (ref_id ${IN} OR ref_id ${IN} OR (user_id ${IN} AND created_at > ?))`,
      fx.alerts, DS, DF, U, S,
    ),
    P(`DELETE FROM session_flag WHERE id ${IN}`, DF),
    P(`DELETE FROM comfort_session WHERE id ${IN}`, DS),
    P(`DELETE FROM invite_code WHERE created_by ${IN} AND code ${NOT_IN}`, U, fx.invites),
    P(`DELETE FROM enrollment WHERE org_id ${IN} AND id ${NOT_IN} AND (created_at > ? OR org_id ${IN})`, O, fx.enrollments, S, XO),
    P(`DELETE FROM comfort_plan WHERE child_id ${IN} AND (child_id || '|' || avatar_id) ${NOT_IN}`, C, fx.plans),
    P(
      `DELETE FROM classroom_child WHERE (classroom_id IN ${ROOMS_O} OR child_id ${IN}) AND (classroom_id || '|' || child_id) ${NOT_IN}`,
      O, C, fx.classroomChildren,
    ),
    P(
      `DELETE FROM classroom_staff WHERE (classroom_id IN ${ROOMS_O} OR user_id ${IN}) AND (classroom_id || '|' || user_id) ${NOT_IN}`,
      O, U, fx.classroomStaff,
    ),
    P(`DELETE FROM classroom WHERE org_id ${IN} AND id ${NOT_IN}`, O, fx.classrooms),
    P(`DELETE FROM connection WHERE (child_id ${IN} OR org_id ${IN}) AND id ${NOT_IN}`, C, O, fx.connections),
    P(`DELETE FROM pin_attempt WHERE org_id ${IN} OR device_id IN (SELECT id FROM device WHERE org_id ${IN})`, O, O),
    P(`DELETE FROM device WHERE org_id ${IN} AND (created_at > ? OR org_id ${IN})`, O, S, XO),
    P(`DELETE FROM staff_pin WHERE org_id ${IN} OR user_id ${IN}`, O, U),
    P(`DELETE FROM org_member WHERE (org_id ${IN} OR user_id ${IN}) AND (org_id || '|' || user_id) ${NOT_IN}`, O, U, fx.orgMembers),
    P(`DELETE FROM org WHERE id ${IN}`, XO),
    P(`DELETE FROM child WHERE id ${IN}`, DC),
    P(`DELETE FROM family_member WHERE (family_id ${IN} OR user_id ${IN}) AND (family_id || '|' || user_id) ${NOT_IN}`, F, U, fx.familyMembers),
    P(`DELETE FROM family WHERE id ${IN}`, XF),
  );

  // ---- upsert phase ----
  const tz = new Map(f.children.map((c) => [c.id, c.timezone]));
  for (const o of f.orgs) {
    stmts.push(upsert(env, 'org', { id: o.id, name: o.name, logo_key: o.logoKey, address: o.address, timezone: o.timezone }, ['id']));
  }
  for (const m of f.orgMembers) stmts.push(upsert(env, 'org_member', { org_id: m.orgId, user_id: m.userId, role: m.role }, ['org_id', 'user_id']));
  for (const x of f.families) stmts.push(upsert(env, 'family', { id: x.id, created_at: f.seededAt }, ['id'], 'nothing'));
  for (const m of f.familyMembers) {
    stmts.push(upsert(env, 'family_member', { family_id: m.familyId, user_id: m.userId, role: 'parent' }, ['family_id', 'user_id']));
  }
  for (const c of f.children) {
    stmts.push(
      upsert(env, 'child', { id: c.id, family_id: c.familyId, name: c.name, photo_key: c.photoKey, birthday: c.birthday, timezone: c.timezone }, ['id']),
    );
  }
  for (const p of f.plans) {
    const note = p.todayNote;
    stmts.push(
      upsert(
        env,
        'comfort_plan',
        {
          child_id: p.childId,
          avatar_id: p.avatarId,
          parent_title: p.parentTitle,
          nicknames: JSON.stringify(p.nicknames),
          tone: p.tone,
          favorites: JSON.stringify(p.favorites),
          phrases: JSON.stringify(p.phrases),
          song_title: p.songTitle,
          song_lyrics: p.songLyrics,
          never_topics: JSON.stringify(p.neverTopics),
          today_note: note,
          today_note_expires_at: note ? todayNoteExpiry(tz.get(p.childId) ?? 'UTC', now) : null,
        },
        ['child_id', 'avatar_id'],
      ),
    );
  }
  for (const x of f.connections) {
    stmts.push(
      upsert(
        env,
        'connection',
        { id: x.id, child_id: x.childId, kind: x.kind, org_id: x.orgId, caregiver_user_id: x.caregiverUserId, transcript_access: x.transcriptAccess ? 1 : 0 },
        ['id'],
      ),
    );
  }
  for (const x of f.classrooms) stmts.push(upsert(env, 'classroom', { id: x.id, org_id: x.orgId, name: x.name, emoji: x.emoji }, ['id']));
  for (const x of f.classroomChildren) {
    stmts.push(upsert(env, 'classroom_child', { classroom_id: x.classroomId, child_id: x.childId }, ['classroom_id', 'child_id'], 'nothing'));
  }
  for (const x of f.classroomStaff) {
    stmts.push(upsert(env, 'classroom_staff', { classroom_id: x.classroomId, user_id: x.userId }, ['classroom_id', 'user_id'], 'nothing'));
  }
  // Demo tablet PINs: every demo staff_pin row was deleted above; restore the fixture's, hashed like any PIN.
  for (const x of f.staffPins) {
    stmts.push(upsert(env, 'staff_pin', { user_id: x.userId, org_id: x.orgId, pin_hash: await hashPin(x.pin) }, ['user_id', 'org_id']));
  }
  for (const x of f.invites) {
    stmts.push(
      upsert(
        env,
        'invite_code',
        {
          code: x.code,
          type: x.type,
          payload: JSON.stringify(x.payload),
          created_by: x.createdBy,
          expires_at: t(x.expiresAt),
          used_by: x.usedBy,
          used_at: tn(x.usedAt),
          claim_nonce: null,
        },
        ['code'],
      ),
    );
  }
  for (const x of f.enrollments) {
    stmts.push(
      upsert(
        env,
        'enrollment',
        {
          id: x.id,
          org_id: x.orgId,
          classroom_id: x.classroomId,
          child_name: x.childName,
          invite_code: x.inviteCode,
          child_id: x.childId,
          status: x.status,
          created_at: t(x.createdAt),
        },
        ['id'],
      ),
    );
  }
  for (const s of f.sessions) {
    const transcript = s.transcript.map((i) => ({ ...i, timestamp: new Date(Date.parse(i.timestamp) + shift).toISOString() }));
    stmts.push(
      upsert(
        env,
        'comfort_session',
        {
          id: s.id,
          napster_session_id: null, // never finalized by the cron: summary and transcript come from the fixture
          child_id: s.childId,
          avatar_id: s.avatarId,
          caregiver_user_id: s.caregiverUserId,
          org_id: s.orgId,
          reason: s.reason,
          started_at: t(s.startedAt),
          ended_at: t(s.endedAt),
          duration_s: s.durationS,
          cost_usd: s.costUsd,
          mood_after: s.moodAfter,
          caregiver_note: s.caregiverNote,
          summary: s.summary,
          mood_signal: s.moodSignal,
          status: 'closed',
          kind: 'child',
          transcript_json: JSON.stringify(transcript),
          napster_status: 'closed',
          ended_reason: 'ended',
        },
        ['id'],
      ),
    );
  }
  for (const x of f.flags) {
    stmts.push(
      upsert(
        env,
        'session_flag',
        {
          id: x.id,
          session_id: x.sessionId,
          source: x.source,
          category: x.category,
          quote: x.quote,
          severity: x.severity,
          created_at: t(x.createdAt),
          acknowledged_by: x.acknowledgedBy,
          acknowledged_at: tn(x.acknowledgedAt),
        },
        ['id'],
      ),
    );
  }
  for (const x of f.alerts) {
    stmts.push(
      upsert(
        env,
        'alert',
        { id: x.id, user_id: x.userId, kind: x.kind, ref_id: x.refId, title: x.title, body: x.body, read_at: tn(x.readAt), created_at: t(x.createdAt) },
        ['id'],
      ),
    );
  }

  await env.DB.batch(stmts);
}

type StoredRow = { json: string; seeded_at: number; first_seeded_at: number | null };
const storedRow = (env: E) => env.DB.prepare('SELECT json, seeded_at, first_seeded_at FROM demo_fixture WHERE id = 1').first<StoredRow>();
const cutoffOf = (row: StoredRow) => row.first_seeded_at ?? row.seeded_at;

/** Fixture collections whose rows a seed may only create or re-own when they were already the demo world's. */
const GUARDED: { table: string; col: string; list: (f: Partial<DemoFixture>) => { [k: string]: unknown }[] | undefined; key: string }[] = [
  { table: 'family', col: 'id', list: (f) => f.families, key: 'id' },
  { table: 'org', col: 'id', list: (f) => f.orgs, key: 'id' },
  { table: 'child', col: 'id', list: (f) => f.children, key: 'id' },
  { table: 'classroom', col: 'id', list: (f) => f.classrooms, key: 'id' },
  { table: 'avatar', col: 'id', list: (f) => f.avatars, key: 'id' },
  { table: 'invite_code', col: 'code', list: (f) => f.invites, key: 'code' },
];

/**
 * Refuses (INVALID, before any write) a fixture that would take over real rows:
 * (a) a fixture user id that already exists as a non-demo user;
 * (b) a family / org / child / classroom / avatar id or invite code that already exists but was not part of the
 *     previously stored fixture.
 */
async function assertFixtureOwnsOnlyDemoRows(env: E, f: DemoFixture, prev: StoredRow | null): Promise<void> {
  const realUsers = await ids(env, `SELECT id FROM user WHERE is_demo = 0 AND id ${IN}`, J(f.users.map((u) => u.id)));
  if (realUsers.length) throw apiError('INVALID', `fixture users already exist as non-demo users: ${realUsers.join(', ')}`);
  let before: Partial<DemoFixture> = {};
  if (prev) {
    try {
      before = JSON.parse(prev.json) as Partial<DemoFixture>;
    } catch {
      before = {};
    }
  }
  for (const g of GUARDED) {
    const want = (g.list(f) ?? []).map((x) => String(x[g.key]));
    if (!want.length) continue;
    const known = new Set((g.list(before) ?? []).map((x) => String(x[g.key])));
    const existing = await ids(env, `SELECT ${g.col} AS id FROM ${g.table} WHERE ${g.col} ${IN}`, J(want));
    const foreign = existing.filter((id) => !known.has(id));
    if (foreign.length) throw apiError('INVALID', `fixture ${g.table} ids already exist outside the demo world: ${foreign.join(', ')}`);
  }
}

/**
 * PUT /api/admin/seed: checks the fixture only claims demo rows, then stores the fixture (keeping the earliest seed
 * time as the reset cutoff) and personas, marks the fixture users demo, writes the synthetic avatars and applies the
 * fixture (the same clean-up + upsert as the nightly reset). Idempotent.
 */
export async function seedDemoWorld(env: E, fixture: DemoFixture, now = Date.now()): Promise<void> {
  const prev = await storedRow(env);
  await assertFixtureOwnsOnlyDemoRows(env, fixture, prev);
  const cutoff = prev ? Math.min(cutoffOf(prev), fixture.seededAt) : fixture.seededAt;
  await applyFixture(env, fixture, now, { seed: true, cutoff });
}

/** The stored fixture and its reset cutoff, or null when the seed has not run (or the stored JSON no longer validates). */
export async function loadFixture(env: E): Promise<{ fixture: DemoFixture; cutoff: number } | null> {
  const row = await storedRow(env);
  if (!row) return null;
  try {
    return { fixture: DemoFixture.parse(JSON.parse(row.json)), cutoff: cutoffOf(row) };
  } catch (e) {
    console.error('demo: stored fixture is invalid; skipping reset', e);
    return null;
  }
}

/**
 * Nightly (08:00 UTC) demo-world reset: prunes old rate-limit windows, then (once seeded) removes what judges added
 * to demo families and daycares since the seed and restores every fixture row. Avatars, Napster companions and
 * agents are kept; Napster and Clerk are never called. Non-demo data is never touched.
 */
export async function resetDemoWorld(env: E, now = Date.now()): Promise<void> {
  await pruneRateLimits(env, now);
  const stored = await loadFixture(env);
  if (!stored) return;
  await applyFixture(env, stored.fixture, now, { seed: false, cutoff: stored.cutoff });
}
