export type Role = 'parent' | 'admin' | 'teacher' | 'home_caregiver';

export type Reason = 'missing_parent' | 'upset_nap' | 'new_nervous' | 'boo_boo';

export const REASONS: Record<Reason, { label: (parentTitle: string) => string; emoji: string }> = {
  missing_parent: { label: (parentTitle) => `Missing ${parentTitle}`, emoji: '🥺' },
  upset_nap: { label: () => 'Upset at nap', emoji: '😴' },
  new_nervous: { label: () => 'New & nervous', emoji: '🌱' },
  boo_boo: { label: () => 'Got a boo-boo', emoji: '🩹' },
};

export type Tone = 'calm' | 'playful' | 'soothing';

export const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
export type Voice = (typeof VOICES)[number];

export type MoodAfter = 'calmer' | 'same' | 'upset';

export const FLAG_CATEGORIES = ['injury', 'illness', 'hurt_by_someone', 'scared_of_person', 'unsafe', 'other'] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const LIMITS = {
  sessionWarnMs: 480_000,
  sessionMaxMs: 600_000,
  creditCapUsd: 120,
  sessionsPerUserPerDay: 20,
  /** Demo accounts (is_demo) are shared by many judges; the credit cap still guards money. */
  demoSessionsPerUserPerDay: 200,
  inviteTtlMs: 7 * 86_400_000,
  pinAttempts: 5,
  pinWindowMs: 600_000,
} as const;
