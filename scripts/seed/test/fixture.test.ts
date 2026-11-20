import { describe, it, expect } from 'vitest';
import { DemoFixture } from '../../../packages/shared/src/demo';
import { buildFixture, inviteCodesOf, inviteSlots, localTimeBefore, placeholderIds, randomInviteCodes, type SeedIds } from '../fixture';
import { CHILDREN, SESSIONS, VAMSHI_COMPANION_ID } from '../personas';

// A Chicago afternoon (CST): 2026-11-18 15:00 local = 21:00 UTC.
const SEEDED = Date.UTC(2026, 10, 18, 21, 0, 0);
const DAY = 86_400_000;

const CODES = Object.fromEntries(inviteSlots().map((slot, i) => [slot, `K${'ABCDEFGHJKMN'[i]}7PQ2`]));

function ids(): SeedIds {
  const p = placeholderIds();
  return {
    ...p,
    inviteCodes: CODES,
    avatars: Object.fromEntries(Object.entries(p.avatars).map(([k, v]) => [k, { ...v!, photoKey: `avatar/${p.users[k as 'sarah']}/abcdefghijklmnopqrstu.png` }])),
    childPhotos: { mia: 'child/demo.fam.johnson/abcdefghijklmnopqrstu.png' },
    logoKey: 'logo/demo.org.acorns/abcdefghijklmnopqrstu.png',
  };
}

