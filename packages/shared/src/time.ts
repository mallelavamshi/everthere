const formatters = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock fields of a UTC instant in the given zone. */
function localParts(timeZone: string, ms: number) {
  const p: Record<string, number> = {};
  for (const part of fmt(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Zone offset (local minus UTC) in ms at a UTC instant. */
function offsetAt(timeZone: string, ms: number): number {
  const l = localParts(timeZone, ms);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s) - Math.floor(ms / 1000) * 1000;
}

/** Next local 00:00 in `timezone` after `nowMs`, as UTC milliseconds. DST-safe. */
export function todayNoteExpiry(timezone: string, nowMs: number): number {
  const { y, m, d } = localParts(timezone, nowMs);
  const wall = Date.UTC(y, m - 1, d + 1, 0, 0, 0); // next local midnight as if the zone were UTC
  // Search for the UTC instant whose local wall time equals `wall`: candidates are wall minus
  // each offset the zone uses around that day; keep those that map back exactly, earliest wins.
  const candidates = new Set<number>();
  for (const probe of [wall - 86_400_000, wall, wall + 86_400_000]) {
    candidates.add(wall - offsetAt(timezone, probe));
  }
  const valid = [...candidates].filter((t) => t > nowMs && offsetAt(timezone, t) === wall - t).sort((a, b) => a - b);
  if (valid.length) return valid[0]!;
  // Midnight does not exist (DST gap at 00:00): use the first instant after the gap.
  return wall - offsetAt(timezone, wall - 86_400_000);
}
