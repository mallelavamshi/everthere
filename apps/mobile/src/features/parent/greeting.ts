/** First name of a full name ("Sarah Lee" -> "Sarah"); empty when unknown. */
export const firstName = (full: string | undefined | null): string => (full ?? '').trim().split(/\s+/)[0] ?? '';

/** Time-of-day greeting for the parent home. Hours are local, 0-23. */
export function greetingFor(now: Date, name?: string | null): string {
  const h = now.getHours();
  const who = firstName(name);
  const tail = who ? `, ${who}` : '';
  if (h >= 5 && h < 12) return `Good morning${tail} ☀️`;
  if (h >= 12 && h < 17) return `Good afternoon${tail} 🌤️`;
  if (h >= 17 && h < 22) return `Good evening${tail} 🌙`;
  return who ? `Still up, ${who}? 🌙` : 'Still up? 🌙';
}
