import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { clearLocalSession, signOutAndClear } from '../src/lib/session';
import { peekCall, rememberCall } from '../src/features/caregiver/pendingCall';
import { readStashedCode, stashCode } from '../src/lib/pendingCode';

const call = { childId: 'c1', childName: 'Mia', parentTitle: 'Mom', startedAt: 1 };

describe('signOutAndClear', () => {
  it('also forgets the pending call and the stashed invite code', async () => {
    rememberCall(call);
    stashCode('KA7PQ2');
    expect(readStashedCode()).toBe('KA7PQ2');
    await signOutAndClear(vi.fn(async () => {}), new QueryClient());
    expect(peekCall()).toBeNull();
    expect(readStashedCode()).toBe('');
  });

  it('clears them even when Clerk sign-out fails', async () => {
    rememberCall(call);
    stashCode('KA7PQ2');
    expect(await signOutAndClear(vi.fn(async () => Promise.reject(new Error('x'))), new QueryClient())).toBe(false);
    expect(peekCall()).toBeNull();
    expect(readStashedCode()).toBe('');
  });

  it('clearLocalSession (run at sign-in) keeps the stashed invite code, so Join can pick it up', async () => {
    stashCode('KA7PQ2');
    await clearLocalSession(new QueryClient());
    expect(readStashedCode()).toBe('KA7PQ2');
  });
});
