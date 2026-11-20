// Pure: turns personas.ts plus the ids made during a seed run into the fixture PUT to /api/admin/seed.
// Validated by the same Zod schema the API uses (packages/shared/src/demo.ts).
import { DemoFixture, type DemoFixtureInput } from '../../packages/shared/src/demo';
import { todayNoteExpiry } from '../../packages/shared/src/time';
import { generateCode } from '../../packages/shared/src/inviteCode';
import {
  ADULTS, CHILDREN, CLASSROOM, DEMO_PINS, ORG, PERSONAS, PLANS, SESSIONS, fullName,
  type AdultKey, type Child, type ChildKey, type SessionSeed,
} from './personas';

const MIN = 60_000;
const DAY = 86_400_000;

/** Ids created by the seed run (Clerk users, Napster resources, R2 keys). */
export type SeedIds = {
  users: Record<AdultKey, string>;
  avatars: Partial<Record<AdultKey, { companionId: string; agentId: string; photoKey: string | null }>>;
  childPhotos: Partial<Record<ChildKey, string>>;
  logoKey: string | null;
  /** Invite code per slot (see inviteSlots), drawn with the server's random generator at seed time. */
  inviteCodes: Record<string, string>;
};

/** One invite per roster child (enrollment), plus the co-parent, staff and nanny invites. */
export const inviteSlots = (): string[] => [...CHILDREN.map((c) => `enroll.${c.key}`), 'co_parent', 'staff', 'home_caregiver'];

/** Fresh, distinct random codes for every slot (the same generator as createInvite; never guessable sequences). */
export function randomInviteCodes(): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const slot of inviteSlots()) {
    let c = generateCode();
    while (used.has(c)) c = generateCode();
    used.add(c);
    out[slot] = c;
  }
  return out;
}

/**
 * The slot -> code map of an earlier fixture (the one last PUT), or null when it does not cover every slot. A targeted
 * re-seed reuses these so the push keeps the demo world's existing invite rows instead of replacing them.
 */
export function inviteCodesOf(prev: { invites?: { code: string; type: string; payload: Record<string, unknown> }[] } | null): Record<string, string> | null {
  if (!prev?.invites) return null;
  const out: Record<string, string> = {};
  for (const i of prev.invites) {
    const enr = typeof i.payload.enrollmentId === 'string' ? /^demo\.enr\.(.+)$/.exec(i.payload.enrollmentId)?.[1] : undefined;
    const slot = i.type === 'parent_enrollment' && enr ? `enroll.${enr}` : i.type;
    out[slot] = i.code;
  }
  const slots = inviteSlots();
  return slots.every((s) => out[s]) && new Set(slots.map((s) => out[s])).size === slots.length ? Object.fromEntries(slots.map((s) => [s, out[s]!])) : null;
}

// Fixed fixture ids. They contain '.', which never appears in server ids (nanoid) or Clerk ids, so they can't collide.
export const familyIdOf = (c: Child): string =>
  c.parents.length ? `demo.fam.${ADULTS[c.parents[0]!].lastName.toLowerCase()}` : `demo.fam.${c.key}`;
export const childId = (k: ChildKey) => `demo.child.${k}`;
export const avatarId = (k: AdultKey) => `demo.av.${k}`;
export const sessionId = (s: SessionSeed) => `demo.sess.${s.key}`;

/** Ids for --dry-run (nothing created anywhere). */
export function placeholderIds(): SeedIds {
  const users = Object.fromEntries(Object.keys(ADULTS).map((k) => [k, `user_dryrun_${k}`])) as Record<AdultKey, string>;
  const avatars: SeedIds['avatars'] = {};
  for (const a of Object.values(ADULTS)) {
    // A persona's preset (already existing) companion is real even in a dry run; everything else is a placeholder.
    if (a.avatar) avatars[a.key] = { companionId: a.avatar.companionId ?? `dryrun-companion-${a.key}`, agentId: `dryrun-agent-${a.key}`, photoKey: null };
  }
  return { users, avatars, childPhotos: {}, logoKey: null, inviteCodes: randomInviteCodes() };
}

/** Start (UTC ms) of the local day containing `ms` (same walk as apps/api/src/lib/orgTime.ts). */
function localDayStart(tz: string, ms: number): number {
  let start = todayNoteExpiry(tz, ms - 26 * 3_600_000);
  for (;;) {
    const next = todayNoteExpiry(tz, start);
    if (next > ms) return start;
    start = next;
  }
}

