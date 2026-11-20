import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { isLoaded: true, userId: 'userA' as string | null };
const signOut = vi.fn(async () => {});
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ ...auth, getToken: async () => (auth.userId === 'userA' ? 'tokA' : 'tokB') }),
  useClerk: () => ({ signOut }),
}));

import { AuthGate } from '../src/shell/AuthGate';
import { AuthOpsProvider, type AuthOps } from '../src/features/onboarding/authOps';
import { queryClient, qk } from '../src/lib/queries';
import { setTokenGetter } from '../src/lib/api';
import { getActingToken, getRolePref, setActingToken, setLastUser, setRolePref } from '../src/lib/storage';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const meFor = (name: string) => ({
  user: { id: name, name, email: `${name}@e.com`, isDemo: false },
  roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
});

let fetchMock: ReturnType<typeof vi.fn>;
// The signed-out Welcome screen needs the Clerk-backed auth ops (App provides them); a stub is enough here.
const tree = () => (
  <QueryClientProvider client={queryClient}>
    <AuthOpsProvider value={{} as AuthOps}>
      <MemoryRouter initialEntries={['/']}>
        <AuthGate />
      </MemoryRouter>
    </AuthOpsProvider>
  </QueryClientProvider>
);

beforeEach(async () => {
  auth.isLoaded = true;
  auth.userId = 'userA';
  queryClient.clear();
  setTokenGetter(null);
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const bearer = new Headers(init.headers).get('authorization');
    return json(meFor(bearer === 'Bearer tokA' ? 'Alice' : 'Bob'));
  });
  vi.stubGlobal('fetch', fetchMock);
  await setLastUser('userA');
  await setActingToken({ token: 'acting-of-A', expiresAt: Date.now() + 60_000 });
  await setRolePref('parent');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthGate account changes', () => {
  it('A -> signed out -> B: B never sees A cached data or acting token', async () => {
    const { rerender } = render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // A's acting token is sent for A (same user as stored), and A's data is cached under A's keys.
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('x-acting-token')).toBe('acting-of-A');
    await waitFor(() => expect(queryClient.getQueryData(qk.me())).toMatchObject({ user: { name: 'Alice' } }));
    queryClient.setQueryData(qk.children(), [{ id: 'c-A', name: 'Alice kid' }]);

    // Clerk ends the session by itself.
    auth.userId = null;
    rerender(tree());
    await waitFor(async () => {
      expect(await getActingToken()).toBeNull();
      expect(await getRolePref()).toBeNull();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    // Somebody else signs in.
    fetchMock.mockClear();
    auth.userId = 'userB';
    rerender(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get('x-acting-token')).toBeNull();
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer tokB');
    }
    await waitFor(() => expect(queryClient.getQueryData(qk.me())).toMatchObject({ user: { name: 'Bob' } }));
    expect(queryClient.getQueryData(qk.children())).toBeUndefined();
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('Alice');
  });

  it('a different user than last launch wipes the stale local state before the first request', async () => {
    await setLastUser('someoneElse');
    render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('x-acting-token')).toBeNull();
    expect(await getRolePref()).toBeNull();
  });

  it('offline at launch shows the error state with Retry and Sign out instead of a stuck splash', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(tree());
    expect(await screen.findByRole('button', { name: /try again/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  }, 10_000);
});

describe('Signed in with no role yet (device test I-3)', () => {
  it('Welcome shows "Signed in as <email> · Sign out", and Sign out clears everything', async () => {
    fetchMock.mockImplementation(async () =>
      json({ user: { id: 'userA', name: 'Nora', email: 'nora@e.com', isDemo: false }, roles: { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] } }),
    );
    signOut.mockClear();
    render(tree());
    expect(await screen.findByText(/Signed in as nora@e\.com/, undefined, { timeout: 5000 })).toBeInTheDocument();
    // Still the Welcome doors (no demo link for a signed-in person).
    expect(screen.getByRole('button', { name: /I'm a parent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try the demo/ })).toBeNull();
    screen.getByRole('button', { name: /^Sign out$/ }).click();
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(async () => {
      expect(await getActingToken()).toBeNull();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });
  }, 10_000);

  it('a signed-out Welcome has no "Signed in as" line', async () => {
    auth.userId = null;
    render(tree());
    expect(await screen.findByRole('button', { name: /Try the demo/ })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });
});
