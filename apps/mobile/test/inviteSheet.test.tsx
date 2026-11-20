import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CaregiversView, ChildView, MeResponse } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaregiversTab } from '../src/features/caregivers/CaregiversTab';
import { InviteSheet } from '../src/features/caregivers/InviteSheet';
import { shareText } from '../src/features/caregivers/shareCode';
import { SessionProvider } from '../src/shell/SessionContext';
import { toast, toastStore } from '../src/ui/toast';
import { setTokenGetter } from '../src/lib/api';
import { clearSessionStorage } from '../src/lib/storage';
import { Preferences } from '@capacitor/preferences';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));
const shareMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@capacitor/share', () => ({ Share: { share: shareMock } }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const leo = { id: 'c1', name: 'Leo', familyId: 'f1' } as ChildView;
const mia = { id: 'c2', name: 'Mia', familyId: 'f1' } as ChildView;
const me = (isDemo = false): MeResponse => ({
  user: { id: 'u1', name: 'Sarah', email: 's@x.com', isDemo },
  roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
});
const full: CaregiversView = {
  daycare: { connectionId: 'd1', org: { id: 'o1', name: 'Sunny Days' }, teachers: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ userId: `t${i}`, name: `Teacher${i}` })), transcriptAccess: false },
  home: [{ connectionId: 'h1', userId: 'u9', name: 'Rosa', transcriptAccess: false }],
};

interface Calls { reqs: { method: string; url: string; body?: Record<string, unknown> }[] }
function stub(opts: { children?: ChildView[]; caregivers?: CaregiversView | ((childId: string) => CaregiversView); patchStatus?: number; inviteStatus?: number; cgStatus?: number } = {}): Calls {
  const calls: Calls = { reqs: [] };
  const access = new Map<string, boolean>();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.reqs.push({ method, url: u, body });
    if (u.includes('/invites')) return opts.inviteStatus ? json({ error: { code: 'INTERNAL', message: 'x' } }, opts.inviteStatus) : json({ code: 'ABC234', expiresAt: Date.now() + 7 * 864e5 });
    if (u.includes('/caregivers')) {
      if (method === 'PATCH') {
        if (opts.patchStatus) return json({ error: { code: 'INTERNAL', message: 'x' } }, opts.patchStatus);
        access.set(/caregivers\/([^/?]+)/.exec(u)![1]!, body!.transcriptAccess as boolean);
        return json({ ok: true });
      }
      if (method === 'DELETE') return json({ ok: true });
      if (opts.cgStatus) return json({ error: { code: 'INTERNAL', message: 'x' } }, opts.cgStatus);
      const id = /children\/([^/]+)\/caregivers/.exec(u)![1]!;
      const v = typeof opts.caregivers === 'function' ? opts.caregivers(id) : (opts.caregivers ?? full);
      // The server remembers PATCHed access, so the refetch after a save agrees with the optimistic value.
      return json({
        daycare: v.daycare && { ...v.daycare, transcriptAccess: access.get(v.daycare.connectionId) ?? v.daycare.transcriptAccess },
        home: v.home.map((h) => ({ ...h, transcriptAccess: access.get(h.connectionId) ?? h.transcriptAccess })),
      });
    }
    if (u.includes('/children')) return json({ children: opts.children ?? [leo] });
    return json({});
  }));
  return calls;
}

function mount(isDemo = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SessionProvider me={me(isDemo)}>
          <CaregiversTab />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setTokenGetter(async () => 't');
  shareMock.mockClear();
  toast.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  toast.clear();
});

const toasts = () => toastStore.getSnapshot().map((t) => t.message);

describe('InviteSheet', () => {
  const sheet = (variant: 'home_caregiver' | 'co_parent', kids = [leo, mia]) => (
    <QueryClientProvider client={new QueryClient()}>
      <InviteSheet open onClose={() => {}} variant={variant} kids={kids} focusChild={kids[0]} />
    </QueryClientProvider>
  );

  it('the nanny invite will not generate until at least one child is selected', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(sheet('home_caregiver'));
    const gen = screen.getByRole('button', { name: /generate code/i });
    expect(gen).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Leo' }));
    expect(gen).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Leo' }));
    expect(gen).toBeDisabled();
    expect(calls.reqs.filter((r) => r.url.includes('/invites'))).toHaveLength(0);
  });

  it('a single child is preselected for the nanny invite', () => {
    stub();
    render(sheet('home_caregiver', [leo]));
    expect(screen.getByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /generate code/i })).toBeEnabled();
  });

  it('announces the code letter by letter and hides the visual code', async () => {
    stub();
    const user = userEvent.setup();
    render(sheet('co_parent'));
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    expect(await screen.findByText('Your invite code is A B C 2 3 4')).toBeInTheDocument();
    expect(screen.getByText('ABC234')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the co-parent variant has no child picker and can generate straight away', async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(sheet('co_parent'));
    expect(screen.queryByRole('group', { name: /choose children/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    expect(await screen.findByText('ABC234')).toBeInTheDocument();
    expect(calls.reqs.find((r) => r.url.includes('/invites'))?.body).toEqual({ type: 'co_parent', familyId: 'f1' });
    expect(screen.getByText('Good for 7 more days')).toBeInTheDocument();
  });

  it('posts the chosen children, then shows the code, expiry and shares the nanny text', async () => {
    const calls = stub();
    const user = userEvent.setup();
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: undefined }));
    const cap = await import('@capacitor/core');
    vi.spyOn(cap.Capacitor, 'isNativePlatform').mockReturnValue(true);
    render(sheet('home_caregiver'));
    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    expect(await screen.findByText('ABC234')).toBeInTheDocument();
    expect(calls.reqs.find((r) => r.url.includes('/invites'))?.body).toEqual({ type: 'home_caregiver', familyId: 'f1', childIds: ['c1'] });
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(shareMock).toHaveBeenCalledWith({ text: 'Join me on EverThere to comfort Leo 💛 Code: ABC234' });
    vi.restoreAllMocks();
  });

  it('Copy writes the share text and shows the Copied! toast', async () => {
    stub();
    const user = userEvent.setup();
    render(sheet('home_caregiver'));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    await screen.findByText('ABC234');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Join me on EverThere to comfort Leo 💛 Code: ABC234');
    expect(toasts()).toContain('Copied!');
  });

  it('shows friendly copy with a retry when generating fails', async () => {
    stub({ inviteStatus: 500 });
    const user = userEvent.setup();
    render(sheet('co_parent'));
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tangled/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
  });
});

