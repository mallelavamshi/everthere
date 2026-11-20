import { Preferences } from '@capacitor/preferences';

// Alert ids this device has already shown a notification for, so a poll never repeats one. Keyed by user: the
// stored record says whose ids they are, and another person's ids are never read back. Capped, newest kept.

const KEY = 'everthere.alertsSeen';
export const SEEN_CAP = 200;

interface Stored {
  userId: string;
  ids: string[];
}

/** null = nothing stored for this user yet (their first poll on this device). */
export async function loadSeenState(userId: string): Promise<string[] | null> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    const s = value ? (JSON.parse(value) as Partial<Stored>) : null;
    return s && s.userId === userId && Array.isArray(s.ids) ? s.ids.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export async function loadSeen(userId: string): Promise<string[]> {
  return (await loadSeenState(userId)) ?? [];
}

export async function saveSeen(userId: string, ids: string[]): Promise<void> {
  try {
    const unique = [...new Set(ids)].slice(-SEEN_CAP);
    await Preferences.set({ key: KEY, value: JSON.stringify({ userId, ids: unique } satisfies Stored) });
  } catch {
    /* a missed note is better than a crash */
  }
}

export async function clearSeen(): Promise<void> {
  try {
    await Preferences.remove({ key: KEY });
  } catch {
    /* ignore */
  }
}