/** `daysAgo` local days before the day of `ref`, at local "HH:MM". */
export function localTimeBefore(tz: string, ref: number, daysAgo: number, hhmm: string): number {
  let day = localDayStart(tz, ref);
  for (let i = 0; i < daysAgo; i++) day = localDayStart(tz, day - 1);
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return day + (h * 60 + m) * MIN;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function buildFixture(ids: SeedIds, seededAt: number): DemoFixture {
  const uid = (k: AdultKey) => ids.users[k];
  const code = (slot: string) => {
    const c = ids.inviteCodes[slot];
    if (!c) throw new Error(`no invite code for slot ${slot}`);
    return c;
  };
  const orgId = ORG.id;
  const roomId = CLASSROOM.id;
  const linked = CHILDREN.filter((c) => c.rosterStatus !== 'invite_sent'); // has a child row
  const families = [...new Set(linked.map(familyIdOf))];
  const parentsOf = (k: ChildKey) => CHILDREN.find((c) => c.key === k)!.parents;
  const enrolledAt = localTimeBefore(ORG.timezone, seededAt, 24, '08:00');

  const f: DemoFixtureInput = {
    version: 1,
    seededAt,
    personas: { parent: uid(PERSONAS.parent), teacher: uid(PERSONAS.teacher) },
    users: Object.values(ADULTS).map((a) => ({ id: uid(a.key), name: fullName(a), email: a.email })),
    orgs: [{ id: orgId, name: ORG.name, address: ORG.address, timezone: ORG.timezone, logoKey: ids.logoKey }],
    orgMembers: [
      { orgId, userId: uid(ORG.admin), role: 'admin' },
      { orgId, userId: uid(CLASSROOM.teacher), role: 'teacher' },
    ],
    families: families.map((id) => ({ id })),
    familyMembers: linked.flatMap((c) => c.parents.map((p) => ({ familyId: familyIdOf(c), userId: uid(p) }))).filter(
      (m, i, all) => all.findIndex((x) => x.familyId === m.familyId && x.userId === m.userId) === i,
    ),
    children: linked.map((c) => ({
      id: childId(c.key),
      familyId: familyIdOf(c),
      name: c.name,
      photoKey: ids.childPhotos[c.key] ?? null,
      birthday: c.birthday,
      timezone: ORG.timezone,
    })),
    avatars: Object.values(ADULTS)
      .filter((a) => a.avatar)
      .map((a) => {
        const made = ids.avatars[a.key];
        if (!made) throw new Error(`no Napster avatar for ${a.key}`);
        return {
          id: avatarId(a.key),
          userId: uid(a.key),
          napsterCompanionId: made.companionId,
          napsterAgentId: made.agentId,
          voiceId: a.avatar!.voiceId,
          photoKey: made.photoKey,
          parentTitle: a.avatar!.parentTitle,
          consentAt: seededAt - 14 * DAY,
        };
      }),
    plans: PLANS.map((p) => ({
      childId: childId(p.child),
      avatarId: avatarId(p.parent),
      parentTitle: ADULTS[p.parent].avatar!.parentTitle,
      tone: p.tone,
      nicknames: p.nicknames,
      favorites: p.favorites,
      phrases: p.phrases,
      songTitle: p.songTitle ?? null,
      songLyrics: p.songLyrics ?? null,
      neverTopics: p.neverTopics,
      todayNote: p.todayNote ?? null,
    })),
    connections: linked.flatMap((c) => [
      { id: `demo.cn.${c.key}.daycare`, childId: childId(c.key), kind: 'daycare' as const, orgId, transcriptAccess: c.daycareTranscripts },
      ...(c.homeCaregiver
        ? [{ id: `demo.cn.${c.key}.home`, childId: childId(c.key), kind: 'home' as const, caregiverUserId: uid(c.homeCaregiver), transcriptAccess: true }]
        : []),
    ]),
    classrooms: [{ id: roomId, orgId, name: CLASSROOM.name, emoji: CLASSROOM.emoji }],
    classroomChildren: linked.map((c) => ({ classroomId: roomId, childId: childId(c.key) })),
    classroomStaff: [{ classroomId: roomId, userId: uid(CLASSROOM.teacher) }],
    staffPins: DEMO_PINS.map((p) => ({ orgId, userId: uid(p.adult), pin: p.pin })),
    invites: [],
    enrollments: [],
    sessions: [],
    flags: [],
    alerts: [],
  };

  // Enrollment invites (one per roster child; used once the parent linked the child), plus the invites that
  // brought in the co-parent, the teacher and the nanny.
  CHILDREN.forEach((c, i) => {
    const createdAt = enrolledAt + i * 7 * MIN;
    const isLinked = c.rosterStatus !== 'invite_sent';
    const enrollmentId = `demo.enr.${c.key}`;
    f.invites!.push({
      code: code(`enroll.${c.key}`),
      type: 'parent_enrollment',
      payload: { orgId, enrollmentId },
      createdBy: uid(ORG.admin),
      expiresAt: isLinked ? createdAt + 7 * DAY : seededAt + 6 * DAY,
      usedBy: isLinked && c.parents[0] ? uid(c.parents[0]) : null,
      usedAt: isLinked ? createdAt + DAY : null,
    });
    f.enrollments!.push({
      id: enrollmentId,
      orgId,
      classroomId: roomId,
      childName: c.name,
      inviteCode: code(`enroll.${c.key}`),
      childId: isLinked ? childId(c.key) : null,
      status: isLinked ? 'linked' : 'invited',
      createdAt,
    });
  });
  const extra = (n: number, type: 'co_parent' | 'staff' | 'home_caregiver', payload: Record<string, unknown>, by: AdultKey, to: AdultKey) => {
    const createdAt = enrolledAt - 2 * DAY + n * MIN;
    f.invites!.push({ code: code(type), type, payload, createdBy: uid(by), expiresAt: createdAt + 7 * DAY, usedBy: uid(to), usedAt: createdAt + 3 * 3_600_000 });
  };
  const mia = CHILDREN.find((c) => c.key === 'mia')!;
  const leo = CHILDREN.find((c) => c.key === 'leo')!;
  extra(9, 'co_parent', { familyId: familyIdOf(mia) }, 'sarah', 'marcus');
  extra(10, 'staff', { orgId }, ORG.admin, CLASSROOM.teacher);
  extra(11, 'home_caregiver', { familyId: familyIdOf(leo), childIds: [childId('leo')] }, 'david', 'rosa');

  // Past sessions, their flag, and the alerts the parents (and, for flags, daycare admins) received.
  for (const s of SESSIONS) {
    const id = sessionId(s);
    const child = CHILDREN.find((c) => c.key === s.child)!;
    const startedAt = localTimeBefore(ORG.timezone, seededAt, s.daysAgo, s.localTime);
    const endedAt = startedAt + s.durationS * 1000;
    const at = (i: number) => startedAt + 2000 + Math.round((i * (s.durationS - 4) * 1000) / s.lines.length);
    f.sessions!.push({
      id,
      childId: childId(s.child),
      avatarId: avatarId(s.parent),
      caregiverUserId: uid(s.caregiver),
      orgId: s.atDaycare ? orgId : null,
      reason: s.reason,
      startedAt,
      endedAt,
      durationS: s.durationS,
      costUsd: s.costUsd,
      moodAfter: s.moodAfter,
      caregiverNote: s.caregiverNote ?? null,
      summary: s.summary,
      moodSignal: s.moodSignal,
      transcript: s.lines.map((l, i) => ({ role: l.who === 'child' ? 'User' : 'Assistant', text: l.text, timestamp: new Date(at(i)).toISOString() })),
    });
    const parents = parentsOf(s.child);
    const summaryAt = endedAt + 90_000;
    for (const p of parents) {
      f.alerts!.push({
        id: `demo.alert.${s.key}.${p}`,
        userId: uid(p),
        kind: 'summary',
        refId: id,
        title: `💛 ${child.name}'s comfort session`,
        body: s.summary,
        readAt: s.daysAgo >= 2 ? summaryAt + 2 * 3_600_000 : null,
        createdAt: summaryAt,
      });
    }
    if (s.flag) {
      const lineIdx = s.lines.findIndex((l) => l.who === 'child' && l.text.includes(s.flag!.quote));
      const flagAt = at(Math.max(0, lineIdx)) + 1500;
      f.flags!.push({ id: `demo.flag.${s.key}`, sessionId: id, source: s.flag.source, category: s.flag.category, quote: s.flag.quote, severity: s.flag.severity, createdAt: flagAt });
      const recipients = [...new Set<AdultKey>([...parents, ...(s.atDaycare ? [ORG.admin] : [])])];
      for (const p of recipients) {
        f.alerts!.push({
          id: `demo.alert.${s.key}.flag.${p}`,
          userId: uid(p),
          kind: 'flag',
          refId: id,
          title: `⚑ Heads up about ${child.name}`,
          body: clip(s.flag.quote, 140),
          createdAt: flagAt,
        });
      }
    }
  }

  return DemoFixture.parse(f);
}
