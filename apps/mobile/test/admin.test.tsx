import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { DashboardView, MeResponse } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoutes } from '../src/features/admin/AdminRoutes';
import { LAST_ADMIN_COPY } from '../src/features/admin/Staff';
import { lifeText } from '../src/features/caregivers/CodeDisplay';
import { InviteSheet } from '../src/features/caregivers/InviteSheet';
import { SessionProvider } from '../src/shell/SessionContext';
import { Toaster, toast } from '../src/ui';
import { toastStore } from '../src/ui/toast';
import { useMe } from '../src/lib/queries';
import { setTokenGetter } from '../src/lib/api';
import { clearSessionStorage } from '../src/lib/storage';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));
const shareMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@capacitor/share', () => ({ Share: { share: shareMock } }));
const pickMock = vi.hoisted(() => vi.fn<(k: string) => Promise<Blob | null>>(async () => new Blob(['x'], { type: 'image/jpeg' })));
vi.mock('../src/lib/pickPhoto', () => ({ pickPhoto: pickMock }));
vi.mock('../src/lib/image', async (orig) => ({ ...(await orig<typeof import('../src/lib/image')>()), downscaleForUpload: async (b: Blob) => b }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const err = (code: string, status = 400) => json({ error: { code, message: code } }, status);

const me = (isDemo = false): MeResponse => ({
  user: { id: 'u1', name: 'Dana Director', email: 'd@x.com', isDemo },
  roles: { parent: false, adminOrgs: [{ id: 'o1', name: 'Little Acorns' }], teacherOrgs: [], homeCaregiverFamilies: [] },
});

const flag = (id: string, childName: string, over: Partial<DashboardView['openFlags'][number]> = {}): DashboardView['openFlags'][number] => ({
  id, sessionId: `s-${id}`, childName, category: 'injury', quote: 'My arm hurts', severity: 'high', createdAt: Date.now() - 60_000, ...over,
});
const DASH: DashboardView = { readyCount: 12, todaySessions: 5, monthSessions: 37, monthCostUsd: 4.2, openFlags: [flag('f1', 'Mia'), flag('f2', 'Leo', { category: 'other', severity: 'low', quote: null })] };
const STAFF = [
  { userId: 'u1', name: 'Dana Director', email: 'd@x.com', role: 'admin', hasPin: false, classroomIds: [] },
  { userId: 't1', name: 'Jess Park', email: 'j@x.com', role: 'teacher', hasPin: true, classroomIds: ['cl1'] },
  { userId: 't2', name: 'Amir Khan', email: 'a@x.com', role: 'teacher', hasPin: false, classroomIds: [] },
];
const ROOMS = [
  { id: 'cl1', orgId: 'o1', name: 'Butterflies', emoji: null, assetKey: 'classroom.butterflies', staffUserIds: ['t1'] },
  { id: 'cl2', orgId: 'o1', name: 'Owls', emoji: '🦉', assetKey: null, staffUserIds: [] },
];
const NOW = Date.now();
const ENR = [
  { id: 'e1', orgId: 'o1', classroomId: 'cl1', childName: 'Leo', inviteCode: 'ABC234', childId: null, status: 'invited', createdAt: NOW - 864e5 },
  { id: 'e2', orgId: 'o1', classroomId: 'cl1', childName: 'Mia', inviteCode: 'MIA222', childId: 'c2', status: 'linked', createdAt: NOW - 2 * 864e5 },
  { id: 'e3', orgId: 'o1', classroomId: 'cl2', childName: 'Zoe', inviteCode: 'ZOE333', childId: 'c3', status: 'linked', createdAt: NOW - 3 * 864e5 },
  { id: 'e4', orgId: 'o1', classroomId: 'cl2', childName: 'Old', inviteCode: 'OLD444', childId: null, status: 'invited', createdAt: NOW - 8 * 864e5 },
];
const TILES = [
  { enrollmentId: 'e1', name: 'Leo', status: 'invite_sent', readyAvatars: [] },
  { enrollmentId: 'e2', childId: 'c2', name: 'Mia', status: 'setup_pending', readyAvatars: [] },
  { enrollmentId: 'e3', childId: 'c3', name: 'Zoe', status: 'ready', readyAvatars: [{ avatarId: 'a1', parentTitle: 'Mommy' }] },
  { enrollmentId: 'e4', name: 'Old', status: 'invite_sent', readyAvatars: [] },
];

interface Call { method: string; url: string; body?: any; form?: FormData }
let calls: Call[] = [];
type Handler = (c: Call) => Response | Promise<Response> | undefined;
let overrides: Handler[] = [];
const baseOrg = { id: 'o1', name: 'Little Acorns', address: '1 Oak St', timezone: 'America/New_York', logoKey: null as string | null, logoUrl: null as string | null, role: 'admin' };
let org = baseOrg;
let dash = DASH;

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c: Call = {
        method: (init.method ?? 'GET').toUpperCase(),
        url: String(url),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        form: init.body instanceof FormData ? init.body : undefined,
      };
      calls.push(c);
      for (const h of overrides) {
        const r = h(c);
        if (r) return r;
      }
      const p = new URL(c.url, 'http://x').pathname.replace(/^.*\/api/, '');
      if (c.method === 'GET') {
        if (p === '/orgs/o1') return json(org);
        if (p === '/orgs/o1/dashboard') return json(dash);
        if (p === '/orgs/o1/classrooms') return json({ classrooms: ROOMS });
        if (p === '/orgs/o1/staff') return json({ staff: STAFF });
        if (p === '/orgs/o1/enrollments') return json({ enrollments: ENR });
        if (p === '/orgs/o1/roster') return json({ tiles: TILES });
      }
      if (c.method === 'POST' && p === '/orgs/o1/invites/staff') return json({ code: 'TCH234', expiresAt: NOW + 7 * 864e5 });
      if (c.method === 'POST' && p === '/orgs/o1/classrooms') return json({ id: 'cl9', orgId: 'o1', name: c.body.name, emoji: null, assetKey: c.body.assetKey ?? null, staffUserIds: [] }, 201);
      if (c.method === 'PUT' && p.startsWith('/classrooms/')) return json({ classroomId: 'x', userIds: c.body.userIds });
      if (c.method === 'POST' && p === '/media') return json({ key: `logo/o1/${'a'.repeat(21)}.jpg`, url: 'https://x/m/y' });
      if (c.method === 'PATCH' && p === '/orgs/o1') return json({ ...org, ...c.body });
      return json({ ok: true });
    }),
  );
}
const on = (method: string, re: RegExp, res: () => Response | Promise<Response>): Handler => (c) => (c.method === method && re.test(c.url) ? res() : undefined);

