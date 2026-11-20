import type { FlagCategory, Severity } from '@everthere/shared';
import type { BadgeTone } from '../../ui';

export const CATEGORY_LABEL: Record<FlagCategory, string> = {
  injury: 'Injury',
  illness: 'Illness',
  hurt_by_someone: 'Hurt by someone',
  scared_of_person: 'Scared of someone',
  unsafe: 'Unsafe situation',
  other: 'Other',
};

export const SEVERITY: Record<Severity, { label: string; tone: BadgeTone }> = {
  high: { label: 'High', tone: 'flag' },
  medium: { label: 'Medium', tone: 'coral' },
  low: { label: 'Low', tone: 'neutral' },
};

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
