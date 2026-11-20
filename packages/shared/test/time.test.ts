import { expect, test } from 'vitest';
import { todayNoteExpiry } from '../src/time';

test('today note expires at LA local midnight', () => {
  const now = Date.UTC(2026,10,19,6,30); // Nov 18 22:30 PST
  expect(todayNoteExpiry('America/Los_Angeles', now)).toBe(Date.UTC(2026,10,19,8,0));
});
test('spring-forward day: midnight after Mar 8 (PST->PDT) is at 07:00Z', () => {
  const now = Date.UTC(2026,2,8,12,0); // Mar 8 05:00 PDT
  expect(todayNoteExpiry('America/Los_Angeles', now)).toBe(Date.UTC(2026,2,9,7,0));
});
test('fall-back day: midnight after Nov 1 is at 08:00Z', () => {
  const now = Date.UTC(2026,10,1,10,0); // Nov 1 02:00 PST
  expect(todayNoteExpiry('America/Los_Angeles', now)).toBe(Date.UTC(2026,10,2,8,0));
});
test('day before fall-back: midnight is still PDT (07:00Z), next day is 25h long', () => {
  const now = Date.UTC(2026,9,31,20,0); // Oct 31 13:00 PDT
  expect(todayNoteExpiry('America/Los_Angeles', now)).toBe(Date.UTC(2026,10,1,7,0));
});
test('positive-offset zone', () => {
  const now = Date.UTC(2026,5,1,12,0); // Jun 1 17:30 IST
  expect(todayNoteExpiry('Asia/Kolkata', now)).toBe(Date.UTC(2026,5,1,18,30));
});
