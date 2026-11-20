import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@everthere/shared';

const signOut = vi.fn(async () => {});
vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut }), useAuth: () => ({ getToken: async () => 't' }) }));

import { OfflineBanner } from '../src/shell/OfflineBanner';
import { ProfileSheet } from '../src/shell/ProfileSheet';
import { networkStatus } from '../src/lib/native';
import { getActingToken, getRolePref, setActingToken, setRolePref } from '../src/lib/storage';

beforeEach(() => {
  networkStatus.reset();
  signOut.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('OfflineBanner', () => {
  it('shows on a network failure and clears on the next success', () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(/offline/i)).toBeNull();
    act(() => networkStatus.reportFailure());
    expect(screen.queryByText(/offline/i)).toBeNull(); // debounced: needs 2 consecutive failures
    act(() => networkStatus.reportFailure());
    expect(screen.getByText("You're offline — we'll reconnect soon 💛")).toBeInTheDocument();
    act(() => networkStatus.reportSuccess());
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('shows while navigator.onLine is false', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

const me = (roles: Partial<MeResponse['roles']>, isDemo = false): MeResponse => ({
  user: { id: 'u', name: 'Kim Lee', email: 'k@e.com', isDemo },
  roles: { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [], ...roles },
});

function renderSheet(m: MeResponse, qc = new QueryClient()) {
  const onRole = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfileSheet open onClose={() => {}} me={m} onSwitchRole={onRole} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, onRole };
}

describe('ProfileSheet', () => {
  it('shows name, demo badge, and hides the role switcher with one role', () => {
    renderSheet(me({ parent: true }, true));
    expect(screen.getByText('Kim Lee')).toBeInTheDocument();
    expect(screen.getByText(/demo/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the role switcher only with more than one role and switches', async () => {
    const { onRole } = renderSheet(me({ parent: true, adminOrgs: [{ id: 'o', name: 'O' }] }));
    await userEvent.click(screen.getByRole('radio', { name: /parent/i }));
    expect(onRole).toHaveBeenCalledWith('parent');
  });

  it('sign out clears the acting token, the role preference and the query cache', async () => {
    await setActingToken({ token: 'a', expiresAt: Date.now() + 60_000 });
    await setRolePref('admin');
    const qc = new QueryClient();
    qc.setQueryData(['me'], { x: 1 });
    renderSheet(me({ parent: true }), qc);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(async () => {
      expect(signOut).toHaveBeenCalled();
      expect(await getActingToken()).toBeNull();
      expect(await getRolePref()).toBeNull();
      expect(qc.getQueryData(['me'])).toBeUndefined();
    });
  });
});
