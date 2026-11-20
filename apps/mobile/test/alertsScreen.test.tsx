import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AlertView } from '@everthere/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsScreen } from '../src/features/alerts/AlertsScreen';
import { BellButton } from '../src/features/alerts/BellButton';
import { markAlertsRead, MAX_READ_IDS } from '../src/features/alerts/alertsApi';
import { setTokenGetter } from '../src/lib/api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const alert = (id: string, over: Partial<AlertView> = {}): AlertView => ({ id, kind: 'summary', refId: `s-${id}`, title: `Title ${id}`, body: `Body ${id}`, readAt: null, createdAt: Date.now() - 5 * 60_000, ...over });

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function mount(ui: ReactNode, path = '/parent/alerts') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenGetter(null);
});

function stub(items: AlertView[]) {
  const reads: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/alerts/read')) {
        const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
        reads.push(ids);
        return json({ updated: ids.length });
      }
      if (u.includes('/alerts')) return json({ items });
      return json({});
    }),
  );
  return reads;
}

describe('markAlertsRead', () => {
  it('splits more than 90 ids into chunks of at most 90 and drops duplicates', async () => {
    const reads = stub([]);
    const ids = Array.from({ length: 200 }, (_, i) => `a${i}`);
    const n = await markAlertsRead([...ids, 'a0', 'a1']);
    expect(MAX_READ_IDS).toBe(90);
    expect(reads.map((r) => r.length)).toEqual([90, 90, 20]);
    expect(n).toBe(200);
  });
  it('does nothing for an empty list', async () => {
    const reads = stub([]);
    expect(await markAlertsRead([])).toBe(0);
    expect(reads).toHaveLength(0);
  });
});

describe('AlertsScreen', () => {
  it('lists alerts with an icon per kind and relative times', async () => {
    stub([
      alert('1', { kind: 'flag', title: 'A moment worth a look' }),
      alert('2', { kind: 'avatar_ready', title: 'Your avatar is ready', createdAt: Date.now() - 3 * 3600_000 }),
      alert('3', { kind: 'invite', title: 'Invite accepted', readAt: 5, createdAt: Date.now() - 2 * 86_400_000 }),
    ]);
    mount(<AlertsScreen />);
    expect(await screen.findByText('A moment worth a look')).toBeInTheDocument();
    expect(screen.getByText('Your avatar is ready')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
    expect(screen.getByTestId('alert-icon-flag')).toBeInTheDocument();
    expect(screen.getByTestId('alert-icon-avatar_ready')).toBeInTheDocument();
    expect(screen.getByTestId('alert-icon-invite')).toBeInTheDocument();
  });

  it('shows the noAlerts empty state', async () => {
    stub([]);
    mount(<AlertsScreen />);
    expect(await screen.findByText(/All caught up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('opens the session when an alert is tapped, and marks it read', async () => {
    const reads = stub([alert('1', { kind: 'summary', refId: 'sess9', title: 'Mia felt better' })]);
    const user = userEvent.setup();
    mount(<AlertsScreen />);
    await user.click(await screen.findByRole('button', { name: /Mia felt better/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/sessions/sess9');
    await waitFor(() => expect(reads).toEqual([['1']]));
  });

  it('"Mark all read" marks every unread alert, in chunks of 90', async () => {
    const many = Array.from({ length: 150 }, (_, i) => alert(`n${i}`));
    const reads = stub(many);
    const user = userEvent.setup();
    mount(<AlertsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(reads.map((r) => r.length)).toEqual([90, 60]));
  });
});

describe('BellButton', () => {
  it('shows the unread count and opens the alerts screen', async () => {
    stub([alert('1'), alert('2')]);
    const user = userEvent.setup();
    mount(<BellButton />, '/parent');
    const bell = await screen.findByRole('button', { name: 'Alerts, 2 unread' });
    expect(within(bell).getByText('2')).toBeInTheDocument();
    await user.click(bell);
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/alerts');
  });
  it('has no badge when nothing is unread', async () => {
    stub([]);
    mount(<BellButton />, '/parent');
    const bell = await screen.findByRole('button', { name: 'Alerts' });
    expect(within(bell).queryByText('0')).toBeNull();
  });
});