/** The real app always has /me loaded (AuthGate keeps it active); the probe stands in for that. */
function MeProbe() {
  useMe();
  return null;
}
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function mount(path = '/admin', isDemo = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider me={me(isDemo)}>
          <Routes>
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="/caregiver" element={<span>tablet view</span>} />
            <Route path="/" element={<span>home screen</span>} />
          </Routes>
          <Where />
          <MeProbe />
        </SessionProvider>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const toasts = () => toastStore.getSnapshot();

async function nativeShare() {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: undefined }));
  const cap = await import('@capacitor/core');
  vi.spyOn(cap.Capacitor, 'isNativePlatform').mockReturnValue(true);
}

beforeEach(async () => {
  calls = [];
  overrides = [];
  dash = DASH;
  org = { ...baseOrg };
  shareMock.mockClear();
  pickMock.mockClear();
  setTokenGetter(async () => 't');
  await clearSessionStorage();
  stub();
});
afterEach(() => {
  setTokenGetter(null);
  toast.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AdminHome', () => {
  it('shows stat stickers, open flags with quote, the usage card and the billing teaser', async () => {
    mount();
    expect(await screen.findByRole('group', { name: '12 avatars ready' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '5 sessions today' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '37 sessions this month' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Open flags' })).toBeInTheDocument();
    const mia = screen.getByRole('listitem', { name: /Mia/ });
    expect(within(mia).getByText('Injury')).toBeInTheDocument();
    expect(within(mia).getByText('High')).toBeInTheDocument();
    expect(within(mia).getByText(/My arm hurts/)).toBeInTheDocument();
    expect(screen.getByText('37 sessions this month')).toBeInTheDocument();
    expect(screen.getByText('Families pay $9/mo add-on — billing coming with launch')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('has a friendly empty state when no flags are open', async () => {
    dash = { ...DASH, openFlags: [] };
    mount();
    expect(await screen.findByText(/All calm/)).toBeInTheDocument();
  });

  it('acknowledges optimistically: the flag leaves at once and a toast confirms', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    overrides.push(on('POST', /\/flags\/f1\/ack/, async () => (await gate, json({ ok: true }))));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge flag for Mia' }));
    // Gone before the server has answered.
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Mia/ })).not.toBeInTheDocument());
    expect(screen.getByRole('listitem', { name: /Leo/ })).toBeInTheDocument();
    release();
    await waitFor(() => expect(toasts().some((t) => t.kind === 'success' && /acknowledged/i.test(t.message))).toBe(true));
  });

  it('rolls the flag back and shows a friendly toast when acknowledging fails', async () => {
    overrides.push(on('POST', /\/flags\/f1\/ack/, () => err('INTERNAL', 500)));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge flag for Mia' }));
    await waitFor(() => expect(toasts().some((t) => t.kind === 'error')).toBe(true));
    expect(await screen.findByRole('listitem', { name: /Mia/ })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/flags/f1/ack'))).toBe(true);
  });

  it('opens the classroom tablet view', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Open classroom tablet view' }));
    expect(await screen.findByText('tablet view')).toBeInTheDocument();
  });

  it('moves between the four tabs', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('group', { name: '12 avatars ready' });
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' })); // each tab screen mounts its own bar
    await user.click(nav().getByRole('button', { name: 'Staff' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/staff');
    await user.click(nav().getByRole('button', { name: 'Enrollments' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/enrollments');
    await user.click(nav().getByRole('button', { name: 'Classrooms' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/classrooms');
  });
});

describe('Classrooms', () => {
  it('shows an emblem card per classroom with the teacher count', async () => {
    mount('/admin/classrooms');
    const cl1 = await screen.findByRole('button', { name: /Butterflies/ });
    expect(within(cl1).getByText('1 teacher')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Owls/ })).getByText('No teachers yet')).toBeInTheDocument();
  });

  it('creates a classroom with a name, emblem and teachers', async () => {
    const user = userEvent.setup();
    mount('/admin/classrooms');
    await user.click(await screen.findByRole('button', { name: 'New classroom' }));
    await user.click(screen.getByRole('radio', { name: 'Turtles' }));
    expect(screen.getByLabelText('Classroom name')).toHaveValue('Turtles');
    await user.click(screen.getByRole('button', { name: 'Jess Park' }));
    await user.click(screen.getByRole('button', { name: 'Create classroom' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/orgs/o1/classrooms'))!;
    expect(post.body).toEqual({ name: 'Turtles', assetKey: 'classroom.turtles' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/classrooms/cl9/staff');
    expect(put.body).toEqual({ userIds: ['t1'] });
    await waitFor(() => expect(toasts().some((t) => t.kind === 'success')).toBe(true));
  });

  it('edits a classroom: renames it, changes teachers, and lists its children read-only', async () => {
    const user = userEvent.setup();
    mount('/admin/classrooms');
    await user.click(await screen.findByRole('button', { name: /Butterflies/ }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Leo')).toBeInTheDocument();
    expect(within(dlg).getByText('Mia')).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Leo' })).not.toBeInTheDocument(); // read-only
    await user.clear(within(dlg).getByLabelText('Classroom name'));
    await user.type(within(dlg).getByLabelText('Classroom name'), 'Monarchs');
    await user.click(within(dlg).getByRole('button', { name: 'Amir Khan' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/classrooms/cl1'))!;
    expect(patch.body).toEqual({ name: 'Monarchs', assetKey: 'classroom.butterflies' });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ userIds: ['t1', 't2'] });
  });
});

describe('lifeText', () => {
  const now = Date.UTC(2026, 0, 1);
  it('says how long a code has left', () => {
    expect(lifeText(now + 5.5 * 864e5, now)).toBe('Good for 6 more days');
    expect(lifeText(now + 0.5 * 864e5, now)).toBe('Good until tomorrow');
    expect(lifeText(now - 1, now)).toBe('This code has expired');
    expect(lifeText(undefined, now)).toBe('Good for 7 days');
  });
});

describe('Classroom save details', () => {
  it('sends no PATCH when only the teachers changed', async () => {
    const user = userEvent.setup();
    mount('/admin/classrooms');
    await user.click(await screen.findByRole('button', { name: /Butterflies/ }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Amir Khan' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('does not PATCH an emoji classroom that was not changed', async () => {
    const user = userEvent.setup();
    mount('/admin/classrooms');
    await user.click(await screen.findByRole('button', { name: /Owls/ }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Jess Park' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('refreshes the list when the teacher step fails after the rename landed', async () => {
    overrides.push(on('PUT', /\/classrooms\/cl1\/staff/, () => err('INTERNAL', 500)));
    const user = userEvent.setup();
    mount('/admin/classrooms');
    await user.click(await screen.findByRole('button', { name: /Butterflies/ }));
    const dlg = await screen.findByRole('dialog');
    await user.clear(within(dlg).getByLabelText('Classroom name'));
    await user.type(within(dlg).getByLabelText('Classroom name'), 'Monarchs');
    await user.click(within(dlg).getByRole('button', { name: 'Amir Khan' }));
    const before = calls.filter((c) => c.method === 'GET' && c.url.endsWith('/orgs/o1/classrooms')).length;
    await user.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await within(dlg).findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.endsWith('/orgs/o1/classrooms')).length).toBeGreaterThan(before));
    // Retrying does not repeat the rename.
    await user.click(within(dlg).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').length).toBe(2));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
});

describe('Staff', () => {
  it('lists staff with role badges and PIN status', async () => {
    mount('/admin/staff');
    const jess = await screen.findByRole('listitem', { name: /Jess Park/ });
    expect(within(jess).getByText('Teacher')).toBeInTheDocument();
    expect(within(jess).getByText('PIN set ✓')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: /Amir Khan/ })).getByText('No PIN yet')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: /Dana Director/ })).getByText('Admin')).toBeInTheDocument();
  });

  it('invites a teacher with the daycare share text', async () => {
    const user = userEvent.setup();
    await nativeShare();
    mount('/admin/staff');
    await user.click(await screen.findByRole('button', { name: 'Invite a teacher' }));
    await user.click(await screen.findByRole('button', { name: 'Generate code' }));
    expect(await screen.findByText('TCH234')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/invites/staff'))?.method).toBe('POST');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(shareMock).toHaveBeenCalledWith({ text: 'Join Little Acorns on EverThere as a teacher 💛 Code: TCH234' });
  });

  it('removes a teacher after a confirm sheet', async () => {
    const user = userEvent.setup();
    mount('/admin/staff');
    await user.click(await screen.findByRole('button', { name: 'Remove Amir Khan' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { name: 'Remove Amir Khan?' })).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/orgs/o1/staff/t2'))).toBe(true));
  });

  it('explains the last-admin refusal in friendly words', async () => {
    overrides.push(on('DELETE', /\/staff\/u1/, () => err('INVALID', 400)));
    const user = userEvent.setup();
    mount('/admin/staff');
    await user.click(await screen.findByRole('button', { name: 'Remove Dana Director' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_ADMIN_COPY);
    expect(LAST_ADMIN_COPY).toMatch(/at least one admin/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // stays open so the admin can read it
  });

  it('removing yourself asks with distinct copy, then reloads who you are and leaves for home', async () => {
    const user = userEvent.setup();
    mount('/admin/staff');
    await user.click(await screen.findByRole('button', { name: 'Remove Dana Director' }));
    const dlg = await screen.findByRole('dialog', { name: 'Remove yourself?' });
    expect(within(dlg).getByText("You'll lose admin access to Little Acorns. Are you sure?")).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('home screen')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/orgs/o1/staff/u1'))).toBe(true);
    expect(calls.some((c) => c.method === 'GET' && /\/me$/.test(c.url))).toBe(true);
  });

  it('removing someone else stays on the staff list', async () => {
    const user = userEvent.setup();
    mount('/admin/staff');
    await user.click(await screen.findByRole('button', { name: 'Remove Amir Khan' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toasts().some((t) => /removed/.test(t.message))).toBe(true));
    expect(screen.queryByText('home screen')).not.toBeInTheDocument();
  });

  it('demo accounts get no remove buttons, only a view-only hint', async () => {
    mount('/admin/staff', true);
    await screen.findByRole('listitem', { name: /Jess Park/ });
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
  });
});

describe('Enrollments', () => {
  it('maps status chips from the roster: Invite sent, Linked, Avatar ready', async () => {
    mount('/admin/enrollments');
    const row = async (n: string) => await screen.findByRole('listitem', { name: new RegExp(n) });
    expect(within(await row('Leo')).getByText('Invite sent')).toBeInTheDocument();
    expect(within(await row('Mia')).getByText('Linked')).toBeInTheDocument();
    expect(within(await row('Zoe')).getByText('Avatar ready')).toBeInTheDocument();
    expect(within(await row('Leo')).getByText('Butterflies')).toBeInTheDocument();
  });

  it('re-shares a live invite from the stored code', async () => {
    const user = userEvent.setup();
    await nativeShare();
    mount('/admin/enrollments');
    await user.click(await screen.findByRole('button', { name: 'Share invite for Leo' }));
    expect(await screen.findByText('ABC234')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(shareMock).toHaveBeenCalledWith({ text: 'Little Acorns invites you to EverThere 💛 Code: ABC234' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers "Create a new invite" instead of a stale code once 7 days have passed', async () => {
    const user = userEvent.setup();
    mount('/admin/enrollments');
    await screen.findByRole('listitem', { name: /Old/ });
    expect(screen.queryByRole('button', { name: 'Share invite for Old' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share invite for Mia' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a new invite for Old' }));
    expect(await screen.findByLabelText('Child’s name')).toHaveValue('Old');
    expect(screen.getByRole('radio', { name: 'Owls' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeEnabled();
  });
});

describe('DaycareProfile', () => {
  it('edits name, address and timezone and saves only what changed', async () => {
    const user = userEvent.setup();
    mount('/admin/profile');
    const name = await screen.findByLabelText('Daycare name');
    await user.clear(name);
    await user.type(name, 'Big Acorns');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Big Acorns' });
  });

  it('never shows a broken image: no logo falls back to the initial, a failing logo URL does too', async () => {
    const first = mount('/admin/profile');
    await screen.findByLabelText('Daycare name');
    expect(first.container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Little Acorns logo' })).toHaveTextContent('L');
    first.unmount();

    org = { ...baseOrg, logoKey: `logo/o1/${'a'.repeat(21)}.jpg`, logoUrl: 'https://api.test/m/logo?exp=1&sig=2' };
    const second = mount('/admin/profile');
    await screen.findByLabelText('Daycare name');
    const img = await waitFor(() => {
      const i = second.container.querySelector('img');
      expect(i).not.toBeNull();
      return i!;
    });
    expect(img).toHaveAttribute('src', 'https://api.test/m/logo?exp=1&sig=2');
    fireEvent.error(img);
    await waitFor(() => expect(second.container.querySelector('img')).toBeNull());
    expect(screen.getByRole('img', { name: 'Little Acorns logo' })).toHaveTextContent('L');
  });

  it('uploads a logo: pick, downscale, POST media (logo + orgId), then PATCH logoKey', async () => {
    const user = userEvent.setup();
    mount('/admin/profile');
    await user.click(await screen.findByRole('button', { name: 'Choose from gallery' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const media = calls.find((c) => c.method === 'POST' && c.url.endsWith('/media'))!;
    expect(media.form!.get('purpose')).toBe('logo');
    expect(media.form!.get('orgId')).toBe('o1');
    expect(pickMock).toHaveBeenCalledWith('gallery');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ logoKey: `logo/o1/${'a'.repeat(21)}.jpg` });
  });

  it('demo accounts cannot rename: the field is read-only with a view-only hint', async () => {
    mount('/admin/profile', true);
    expect(await screen.findByLabelText('Daycare name')).toBeDisabled();
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
  });
});

describe('InviteSheet staff variant', () => {
  it('needs no children: the heading and button are for teachers', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InviteSheet open onClose={() => {}} variant="staff" orgId="o1" orgName="Little Acorns" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Invite a teacher' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate code' })).toBeEnabled();
  });
});
