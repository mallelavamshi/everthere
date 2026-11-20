import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOnbPath } from './Step';

export type Door = 'parent' | 'daycare';

/** Only same-app absolute paths: never `//host` or a full URL smuggled through ?next=. */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

export const asDoor = (raw: string | null): Door | null => (raw === 'parent' || raw === 'daycare' ? raw : null);

/** Door + return path carried on the URL, and where to go once the person is signed in. */
export function useAuthTarget() {
  const [params] = useSearchParams();
  const p = useOnbPath();
  const door = asDoor(params.get('door'));
  const next = safeNext(params.get('next'));
  const dest = next ?? (door === 'parent' ? p('/parent/start') : door === 'daycare' ? p('/daycare/start') : '/');
  /** `?door=...&next=...` to carry onto the sibling screen (sign up <-> sign in). */
  const carry = useCallback(() => {
    const q = new URLSearchParams();
    if (door) q.set('door', door);
    if (next) q.set('next', next);
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [door, next]);
  return { door, next, dest, carry };
}
