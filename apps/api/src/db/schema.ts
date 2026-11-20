import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

// Keep in exact sync with migrations/*.sql (enforced by test/schema-sync.test.ts).
// Timestamps: integer epoch ms. JSON: text. Booleans: integer 0/1.

export const user = sqliteTable('user', {
  id: text('id').primaryKey(), // Clerk user id
  name: text('name').notNull(),
  email: text('email').notNull(),
  avatarEmoji: text('avatar_emoji'),
  createdAt: integer('created_at').notNull(),
  isDemo: integer('is_demo').notNull().default(0),
});

export const org = sqliteTable('org', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoKey: text('logo_key'),
  address: text('address'),
  timezone: text('timezone').notNull().default('UTC'),
});

export const orgMember = sqliteTable(
  'org_member',
  {
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['admin', 'teacher'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const family = sqliteTable('family', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

export const familyMember = sqliteTable(
  'family_member',
  {
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['parent'] }).notNull().default('parent'),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.userId] })],
);

export const child = sqliteTable(
  'child',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    name: text('name').notNull(),
    photoKey: text('photo_key'),
    birthday: text('birthday'),
    timezone: text('timezone').notNull().default('UTC'),
  },
  (t) => [index('child_family_idx').on(t.familyId)],
);

export const avatar = sqliteTable(
  'avatar',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    napsterCompanionId: text('napster_companion_id'),
    napsterAgentId: text('napster_agent_id'),
    voiceId: text('voice_id'),
    photoKey: text('photo_key'),
    status: text('status', { enum: ['creating', 'ready', 'approved', 'failed'] })
      .notNull()
      .default('creating'),
    approvedAt: integer('approved_at'),
    consentName: text('consent_name'),
    consentAt: integer('consent_at'),
    isSynthetic: integer('is_synthetic').notNull().default(0),
    parentTitle: text('parent_title').notNull().default(''),
    createdAt: integer('created_at').notNull().default(0),
  },
  (t) => [index('avatar_user_idx').on(t.userId)],
);

export const comfortPlan = sqliteTable(
  'comfort_plan',
  {
    childId: text('child_id').notNull(),
    avatarId: text('avatar_id').notNull(),
    parentTitle: text('parent_title').notNull(),
    nicknames: text('nicknames').notNull().default('[]'),
    tone: text('tone', { enum: ['calm', 'playful', 'soothing'] }).notNull().default('calm'),
    favorites: text('favorites').notNull().default('[]'),
    phrases: text('phrases').notNull().default('[]'),
    songTitle: text('song_title'),
    songLyrics: text('song_lyrics'),
    neverTopics: text('never_topics').notNull().default('[]'),
    todayNote: text('today_note'),
    todayNoteExpiresAt: integer('today_note_expires_at'),
  },
  (t) => [primaryKey({ columns: [t.childId, t.avatarId] })],
);

export const connection = sqliteTable(
  'connection',
  {
    id: text('id').primaryKey(),
    childId: text('child_id').notNull(),
    kind: text('kind', { enum: ['daycare', 'home'] }).notNull(),
    orgId: text('org_id'),
    caregiverUserId: text('caregiver_user_id'),
    transcriptAccess: integer('transcript_access').notNull().default(0),
  },
  (t) => [index('connection_child_idx').on(t.childId), index('connection_caregiver_idx').on(t.caregiverUserId)],
);

export const classroom = sqliteTable(
  'classroom',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    emoji: text('emoji'),
  },
  (t) => [index('classroom_org_idx').on(t.orgId)],
);