describe('share text', () => {
  it('formats one child, several children and co-parents', () => {
    expect(shareText('home_caregiver', ['Mia'], 'ABC234')).toBe('Join me on EverThere to comfort Mia 💛 Code: ABC234');
    expect(shareText('home_caregiver', ['Leo', 'Mia'], 'ABC234')).toBe('Join me on EverThere to comfort Leo & Mia 💛 Code: ABC234');
    expect(shareText('home_caregiver', ['Leo', 'Mia', 'Zoe'], 'X')).toBe('Join me on EverThere to comfort Leo, Mia & Zoe 💛 Code: X');
    expect(shareText('co_parent', ['Leo'], 'ABC234')).toBe('Join me on EverThere to comfort Leo together 💛 Code: ABC234');
  });
});

describe('CaregiversTab', () => {
  it('shows the daycare card with up to 5 teachers and a +N overflow, toggle off by default', async () => {
    stub();
    mount();
    expect(await screen.findByText('Sunny Days')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^Teacher/ })).toHaveLength(5);
    expect(screen.getByText('Teachers always see summaries and flags')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Daycare can read full conversations' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles optimistically and PATCHes', async () => {
    const calls = stub();
    const user = userEvent.setup();
    mount();
    const sw = await screen.findByRole('switch', { name: 'Can read full conversations' });
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(calls.reqs.some((r) => r.method === 'PATCH' && r.url.endsWith('/children/c1/caregivers/h1') && r.body?.transcriptAccess === true)).toBe(true));
  });

  it('rolls the toggle back and toasts when the PATCH fails', async () => {
    stub({ patchStatus: 500 });
    const user = userEvent.setup();
    mount();
    const sw = await screen.findByRole('switch', { name: 'Daycare can read full conversations' });
    await user.click(sw);
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Daycare can read full conversations' })).toHaveAttribute('aria-checked', 'false'));
    expect(toasts().join(' ')).toMatch(/couldn't|try again/i);
  });

  it('Remove opens a confirm sheet and the destructive button calls DELETE', async () => {
    const calls = stub();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Remove Rosa' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Rosa won't be able to start comfort calls for Leo anymore/)).toBeInTheDocument();
    expect(calls.reqs.some((r) => r.method === 'DELETE')).toBe(false);
    await user.click(within(dlg).getByRole('button', { name: /^Remove/ }));
    await waitFor(() => expect(calls.reqs.some((r) => r.method === 'DELETE' && r.url.endsWith('/children/c1/caregivers/h1'))).toBe(true));
  });

  it('demo users see no Remove, a view-only hint and disabled switches', async () => {
    stub();
    mount(true);
    await screen.findByText('Rosa');
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByText(/Demo account — view only/)).toBeInTheDocument();
    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled();
  });

  it('clearing the session forgets the chosen child, so the next account starts fresh', async () => {
    stub({ children: [leo, mia] });
    const user = userEvent.setup();
    const first = mount();
    await screen.findByText('Rosa');
    await user.click(screen.getByRole('button', { name: 'Mia' }));
    await waitFor(async () => expect((await Preferences.get({ key: 'everthere.selectedChild' })).value).toBe('c2'));
    first.unmount();
    await clearSessionStorage(); // what an account change / sign-out runs
    expect((await Preferences.get({ key: 'everthere.selectedChild' })).value).toBeNull();
    mount();
    expect(await screen.findByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers the chosen child across mounts and stores it', async () => {
    stub({ children: [leo, mia] });
    const user = userEvent.setup();
    const first = mount();
    await screen.findByText('Rosa');
    await user.click(screen.getByRole('button', { name: 'Mia' }));
    await waitFor(async () => expect((await Preferences.get({ key: 'everthere.selectedChild' })).value).toBe('c2'));
    first.unmount();
    mount();
    expect(await screen.findByRole('button', { name: 'Mia' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('empty state offers both invites', async () => {
    stub({ caregivers: { home: [] } });
    mount();
    expect(await screen.findByRole('button', { name: /Invite a nanny or grandparent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite co-parent/ })).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    stub({ cgStatus: 500 });
    mount();
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('with several children, switching the chip loads that child\'s caregivers', async () => {
    const calls = stub({
      children: [leo, mia],
      caregivers: (id) => (id === 'c1' ? full : { home: [{ connectionId: 'h2', userId: 'u8', name: 'Grandma Joy', transcriptAccess: true }] }),
    });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Rosa');
    await user.click(screen.getByRole('button', { name: 'Mia' }));
    expect(await screen.findByText('Grandma Joy')).toBeInTheDocument();
    expect(screen.queryByText('Rosa')).toBeNull();
    expect(calls.reqs.some((r) => r.url.includes('/children/c2/caregivers'))).toBe(true);
  });
});
