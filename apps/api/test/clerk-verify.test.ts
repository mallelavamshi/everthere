import { describe, it, expect, vi } from 'vitest';
import type { verifyToken } from '@clerk/backend';
import { clerkVerify } from '../src/auth/clerk';
import type { Env } from '../src/env';

const env = { CLERK_SECRET_KEY: 'sk', CLERK_AUTHORIZED_PARTIES: 'https://a.io, https://b.io' } as Env;
const fake = vi.fn(async (t: string) => (t === 'good' ? { data: { sub: 'user_1' } } : { errors: [new Error('bad')] }));
const vt = fake as unknown as typeof verifyToken;

describe('clerkVerify (@clerk/backend 3.x top-level verifyToken: payload or throw)', () => {
  const real = vi.fn(async (t: string) => {
    if (t !== 'good') throw new Error('bad');
    return { sub: 'user_2', azp: 'https://localhost', sid: 'sess_1' };
  }) as unknown as typeof verifyToken;
  it('returns claims from the resolved payload', async () => {
    expect(await clerkVerify('good', env, real)).toMatchObject({ sub: 'user_2' });
  });
  it('rejects when verifyToken throws', async () => {
    await expect(clerkVerify('bad', env, real)).rejects.toThrow();
  });
});

describe('clerkVerify (tolerates the {data}/{errors} shape)', () => {
  it('returns claims from data and passes secretKey + authorizedParties', async () => {
    expect(await clerkVerify('good', env, vt)).toMatchObject({ sub: 'user_1' });
    expect(fake).toHaveBeenCalledWith('good', { secretKey: 'sk', authorizedParties: ['https://a.io', 'https://b.io'] });
  });
  it('throws when Clerk returns errors', async () => {
    await expect(clerkVerify('bad', env, vt)).rejects.toThrow();
  });
});
