import { normalizeCode } from '../features/onboarding/lib';

// The invite code must never ride in a URL (history, logs, screenshots). It waits in sessionStorage while the person
// signs up or signs in, then Join picks it up. It expires after 30 minutes and is cleared once redeemed.

const KEY = 'everthere.pendingInviteCode';
export const PENDING_CODE_TTL_MS = 30 * 60 * 1000;

export function stashCode(code: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, at: now }));
  } catch {
    /* private mode: the person just retypes it */
  }
}

export function readStashedCode(now = Date.now()): string {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return '';
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof v.code !== 'string' || typeof v.at !== 'number' || now - v.at > PENDING_CODE_TTL_MS) {
      clearStashedCode();
      return '';
    }
    return normalizeCode(v.code);
  } catch {
    return '';
  }
}

export function clearStashedCode(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
