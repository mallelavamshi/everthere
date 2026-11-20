import { REASONS, type MoodAfter, type Reason, type SessionItem } from '@everthere/shared';
import type { AssetKey } from '../../assets/manifest';

// How a comfort call is described to a parent. Pure, so the feed, the card and the detail all agree.

/** How the child felt going in, from the reason the call was started for. */
const BEFORE: Record<Reason, { emoji: string; phrase: (parentTitle: string) => string }> = {
  missing_parent: { emoji: '🥺', phrase: (p) => `Felt sad missing ${p}` },
  upset_nap: { emoji: '😴', phrase: () => 'Felt upset at nap' },
  new_nervous: { emoji: '😟', phrase: () => 'Felt new and nervous' },
  boo_boo: { emoji: '🤕', phrase: () => 'Had a boo-boo' },
};

/** How they felt afterwards, from the caregiver's check-in. */
const AFTER: Record<MoodAfter, { emoji: string; word: string }> = {
  calmer: { emoji: '😊', word: 'calmer' },
  same: { emoji: '😐', word: 'about the same' },
  upset: { emoji: '😢', word: 'still upset' },
};

export const REASON_STICKER: Record<Reason, AssetKey> = {
  missing_parent: 'reason.missing_parent',
  upset_nap: 'reason.upset_at_nap',
  new_nervous: 'reason.new_and_nervous',
  boo_boo: 'reason.boo_boo',
};

export type Mood = 'better' | 'same' | 'worse' | 'unclear';

/** The check-in wins; the model's guess (mood_signal) is used only when there is no check-in. */
export function moodOf(s: Pick<SessionItem, 'moodAfter' | 'moodSignal'>): Mood {
  if (s.moodAfter) return s.moodAfter === 'calmer' ? 'better' : s.moodAfter === 'same' ? 'same' : 'worse';
  return s.moodSignal === 'better' || s.moodSignal === 'same' || s.moodSignal === 'worse' ? s.moodSignal : 'unclear';
}

export function sessionTitle(s: Pick<SessionItem, 'moodAfter' | 'moodSignal'>, name: string): string {
  switch (moodOf(s)) {
    case 'better':
      return `${name} felt better 💛`;
    case 'same':
      return `${name}'s still a little sad`;
    case 'worse':
      return `${name} had a hard time`;
    default:
      return `${name} had a comfort call 💛`;
  }
}

/** The card's tone: green for a good ending, blue for the rest of the ones with a mood, white when unknown. */
export function sessionTone(s: Pick<SessionItem, 'moodAfter' | 'moodSignal'>): 'mint' | 'sky' | 'white' {
  const m = moodOf(s);
  return m === 'better' ? 'mint' : m === 'unclear' ? 'white' : 'sky';
}

/** "😴 → 😊" with a spoken version. Needs a check-in (the model's guess is not shown as a mood). */
export function moodPill(s: Pick<SessionItem, 'reason' | 'moodAfter'>, parentTitle = 'Mom'): { text: string; label: string } | null {
  if (!s.moodAfter) return null;
  const after = AFTER[s.moodAfter];
  const before = s.reason ? BEFORE[s.reason] : null;
  if (!before) return { text: after.emoji, label: `Felt ${after.word} afterwards` };
  return { text: `${before.emoji} → ${after.emoji}`, label: `${before.phrase(parentTitle)}, then ${after.word}` };
}

export const reasonLabel = (reason: Reason | null, parentTitle = 'Mom'): string | null => (reason ? REASONS[reason].label(parentTitle) : null);

export const lengthLabel = (durationS: number | null): string | null => (durationS ? `${Math.max(1, Math.round(durationS / 60))} min` : null);

/** "11:20am" in the device's time zone. */
export const clockLabel = (ms: number | string): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Today, Yesterday, else "Mon, Nov 17", by calendar day in the device's time zone. */
export function dayLabel(ms: number, now: Date = new Date()): string {
  const day = startOfDay(new Date(ms));
  const today = startOfDay(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day.getTime() === today.getTime()) return 'Today';
  if (day.getTime() === yesterday.getTime()) return 'Yesterday';
  const year = day.getFullYear() !== today.getFullYear();
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

/** Consecutive items (newest first) under one heading per calendar day. */
export function groupByDay<T extends { startedAt: number }>(items: T[], now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const it of items) {
    const label = dayLabel(it.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

/** "Today · 11:20am", for the top of the detail screen. */
export const whenLabel = (ms: number, now: Date = new Date()): string => `${dayLabel(ms, now)} · ${clockLabel(ms)}`;

/** "5m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const then = new Date(ms);
  const year = then.getFullYear() !== new Date(now).getFullYear();
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
}

/** How long after a call ends we keep saying the summary is on its way. */
export const SUMMARY_WAIT_MS = 30 * 60_000;

/**
 * True while a summary can still be expected: the call is running or ended less than 30 minutes ago. After that a
 * missing summary is final (too short, or it could not be made) and is described as such, not as "writing…".
 */
export function summaryPending(s: Pick<SessionItem, 'summary' | 'startedAt' | 'durationS'>, now = Date.now()): boolean {
  if (s.summary) return false;
  const ended = s.startedAt + (s.durationS ?? 0) * 1000;
  return now - ended < SUMMARY_WAIT_MS;
}
