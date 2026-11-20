// Response shapes of the HTTP API (apps/api), as consumed by the mobile app. Keep in step with the route views.
import type { MoodAfter, Reason, Severity, Tone, FlagCategory } from './domain';

export const API_ERROR_CODES = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID', 'SESSION_ACTIVE', 'AVATARS_BUSY',
  'RESTING', 'DEMO_READ_ONLY', 'INVITE_INVALID', 'PIN_LOCKED', 'DEVICE_UNKNOWN', 'RATE_LIMITED', 'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

export interface MeResponse {
  user: { id: string; name: string; email: string; isDemo: boolean };
  roles: {
    parent: boolean;
    adminOrgs: { id: string; name: string }[];
    teacherOrgs: { id: string; name: string }[];
    homeCaregiverFamilies: { id: string; label: string }[];
  };
}

/** One avatar owned by a parent in the child's family. */
export interface FamilyAvatarView {
  avatarId: string;
  ownerUserId: string;
  ownerName: string;
  parentTitle: string;
  status: string;
  isMine: boolean;
}

/**
 * GET /children: parents get every field (raw photoKey included, for editing) plus familyAvatars; children reached as a
 * caregiver only id, name and a signed photoUrl (1 hour). photoUrl is omitted when the child has no photo.
 */
export interface ChildView {
  id: string;
  name: string;
  photoUrl?: string;
  photoKey?: string | null;
  familyId?: string;
  birthday?: string | null;
  timezone?: string;
  familyAvatars?: FamilyAvatarView[];
}

export interface AvatarView {
  id: string;
  status: string;
  voiceId: string;
  photoKey: string | null;
  photoUrl: string | null;
  parentTitle: string;
  consentName: string;
  consentAt: number | null;
  approvedAt: number | null;
  createdAt: number;
  hasAgent: boolean;
}

export interface PlanView {
  childId: string;
  avatarId: string;
  parentTitle: string;
  tone: Tone;
  nicknames: string[];
  favorites: string[];
  phrases: string[];
  songTitle: string | null;
  songLyrics: string | null;
  neverTopics: string[];
  todayNote: string | null;
  todayNoteExpiresAt: number | null;
}

export interface SessionFlagView {
  id: string;
  /** live/post: the child's own words; manual: the caregiver's note. */
  source?: 'live' | 'manual' | 'post';
  category: FlagCategory;
  severity: Severity;
  quote: string | null;
  [k: string]: unknown;
}

export interface SessionItem {
  id: string;
  child: { id: string; name: string } | null;
  caregiverName: string;
  /** What the child calls the parent whose avatar was in this session (plan title, else the avatar's title). */
  parentTitle: string;
  reason: Reason | null;
  startedAt: number;
  durationS: number | null;
  moodAfter: MoodAfter | null;
  summary: string | null;
  moodSignal: string | null;
  flags: SessionFlagView[];
}
export interface SessionsPage { items: SessionItem[]; nextCursor: string | null }

/** "Our song" from the child's comfort plan: present only when the plan has a title (never for test calls). */
export interface SessionSong { title: string; lyrics?: string }
/** GET /api/sessions/:id/context: the system message for the agent, plus the song the call's song button sings. */
export interface SessionContextView { systemMessage: string; song?: SessionSong }

export interface AlertView {
  id: string;
  kind: string;
  refId: string | null;
  title: string;
  body: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface RosterTile {
  enrollmentId: string;
  childId?: string;
  name: string;
  photoUrl?: string;
  status: 'ready' | 'setup_pending' | 'invite_sent';
  readyAvatars: ReadyAvatarView[];
}

/** An approved parent avatar a caregiver can call. `parentName` is the parent's first name (for "Send to Sarah"). */
export interface ReadyAvatarView {
  avatarId: string;
  parentTitle: string;
  parentName?: string;
}

/** GET /api/caregiver/children: a home caregiver's children, shaped like a roster tile. */
export interface CaregiverChild {
  id: string;
  name: string;
  photoUrl?: string;
  readyAvatars: ReadyAvatarView[];
  familyLabel: string;
}

/** GET /api/orgs/:id/my-classrooms */
export interface MyClassroom {
  id: string;
  orgId: string;
  name: string;
  emoji: string | null;
  assetKey: string | null;
}

/** GET /api/orgs/:id/staff/switch */
export interface StaffSwitchEntry {
  userId: string;
  name: string;
  hasPin: boolean;
}

export interface DashboardView {
  readyCount: number;
  todaySessions: number;
  monthSessions: number;
  monthCostUsd: number;
  openFlags: {
    id: string;
    sessionId: string;
    childName: string;
    category: FlagCategory;
    quote: string | null;
    severity: Severity;
    createdAt: number;
  }[];
}

/** GET /api/orgs/:id. `logoUrl` is a signed URL (1 hour), or null when there is no logo. */
export interface OrgView {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  logoKey: string | null;
  logoUrl: string | null;
  role: 'admin' | 'teacher';
}

/** GET /api/orgs/:id/classrooms (admin). */
export interface ClassroomView {
  id: string;
  orgId: string;
  name: string;
  emoji: string | null;
  assetKey: string | null;
  staffUserIds: string[];
}

/** GET /api/orgs/:id/staff (admin). */
export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'teacher';
  hasPin: boolean;
  classroomIds: string[];
}

/** GET /api/orgs/:id/enrollments (admin). `inviteCode` is the parent invite, good for 7 days from `createdAt`. */
export interface EnrollmentView {
  id: string;
  orgId: string;
  classroomId: string;
  childName: string;
  inviteCode: string;
  childId: string | null;
  status: 'invited' | 'linked';
  createdAt: number;
}

export interface CaregiversView {
  daycare?: {
    connectionId: string;
    org: { id: string; name: string };
    teachers: { userId: string; name: string }[];
    transcriptAccess: boolean;
  };
  home: { connectionId: string; userId: string; name: string; transcriptAccess: boolean }[];
}

