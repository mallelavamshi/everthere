import { todayNoteExpiry } from '@everthere/shared';

const HOUR = 3_600_000;

/** Start (UTC ms) of the local calendar day containing `nowMs` in `timezone`. DST-safe (days are 23–25h). */
export function orgDayStart(timezone: string, nowMs: number): number {
  // The first local midnight after now-26h is at or before the latest midnight <= now; walk forward from it.
  let start = todayNoteExpiry(timezone, nowMs - 26 * HOUR);
  for (;;) {
    const next = todayNoteExpiry(timezone, start);
    if (next > nowMs) return start;
    start = next;
  }
}

function localDayOfMonth(timezone: string, ms: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' }).format(new Date(ms)));
}

/** Start (UTC ms) of the local calendar month containing `nowMs` in `timezone`. */
export function orgMonthStart(timezone: string, nowMs: number): number {
  let start = orgDayStart(timezone, nowMs);
  while (localDayOfMonth(timezone, start) !== 1) start = orgDayStart(timezone, start - 1);
  return start;
}
