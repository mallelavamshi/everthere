import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// "Peek as a Teacher" left this device registered to the demo daycare; then someone else signs in on it.
const auth = { isLoaded: true, userId: 'parentUser' as string | null };
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ ...auth, getToken: async () => 'tok' }),
  useClerk: () => ({ signOut: vi.fn(async () => {}) }),
}));
const poller = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/lib/alertsPoller', async (orig) => ({
  ...(await orig<typeof import('../src/lib/alertsPoller')>()),
  startAlertsPoller: poller.start,
  stopAlertsPoller: poller.stop,
}));

import { AuthGate } from '../src/shell/AuthGate';
import { AuthOpsProvider, type AuthOps } from '../src/features/onboarding/authOps';
import { queryClient } from '../src/lib/queries';
import { setTokenGetter } from '../src/lib/api';
import { clearDevice, getDevice, setDevice, setLastUser } from '../src/lib/storage';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
type Roles = { parent: boolean; adminOrgs: { id: string; name: string }[]; teacherOrgs: { id: string; name: string }[]; homeCaregiverFamilies: { id: string; label: string }[] };
const none: Roles = { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] };
let roles: Roles = none;

function Where() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}
const tree = () => (
  <QueryClientProvider client={queryClient}>
    <AuthOpsProvider value={{} as AuthOps}>
      <MemoryRouter initialEntries={['/']}>
        <AuthGate />
        <Where />
      </MemoryRouter>
    </AuthOpsProvider>
  </QueryClientProvider>
);
const path = () => screen.getByLabelText('path').textContent;

beforeEach(async () => {
  auth.userId = 'parentUser';
  queryClient.clear();
  setTokenGetter(null);
  poller.start.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/api/me') ? json({ user: { id: 'parentUser', name: 'Pat', email: 'p@e.com', isDemo: false }, roles }) : json([]),
    ),
  );
  await setLastUser('parentUser');
  // What the demo teacher left behind on this phone.
  await setDevice({ orgId: 'demo.org.acorns', deviceId: 'dev-demo' });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await clearDevice();
});

describe('a stale tablet registration never hijacks a later account', () => {
  it('a parent signing in after "Peek as a Teacher" lands on /parent, and the stale registration is forgotten', async () => {
    roles = { ...none, parent: true };
    render(tree());
    await waitFor(() => expect(path()).toBe('/parent'));
    await waitFor(async () => expect(await getDevice()).toBeNull());
  });

  it('a brand new account with no roles goes to onboarding, not to a classroom', async () => {
    roles = none;
    render(tree());
    await waitFor(() => expect(path()).toMatch(/^\/onboarding/));
    expect(path()).not.toMatch(/caregiver/);
  });

  it("parent alert polling runs on a phone that still has someone else's registration", async () => {
    roles = { ...none, parent: true };
    render(tree());
    await waitFor(() => expect(poller.start).toHaveBeenCalledWith('parentUser', expect.anything()));
  });

  it('staff of the registered org still get the classroom tablet', async () => {
    roles = { ...none, teacherOrgs: [{ id: 'demo.org.acorns', name: 'Little Acorns' }], parent: true };
    render(tree());
    await waitFor(() => expect(path()).toBe('/caregiver'));
    expect(await getDevice()).toEqual({ orgId: 'demo.org.acorns', deviceId: 'dev-demo' });
  });
});
