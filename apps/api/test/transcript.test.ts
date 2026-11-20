import { describe, expect, it } from 'vitest';
import { normalizeTranscript, toEpochMs } from '../src/lib/transcript';

// Device test P-2: Napster's `conversation.items[].timestamp` is unix SECONDS (a real item from the phone run below),
// while seeded sessions carry ISO strings. Both must come out as epoch milliseconds.
const REAL_ITEM = { role: 'Assistant', text: 'Hello, sweet pea. You look a little tired today.', timestamp: 1795135636 };
const REAL_MS = 1795135636_000;

describe('toEpochMs', () => {
  it('reads unix seconds, epoch milliseconds and ISO strings by magnitude / shape', () => {
    expect(toEpochMs(1795135636)).toBe(REAL_MS);
    expect(toEpochMs(1795135636.25)).toBe(REAL_MS + 250);
    expect(toEpochMs(REAL_MS)).toBe(REAL_MS);
    expect(toEpochMs('1795135636')).toBe(REAL_MS);
    expect(toEpochMs(String(REAL_MS))).toBe(REAL_MS);
    expect(toEpochMs('2026-11-18T10:00:05Z')).toBe(Date.UTC(2026, 10, 18, 10, 0, 5));
    expect(toEpochMs('2026-11-19T02:02:52.984261+00:00')).toBe(Date.UTC(2026, 10, 19, 2, 2, 52, 984));
  });

  it('anything unusable is null', () => {
    for (const v of [undefined, null, '', 'soon', NaN, Infinity, -5, 0, {}, []]) expect(toEpochMs(v), String(v)).toBeNull();
  });
});

describe('normalizeTranscript', () => {
  it('turns a real-shaped Napster item into ms, keeping role and text', () => {
    expect(normalizeTranscript([REAL_ITEM])).toEqual([{ role: 'Assistant', text: REAL_ITEM.text, timestamp: REAL_MS }]);
  });

  it('keeps extra fields, maps seeded ISO items too, and nulls a missing or bad timestamp', () => {
    const out = normalizeTranscript([
      { role: 'User', text: 'Hello.', timestamp: 1795135650, id: 'item_1' },
      { role: 'User', text: 'hi', timestamp: '2026-11-18T10:00:05Z' },
      { role: 'Assistant', text: 'x' },
      { role: 'Assistant', text: 'y', timestamp: 'later' },
    ]);
    expect(out).toEqual([
      { role: 'User', text: 'Hello.', timestamp: 1795135650_000, id: 'item_1' },
      { role: 'User', text: 'hi', timestamp: Date.UTC(2026, 10, 18, 10, 0, 5) },
      { role: 'Assistant', text: 'x', timestamp: null },
      { role: 'Assistant', text: 'y', timestamp: null },
    ]);
  });

  it('is idempotent (already-normalized rows stay the same) and drops non-objects', () => {
    const once = normalizeTranscript([REAL_ITEM, null, 'junk', 7]);
    expect(once).toHaveLength(1);
    expect(normalizeTranscript(once)).toEqual(once);
  });

  it('a non-array is an empty transcript', () => {
    expect(normalizeTranscript(null)).toEqual([]);
    expect(normalizeTranscript({ items: [] })).toEqual([]);
  });
});