describe('buildFixture', () => {
  const f = buildFixture(ids(), SEEDED);

  it('is valid against the API schema (also after a JSON round trip, as PUT sends it)', () => {
    expect(DemoFixture.safeParse(JSON.parse(JSON.stringify(f))).success).toBe(true);
    expect(DemoFixture.safeParse(buildFixture(placeholderIds(), SEEDED)).success).toBe(true);
  });

  it('is deterministic for the same ids and seed time', () => {
    expect(buildFixture(ids(), SEEDED)).toEqual(f);
  });

  it('maps the personas to Sarah and Jess', () => {
    expect(f.personas).toEqual({ parent: 'user_dryrun_sarah', teacher: 'user_dryrun_jess' });
    expect(f.users.map((u) => u.name)).toContain('Tanya Brooks');
  });

  it('gives Ms. Jess and Tanya their demo PINs (1234 and 2468) so the tablet PIN switch can be demoed', () => {
    expect(f.staffPins).toEqual([
      { orgId: 'demo.org.acorns', userId: 'user_dryrun_jess', pin: '1234' },
      { orgId: 'demo.org.acorns', userId: 'user_dryrun_tanya', pin: '2468' },
    ]);
  });

  it('builds the roster: a child row only for linked children, and enrollments matching each status', () => {
    expect(f.children.map((c) => c.name)).toEqual(['Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Eli', 'Sam']);
    for (const c of CHILDREN) {
      const e = f.enrollments.find((x) => x.childName === c.name)!;
      expect(e.status, c.key).toBe(c.rosterStatus === 'invite_sent' ? 'invited' : 'linked');
      const inv = f.invites.find((i) => i.code === e.inviteCode)!;
      expect(inv.usedAt === null, c.key).toBe(c.rosterStatus === 'invite_sent');
      if (c.rosterStatus === 'invite_sent') expect(inv.expiresAt).toBeGreaterThan(SEEDED);
    }
    // Leo is at daycare and at home with Rosa.
    expect(f.connections.filter((c) => c.childId === 'demo.child.leo').map((c) => c.kind).sort()).toEqual(['daycare', 'home']);
    expect(f.classroomStaff).toEqual([{ classroomId: 'demo.room.butterflies', userId: 'user_dryrun_jess' }]);
  });

  it('gives every ready child at least one approved avatar owned by a member of its family (Ava: two)', () => {
    for (const c of CHILDREN) {
      const child = f.children.find((x) => x.id === `demo.child.${c.key}`);
      const members = child ? f.familyMembers.filter((m) => m.familyId === child.familyId).map((m) => m.userId) : [];
      const avatars = f.avatars.filter((a) => members.includes(a.userId));
      if (c.rosterStatus === 'ready') expect(avatars.length, c.key).toBeGreaterThanOrEqual(1);
      else expect(avatars, c.key).toEqual([]);
      for (const a of avatars) expect(f.plans.some((p) => p.childId === child!.id && p.avatarId === a.id), `${c.key} plan`).toBe(true);
    }
    const ava = f.children.find((x) => x.id === 'demo.child.ava')!;
    expect(f.avatars.filter((a) => f.familyMembers.some((m) => m.familyId === ava.familyId && m.userId === a.userId))).toHaveLength(2);
    // Roster parents are demo users, but not sign-in personas.
    expect(f.users).toHaveLength(11);
    expect(Object.values(f.personas)).toEqual(['user_dryrun_sarah', 'user_dryrun_jess']);
  });

  it('takes its invite codes from the seed run (normal random generator), and ids that cannot collide', () => {
    expect(f.invites.map((i) => i.code).sort()).toEqual(Object.values(CODES).sort());
    const fresh = randomInviteCodes();
    expect(Object.keys(fresh).sort()).toEqual(inviteSlots().sort());
    expect(new Set(Object.values(fresh)).size).toBe(inviteSlots().length);
    for (const c of Object.values(fresh)) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(Object.values(randomInviteCodes())).not.toEqual(Object.values(fresh));
    expect(() => buildFixture({ ...ids(), inviteCodes: {} }, SEEDED)).toThrow(/invite code/);
    for (const id of [...f.children, ...f.sessions, ...f.families, ...f.avatars, ...f.connections].map((x) => x.id)) expect(id).toContain('.');
  });

  it('reads the slot codes back from an earlier fixture (for a targeted re-seed), or null when any is missing', () => {
    expect(inviteCodesOf(JSON.parse(JSON.stringify(f)))).toEqual(CODES);
    expect(buildFixture({ ...ids(), inviteCodes: inviteCodesOf(f)! }, SEEDED).invites).toEqual(f.invites);
    expect(inviteCodesOf({ invites: f.invites.slice(1) })).toBeNull();
    expect(inviteCodesOf(null)).toBeNull();
  });

  it('carries the 8 sessions before the seed, at their local Chicago times, with transcripts', () => {
    expect(f.sessions).toHaveLength(8);
    for (const s of f.sessions) {
      expect(s.startedAt).toBeLessThan(SEEDED);
      expect(s.endedAt - s.startedAt).toBe(s.durationS * 1000);
      for (const t of s.transcript) {
        const ts = Date.parse(t.timestamp);
        expect(ts).toBeGreaterThanOrEqual(s.startedAt);
        expect(ts).toBeLessThanOrEqual(s.endedAt);
      }
    }
    const s5 = f.sessions.find((s) => s.id === 'demo.sess.s5')!;
    expect(s5.startedAt).toBe(Date.UTC(2026, 10, 15, 21, 40)); // 3 days earlier, 15:40 CST
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(s5.startedAt)).toBe('15:40');
  });

  it('grounds the single flag in a User (child) line of its session and alerts the parents and the admin', () => {
    expect(f.flags).toHaveLength(1);
    const flag = f.flags[0]!;
    const s = f.sessions.find((x) => x.id === flag.sessionId)!;
    expect(s.reason).toBe('boo_boo');
    expect(s.transcript.some((t) => t.role === 'User' && t.text.includes(flag.quote))).toBe(true);
    const flagAlerts = f.alerts.filter((a) => a.kind === 'flag').map((a) => a.userId).sort();
    expect(flagAlerts).toEqual(['user_dryrun_marcus', 'user_dryrun_sarah', 'user_dryrun_tanya']);
  });

  it('gives each parent a summary alert per session of their child; only recent ones unread', () => {
    const summaries = f.alerts.filter((a) => a.kind === 'summary');
    const expected = SESSIONS.reduce((n, s) => n + CHILDREN.find((c) => c.key === s.child)!.parents.length, 0);
    expect(summaries).toHaveLength(expected);
    for (const a of summaries) {
      const s = f.sessions.find((x) => x.id === a.refId)!;
      expect(a.body).toBe(s.summary);
      const seedSession = SESSIONS.find((x) => `demo.sess.${x.key}` === s.id)!;
      expect(a.readAt === null).toBe(seedSession.daysAgo < 2); // yesterday's are still unread
    }
  });

  it('passes the R2 keys through and keeps the today note', () => {
    expect(f.orgs[0]!.logoKey).toBe('logo/demo.org.acorns/abcdefghijklmnopqrstu.png');
    expect(f.children.find((c) => c.id === 'demo.child.mia')!.photoKey).toBe('child/demo.fam.johnson/abcdefghijklmnopqrstu.png');
    expect(f.avatars.every((a) => a.photoKey?.startsWith('avatar/'))).toBe(true);
    expect(f.plans.find((p) => p.childId === 'demo.child.mia' && p.avatarId === 'demo.av.sarah')!.todayNote).toMatch(/sleep/);
  });

  it("shows Mia's Daddy as Vamshi Krishna on his own companion, with the run's agent and photo key", () => {
    const daddy = f.avatars.find((a) => a.id === 'demo.av.marcus')!;
    expect(daddy).toMatchObject({
      userId: 'user_dryrun_marcus',
      napsterCompanionId: VAMSHI_COMPANION_ID,
      napsterAgentId: 'dryrun-agent-marcus',
      voiceId: 'cedar',
      parentTitle: 'Daddy',
      photoKey: 'avatar/user_dryrun_marcus/abcdefghijklmnopqrstu.png',
    });
    expect(f.users.find((u) => u.id === 'user_dryrun_marcus')).toEqual(
      expect.objectContaining({ name: 'Vamshi Krishna', email: 'marcus.johnson.demo@everthere.app' }),
    );
    // Mia's family keeps both ready avatars: Mommy and Daddy, each with a plan for Mia.
    const mia = f.children.find((c) => c.id === 'demo.child.mia')!;
    const members = f.familyMembers.filter((m) => m.familyId === mia.familyId).map((m) => m.userId);
    expect(f.avatars.filter((a) => members.includes(a.userId)).map((a) => a.parentTitle).sort()).toEqual(['Daddy', 'Mommy']);
    expect(f.plans.filter((p) => p.childId === mia.id).map((p) => p.parentTitle).sort()).toEqual(['Daddy', 'Mommy']);
    expect(mia.familyId).toBe('demo.fam.johnson'); // family id comes from Sarah, so it is unchanged
    // Other parents still use their own (placeholder) companions.
    expect(f.avatars.find((a) => a.id === 'demo.av.sarah')!.napsterCompanionId).toBe('dryrun-companion-sarah');
  });

  it('refuses to build without a Napster avatar for every parent', () => {
    const p = placeholderIds();
    delete p.avatars.david;
    expect(() => buildFixture(p, SEEDED)).toThrow(/david/);
  });
});

describe('localTimeBefore', () => {
  it('returns the local wall time N days before, across a DST change', () => {
    // 2026-11-01 is the US fall-back day; 3 days before Nov 3 at 09:00 CDT/CST.
    const ref = Date.UTC(2026, 10, 3, 18, 0);
    expect(localTimeBefore('America/Chicago', ref, 0, '09:00')).toBe(Date.UTC(2026, 10, 3, 15, 0)); // CST
    expect(localTimeBefore('America/Chicago', ref, 3, '09:00')).toBe(Date.UTC(2026, 9, 31, 14, 0)); // CDT
  });
});
