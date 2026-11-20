import { z } from 'zod';
import { CUSTOM_VOICE_RE, FLAG_CATEGORIES, SEVERITIES, VOICES } from './domain';
import { ianaZone, isoDate } from './schemas';

// Demo world + admin (Task 15). Shared by the API (validation) and scripts/seed (fixture builder).

export const DEMO_PERSONAS = ['parent', 'teacher'] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

/** POST /api/demo/sign-in */
export const DemoSignInBody = z.object({ persona: z.enum(DEMO_PERSONAS) });

/** PUT /api/admin/credit-guard */
export const CreditGuardBody = z.object({ capUsd: z.number().finite().min(0).max(150) });

/** Every demo user's email ends with this (the seed creates them as <first>.<last>.demo@everthere.app). */
export const DEMO_EMAIL_SUFFIX = '.demo@everthere.app';

/** The consent name recorded for every seeded (AI-generated) demo face. */
export const SYNTHETIC_CONSENT_NAME = 'AI-generated face, no real person';

/** The consent name for a demo avatar that is the account owner's own digital twin (a real person, `is_synthetic` 0). */
export const selfConsentName = (ownerName: string): string =>
  `${ownerName} (self: the account owner's own likeness and voice, consented by the owner)`;

const fxId = z.string().min(1).max(64);
const fxTs = z.number().int().nonnegative();
const fxKey = z.string().min(1).max(200).nullable().default(null);
const fxList = z.array(z.string().min(1).max(40)).max(12).default([]);
const fxText = (max: number) => z.string().trim().min(1).max(max);
const fxOptText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);

/** One transcript line as Napster reports it: `User` is the child, `Assistant` the parent's avatar. */
export const TranscriptItem = z.object({
  role: z.enum(['User', 'Assistant', 'System']),
  text: z.string().min(1).max(2000),
  timestamp: z.string().datetime(),
});

const demoEmail = z
  .string()
  .email()
  .max(200)
  .refine((e) => e.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX) && e.length > DEMO_EMAIL_SUFFIX.length, `must end with ${DEMO_EMAIL_SUFFIX}`);
