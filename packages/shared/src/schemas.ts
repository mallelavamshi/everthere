import { z } from 'zod';
import { FLAG_CATEGORIES, SEVERITIES, VOICES } from './domain';

// Each later task adds its own fields to these when it first uses them.
export const StartSessionBody = z.object({
  childId: z.string().min(1).max(64),
  avatarId: z.string().min(1).max(64),
  reason: z.enum(['missing_parent', 'upset_nap', 'new_nervous', 'boo_boo']),
});

/** `live`: relayed from the agent's flag_concern call during the session. `manual`: added by a person, any time. */
export const FlagBody = z.object({
  category: z.enum(FLAG_CATEGORIES),
  severity: z.enum(SEVERITIES),
  quote: z.string().trim().min(1).max(1000),
  source: z.enum(['live', 'manual']),
});

export const CheckinBody = z.object({
  moodAfter: z.enum(['calmer', 'same', 'upset']),
  note: z.string().trim().max(500).optional(),
});

export const PlanBody = z.object({
  /** What this child calls the parent ("Mommy"). Omit to keep the stored title. */
  parentTitle: z.string().trim().min(1).max(20).optional(),
  tone: z.enum(['calm', 'playful', 'soothing']),
  nicknames: z.array(z.string().min(1).max(40)).max(12).default([]),
  favorites: z.array(z.string().min(1).max(40)).max(12).default([]),
  phrases: z.array(z.string().min(1).max(40)).max(12).default([]),
  songTitle: z.string().max(120).optional(),
  songLyrics: z.string().max(1500).optional(),
  neverTopics: z.array(z.string().min(1).max(40)).max(12).default([]),
  todayNote: z.string().max(120).optional(),
});

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'not a real calendar date');

export const ianaZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'must be an IANA time zone');

export const ChildBody = z.object({
  name: z.string().trim().min(1).max(60),
  birthday: isoDate,
  timezone: ianaZone,
  photoKey: z.string().min(1).max(200).nullable().optional(), // null clears (PATCH); ownership checked in the route
  callsParent: z.string().min(1).max(30).optional(),
});

export const InviteCreateBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('co_parent'), familyId: z.string().min(1) }),
  z.object({
    type: z.literal('home_caregiver'),
    familyId: z.string().min(1),
    childIds: z.array(z.string().min(1)).min(1).max(20),
  }),
]);

export const InviteCodeBody = z.object({
  code: z.string().min(1).max(32),
});

export const InviteRedeemBody = z.object({
  code: z.string().min(1).max(32),
  existingChildId: z.string().min(1).optional(),
  pin: z.string().optional(),
});

export const AvatarCreateBody = z.object({
  photoKey: z.string().min(1).max(200),
  voiceId: z.enum(VOICES),
  consentName: z.string().trim().min(1).max(100),
  consentAccepted: z.literal(true),
  parentTitle: z.string().trim().min(1).max(20),
});

export const AvatarPatchBody = z
  .object({
    photoKey: z.string().min(1).max(200).optional(),
    voiceId: z.enum(VOICES).optional(),
    // A new likeness needs fresh consent.
    consentName: z.string().trim().min(1).max(100).optional(),
    consentAccepted: z.literal(true).optional(),
  })
  .refine((b) => b.photoKey !== undefined || b.voiceId !== undefined, 'photoKey or voiceId is required')
  .refine(
    (b) => b.photoKey === undefined || (b.consentName !== undefined && b.consentAccepted === true),
    'changing the photo requires consentName and consentAccepted: true',
  );

const pin4 = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

export const PinBody = z.object({
  pin: pin4,
});

export const ActingBody = z.object({
  deviceId: z.string().min(1).max(64),
  teacherUserId: z.string().min(1).max(64),
  pin: pin4,
});

/** POST /api/orgs. Strict: the logo is set with PATCH after upload (its key needs the org id). */
export const OrgBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    address: z.string().trim().max(200),
    timezone: ianaZone,
  })
  .strict();

export const OrgPatchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  address: z.string().trim().max(200).optional(),
  timezone: ianaZone.optional(),
  logoKey: z.string().min(1).max(200).nullable().optional(), // null clears; ownership checked in the route
});

export const ClassroomBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    emoji: z.string().min(1).max(16).optional(),
    assetKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/).optional(),
  })
  .refine((b) => (b.emoji === undefined) !== (b.assetKey === undefined), 'exactly one of emoji or assetKey');

/** PATCH /classrooms/:id: any of name / badge; a badge is an emoji or a curated assetKey, never both. */
export const ClassroomPatchBody = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    emoji: z.string().min(1).max(16).optional(),
    assetKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/).optional(),
  })
  .refine((b) => b.emoji === undefined || b.assetKey === undefined, 'at most one of emoji or assetKey');

export const ClassroomStaffBody = z.object({
  userIds: z.array(z.string().min(1).max(64)).max(50),
});

export const EnrollmentBody = z.object({
  childName: z.string().trim().min(1).max(60),
  classroomId: z.string().min(1).max(64),
});
