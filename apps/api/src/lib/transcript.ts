/**
 * Transcript timestamps, normalized to epoch milliseconds in one place (device test P-2).
 *
 * Napster's `conversation.items[].timestamp` is unix SECONDS (e.g. `1795135636`); seeded demo sessions carry ISO
 * strings; rows stored before this fix hold the raw seconds. The app only ever formats epoch ms.
 */

/** Below this a number is seconds: 1e11 s is the year 5138, while 1e11 ms is only March 1973. */
const SECONDS_BELOW = 1e11;

/** Unix seconds, epoch ms (number or numeric string) or an ISO date string → epoch ms; anything else → null. */
export function toEpochMs(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') {
    const s = v.trim();
    n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : Date.parse(s);
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n < SECONDS_BELOW ? n * 1000 : n);
}

export interface TranscriptLine {
  role: string;
  text: string;
  /** Epoch ms, or null when the provider gave none we can read. */
  timestamp: number | null;
  [k: string]: unknown;
}

/** Every item with its `timestamp` as epoch ms (idempotent); non-object entries are dropped. */
export function normalizeTranscript(items: unknown): TranscriptLine[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && !Array.isArray(i))
    .map((i) => ({ ...i, timestamp: toEpochMs(i.timestamp) }) as TranscriptLine);
}