const FxUser = z.object({ id: fxId, name: fxText(80), email: demoEmail, avatarEmoji: z.string().max(16).nullable().default(null) });
const FxOrg = z.object({ id: fxId, name: fxText(80), address: fxOptText(200), timezone: ianaZone, logoKey: fxKey });
const FxOrgMember = z.object({ orgId: fxId, userId: fxId, role: z.enum(['admin', 'teacher']) });
const FxFamily = z.object({ id: fxId });
const FxFamilyMember = z.object({ familyId: fxId, userId: fxId });
const FxChild = z.object({ id: fxId, familyId: fxId, name: fxText(60), photoKey: fxKey, birthday: isoDate.nullable().default(null), timezone: ianaZone });
const FxAvatar = z.object({
  id: fxId,
  userId: fxId,
  napsterCompanionId: fxId,
  napsterAgentId: fxId,
  /** A stock voice, or `custom:<id>` for a digital twin's own cloned voice. */
  voiceId: z.union([z.enum(VOICES), z.string().regex(CUSTOM_VOICE_RE)]),
  photoKey: fxKey,
  parentTitle: fxText(20),
  consentAt: fxTs,
  /** Absent: an AI-generated face (synthetic). `self`: the account owner's own likeness and voice. */
  likeness: z.object({ kind: z.literal('self'), ownerName: fxText(80) }).optional(),
});
const FxPlan = z.object({
  childId: fxId,
  avatarId: fxId,
  parentTitle: fxText(20),
  tone: z.enum(['calm', 'playful', 'soothing']),
  nicknames: fxList,
  favorites: fxList,
  phrases: fxList,
  songTitle: fxOptText(120),
  songLyrics: fxOptText(1500),
  neverTopics: fxList,
  todayNote: fxOptText(120),
});
const FxConnection = z.object({
  id: fxId,
  childId: fxId,
  kind: z.enum(['daycare', 'home']),
  orgId: fxId.nullable().default(null),
  caregiverUserId: fxId.nullable().default(null),
  transcriptAccess: z.boolean().default(false),
});
const FxClassroom = z.object({ id: fxId, orgId: fxId, name: fxText(40), emoji: z.string().min(1).max(80).nullable().default(null) });
const FxClassroomChild = z.object({ classroomId: fxId, childId: fxId });
const FxClassroomStaff = z.object({ classroomId: fxId, userId: fxId });
/** A demo staff member's tablet PIN. Demo-only and public by design; the API stores only its hash. */
const FxStaffPin = z.object({ orgId: fxId, userId: fxId, pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits') });
const FxInvite = z.object({
  code: z.string().min(1).max(32),
  type: z.enum(['staff', 'parent_enrollment', 'co_parent', 'home_caregiver']),
  payload: z.record(z.unknown()).default({}),
  createdBy: fxId,
  expiresAt: fxTs,
  usedBy: fxId.nullable().default(null),
  usedAt: fxTs.nullable().default(null),
});
const FxEnrollment = z.object({
  id: fxId,
  orgId: fxId,
  classroomId: fxId,
  childName: fxText(60),
  inviteCode: z.string().min(1).max(32),
  childId: fxId.nullable().default(null),
  status: z.enum(['invited', 'linked']),
  createdAt: fxTs,
});
const FxSession = z.object({
  id: fxId,
  childId: fxId,
  avatarId: fxId,
  caregiverUserId: fxId,
  orgId: fxId.nullable().default(null),
  reason: z.enum(['missing_parent', 'upset_nap', 'new_nervous', 'boo_boo']),
  startedAt: fxTs,
  endedAt: fxTs,
  durationS: z.number().int().nonnegative().max(3600),
  costUsd: z.number().nonnegative().max(100),
  moodAfter: z.enum(['calmer', 'same', 'upset']).nullable().default(null),
  caregiverNote: fxOptText(500),
  summary: fxText(600),
  moodSignal: z.enum(['better', 'same', 'worse', 'unclear']),
  transcript: z.array(TranscriptItem).min(1).max(60),
});
const FxFlag = z.object({
  id: fxId,
  sessionId: fxId,
  source: z.enum(['live', 'manual', 'post']),
  category: z.enum(FLAG_CATEGORIES),
  quote: fxText(1000),
  severity: z.enum(SEVERITIES),
  createdAt: fxTs,
  acknowledgedBy: fxId.nullable().default(null),
  acknowledgedAt: fxTs.nullable().default(null),
});
const FxAlert = z.object({
  id: fxId,
  userId: fxId,
  kind: z.enum(['summary', 'flag', 'invite', 'avatar_ready']),
  refId: fxId.nullable().default(null),
  title: fxText(120),
  body: z.string().max(600).nullable().default(null),
  readAt: fxTs.nullable().default(null),
  createdAt: fxTs,
});

const many = <T extends z.ZodTypeAny>(t: T, max = 200) => z.array(t).max(max).default([]);

/**
 * The demo-world fixture produced by scripts/seed and accepted by PUT /api/admin/seed. It is stored as-is and
 * re-applied by the nightly reset. Keys are unique per collection and every reference points at a row of the
 * fixture itself (a fixture can never reach outside the demo world).
 */
export const DemoFixture = z
  .object({
    version: z.literal(1),
    seededAt: fxTs,
    personas: z.object({ parent: fxId, teacher: fxId }),
    users: z.array(FxUser).min(1).max(50),
    orgs: many(FxOrg, 10),
    orgMembers: many(FxOrgMember),
    families: many(FxFamily, 50),
    familyMembers: many(FxFamilyMember),
    children: many(FxChild, 50),
    avatars: many(FxAvatar, 20),
    plans: many(FxPlan),
    connections: many(FxConnection),
    classrooms: many(FxClassroom, 20),
    classroomChildren: many(FxClassroomChild),
    classroomStaff: many(FxClassroomStaff),
    staffPins: many(FxStaffPin, 50),
    invites: many(FxInvite),
    enrollments: many(FxEnrollment),
    sessions: many(FxSession, 50),
    flags: many(FxFlag),
    alerts: many(FxAlert, 400),
  })
  .superRefine((f, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const keys = <T>(list: T[], key: (x: T) => string, name: string) => {
      const set = new Set<string>();
      for (const x of list) {
        const k = key(x);
        if (set.has(k)) issue([name], `duplicate ${name} key ${k}`);
        set.add(k);
      }
      return set;
    };
    const users = keys(f.users, (x) => x.id, 'users');
    const orgs = keys(f.orgs, (x) => x.id, 'orgs');
    const families = keys(f.families, (x) => x.id, 'families');
    const children = keys(f.children, (x) => x.id, 'children');
    const avatars = keys(f.avatars, (x) => x.id, 'avatars');
    const classrooms = keys(f.classrooms, (x) => x.id, 'classrooms');
    const sessions = keys(f.sessions, (x) => x.id, 'sessions');
    const invites = keys(f.invites, (x) => x.code, 'invites');
    const flags = keys(f.flags, (x) => x.id, 'flags');
    keys(f.orgMembers, (x) => `${x.orgId}|${x.userId}`, 'orgMembers');
    keys(f.familyMembers, (x) => `${x.familyId}|${x.userId}`, 'familyMembers');
    keys(f.plans, (x) => `${x.childId}|${x.avatarId}`, 'plans');
    keys(f.connections, (x) => x.id, 'connections');
    keys(f.classroomChildren, (x) => `${x.classroomId}|${x.childId}`, 'classroomChildren');
    keys(f.classroomStaff, (x) => `${x.classroomId}|${x.userId}`, 'classroomStaff');
    keys(f.staffPins, (x) => `${x.orgId}|${x.userId}`, 'staffPins');
    keys(f.enrollments, (x) => x.id, 'enrollments');
    keys(f.alerts, (x) => x.id, 'alerts');

    const ref = (set: Set<string>, v: string | null, path: (string | number)[]) => {
      if (v !== null && !set.has(v)) issue(path, `unknown reference ${v}`);
    };
    ref(users, f.personas.parent, ['personas', 'parent']);
    ref(users, f.personas.teacher, ['personas', 'teacher']);
    f.orgMembers.forEach((x, i) => (ref(orgs, x.orgId, ['orgMembers', i]), ref(users, x.userId, ['orgMembers', i])));
    f.familyMembers.forEach((x, i) => (ref(families, x.familyId, ['familyMembers', i]), ref(users, x.userId, ['familyMembers', i])));
    f.children.forEach((x, i) => ref(families, x.familyId, ['children', i]));
    f.avatars.forEach((x, i) => ref(users, x.userId, ['avatars', i]));
    f.plans.forEach((x, i) => (ref(children, x.childId, ['plans', i]), ref(avatars, x.avatarId, ['plans', i])));
    f.connections.forEach((x, i) => {
      ref(children, x.childId, ['connections', i]);
      ref(orgs, x.orgId, ['connections', i]);
      ref(users, x.caregiverUserId, ['connections', i]);
      if (x.kind === 'daycare' && x.orgId === null) issue(['connections', i], 'a daycare connection needs orgId');
      if (x.kind === 'home' && x.caregiverUserId === null) issue(['connections', i], 'a home connection needs caregiverUserId');
    });
    f.classrooms.forEach((x, i) => ref(orgs, x.orgId, ['classrooms', i]));
    f.classroomChildren.forEach((x, i) => (ref(classrooms, x.classroomId, ['classroomChildren', i]), ref(children, x.childId, ['classroomChildren', i])));
    f.classroomStaff.forEach((x, i) => (ref(classrooms, x.classroomId, ['classroomStaff', i]), ref(users, x.userId, ['classroomStaff', i])));
    const orgMembers = new Set(f.orgMembers.map((m) => `${m.orgId}|${m.userId}`));
    f.staffPins.forEach((x, i) => {
      if (!orgMembers.has(`${x.orgId}|${x.userId}`)) issue(['staffPins', i], `a PIN needs an orgMembers row for ${x.orgId}|${x.userId}`);
    });
    f.invites.forEach((x, i) => (ref(users, x.createdBy, ['invites', i]), ref(users, x.usedBy, ['invites', i])));
    f.enrollments.forEach((x, i) => {
      ref(orgs, x.orgId, ['enrollments', i]);
      ref(classrooms, x.classroomId, ['enrollments', i]);
      ref(children, x.childId, ['enrollments', i]);
      ref(invites, x.inviteCode, ['enrollments', i]);
    });
    f.sessions.forEach((x, i) => {
      ref(children, x.childId, ['sessions', i]);
      ref(avatars, x.avatarId, ['sessions', i]);
      ref(users, x.caregiverUserId, ['sessions', i]);
      ref(orgs, x.orgId, ['sessions', i]);
      if (x.endedAt < x.startedAt) issue(['sessions', i], 'endedAt is before startedAt');
    });
    f.flags.forEach((x, i) => (ref(sessions, x.sessionId, ['flags', i]), ref(users, x.acknowledgedBy, ['flags', i])));
    const alertRefs = new Set([...sessions, ...flags]);
    f.alerts.forEach((x, i) => (ref(users, x.userId, ['alerts', i]), ref(alertRefs, x.refId, ['alerts', i])));
  });

export type DemoFixture = z.infer<typeof DemoFixture>;
export type DemoFixtureInput = z.input<typeof DemoFixture>;