export const classroomChild = sqliteTable(
  'classroom_child',
  {
    classroomId: text('classroom_id').notNull(),
    childId: text('child_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classroomId, t.childId] })],
);

export const classroomStaff = sqliteTable(
  'classroom_staff',
  {
    classroomId: text('classroom_id').notNull(),
    userId: text('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classroomId, t.userId] })],
);

export const staffPin = sqliteTable(
  'staff_pin',
  {
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    pinHash: text('pin_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const inviteCode = sqliteTable('invite_code', {
  code: text('code').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload').notNull().default('{}'),
  createdBy: text('created_by').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedBy: text('used_by'),
  usedAt: integer('used_at'),
  claimNonce: text('claim_nonce'), // per-request nonce proving which redeem won the claim
});

export const comfortSession = sqliteTable(
  'comfort_session',
  {
    id: text('id').primaryKey(),
    napsterSessionId: text('napster_session_id'),
    childId: text('child_id'),
    avatarId: text('avatar_id').notNull(),
    caregiverUserId: text('caregiver_user_id').notNull(),
    orgId: text('org_id'),
    reason: text('reason'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    durationS: integer('duration_s'),
    costUsd: real('cost_usd'),
    moodAfter: text('mood_after'),
    caregiverNote: text('caregiver_note'),
    summary: text('summary'),
    moodSignal: text('mood_signal'),
    status: text('status').notNull().default('active'),
    kind: text('kind', { enum: ['child', 'test'] }).notNull().default('child'),
    transcriptJson: text('transcript_json'),
    napsterStatus: text('napster_status'),
    endedReason: text('ended_reason'),
  },
  (t) => [
    index('comfort_session_child_idx').on(t.childId),
    index('comfort_session_napster_idx').on(t.napsterSessionId),
    index('comfort_session_status_idx').on(t.status),
  ],
);

export const sessionFlag = sqliteTable(
  'session_flag',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    source: text('source', { enum: ['live', 'manual', 'post'] }).notNull(), // live/manual via API; post from analysis
    category: text('category').notNull(),
    quote: text('quote'),
    severity: text('severity').notNull(),
    createdAt: integer('created_at').notNull(),
    acknowledgedBy: text('acknowledged_by'),
    acknowledgedAt: integer('acknowledged_at'),
  },
  (t) => [index('session_flag_session_idx').on(t.sessionId)],
);

export const alert = sqliteTable(
  'alert',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind', { enum: ['summary', 'flag', 'invite', 'avatar_ready'] }).notNull(),
    refId: text('ref_id'),
    title: text('title').notNull(),
    body: text('body'),
    readAt: integer('read_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('alert_user_idx').on(t.userId, t.createdAt)],
);

export const usageLedger = sqliteTable('usage_ledger', {
  day: text('day').primaryKey(),
  minutes: real('minutes').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
});

export const webhookEvent = sqliteTable('webhook_event', {
  eventId: text('event_id').primaryKey(),
  receivedAt: integer('received_at').notNull(),
});

export const enrollment = sqliteTable(
  'enrollment',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    classroomId: text('classroom_id').notNull(),
    childName: text('child_name').notNull(),
    inviteCode: text('invite_code').notNull(),
    childId: text('child_id'),
    status: text('status', { enum: ['invited', 'linked'] }).notNull().default('invited'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('enrollment_org_idx').on(t.orgId)],
);

export const device = sqliteTable('device', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  registeredBy: text('registered_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const pinAttempt = sqliteTable(
  'pin_attempt',
  {
    deviceId: text('device_id').notNull(),
    at: integer('at').notNull(),
    orgId: text('org_id'), // 0003: target of the attempt (nullable for pre-0003 rows)
    teacherUserId: text('teacher_user_id'),
  },
  (t) => [
    index('pin_attempt_device_idx').on(t.deviceId, t.at),
    index('pin_attempt_target_idx').on(t.orgId, t.teacherUserId, t.at),
  ],
);

export const creditGuard = sqliteTable('credit_guard', {
  id: integer('id').primaryKey(), // always 1 (CHECK constraint in migration)
  capUsd: real('cap_usd').notNull().default(120),
  spentUsd: real('spent_usd').notNull().default(0),
});

export const rateLimit = sqliteTable(
  'rate_limit',
  {
    key: text('key').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const demoPersona = sqliteTable('demo_persona', {
  persona: text('persona').primaryKey(), // 'parent' | 'teacher'
  userId: text('user_id').notNull(),
});

export const demoFixture = sqliteTable('demo_fixture', {
  id: integer('id').primaryKey(), // always 1 (CHECK constraint in migration)
  json: text('json').notNull(),
  seededAt: integer('seeded_at').notNull(),
  firstSeededAt: integer('first_seeded_at'), // 0006: earliest seed time (reset cutoff); null = seeded_at
});

export type UserRow = typeof user.$inferSelect;
