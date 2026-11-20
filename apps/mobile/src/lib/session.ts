import type { QueryClient } from '@tanstack/react-query';
import { clearCall } from '../features/caregiver/pendingCall';
import { setTokenGetter } from './api';
import { clearStashedCode } from './pendingCode';
import { clearSessionStorage } from './storage';

/** Drop everything tied to the previous person: acting token, role preference, token getter and query cache. */
export async function clearLocalSession(qc: QueryClient): Promise<void> {
  setTokenGetter(null);
  await clearSessionStorage();
  qc.clear();
}

/**
 * Clerk sign-out, then clear local state whatever the outcome. Returns false if Clerk's sign-out failed.
 * Also drops the in-memory pending call and a stashed invite code. Those are cleared only here, not in
 * clearLocalSession, which also runs at sign-in, where the stashed code must survive for Join.
 */
export async function signOutAndClear(signOut: () => Promise<unknown>, qc: QueryClient): Promise<boolean> {
  let ok = true;
  try {
    await signOut();
  } catch {
    ok = false;
  }
  clearCall();
  clearStashedCode();
  await clearLocalSession(qc);
  return ok;
}
