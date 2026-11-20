import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AvatarView, MeResponse } from '@everthere/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { greetingFor } from '../src/features/parent/greeting';
import { ParentHome } from '../src/features/parent/ParentHome';
import { ChildForm } from '../src/features/parent/ChildForm';
import { SessionProvider } from '../src/shell/SessionContext';
import { setTokenGetter } from '../src/lib/api';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const at = (h: number) => new Date(2026, 5, 10, h, 30);

describe('greetingFor', () => {
  it('greets by time of day with the first name', () => {
    expect(greetingFor(at(9), 'Sarah Lee')).toBe('Good morning, Sarah ☀️');
    expect(greetingFor(at(14), 'Sarah')).toBe('Good afternoon, Sarah 🌤️');
    expect(greetingFor(at(19), 'Sarah')).toBe('Good evening, Sarah 🌙');
    expect(greetingFor(at(2), 'Sarah')).toMatch(/Sarah/);
  });
  it('boundaries: 5am is morning, noon is afternoon, 5pm is evening', () => {
    expect(greetingFor(at(5), 'S')).toMatch(/morning/);
    expect(greetingFor(at(11), 'S')).toMatch(/morning/);
    expect(greetingFor(at(12), 'S')).toMatch(/afternoon/);
    expect(greetingFor(at(17), 'S')).toMatch(/evening/);
  });
  it('copes with no name', () => {
    expect(greetingFor(at(9), '')).toBe('Good morning ☀️');
  });
});

const me = (isDemo = false): MeResponse => ({
  user: { id: 'u1', name: 'Sarah Lee', email: 's@x.com', isDemo },
  roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
});
const avatar = (over: Partial<AvatarView> = {}): AvatarView => ({
  id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'k', photoUrl: 'https://m/1.jpg', parentTitle: 'Mom',
  consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true, ...over,
});
const mia = { id: 'c1', name: 'Mia', photoKey: null, familyId: 'f', birthday: '2022-01-01', timezone: 'America/New_York' };

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function stub(data: { children?: unknown[]; avatars?: AvatarView[]; sessions?: unknown[]; plan?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/children/') && u.includes('/plans/')) return json(data.plan ?? { todayNote: null, todayNoteExpiresAt: null });
      if (u.includes('/children')) return json({ children: data.children ?? [] });
      if (u.includes('/avatars/mine')) return json(data.avatars ?? []);
      if (u.includes('/sessions')) return json({ items: data.sessions ?? [], nextCursor: null });
      return json({});
    }),
  );
}
function home(isDemo = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/parent']}>
        <SessionProvider me={me(isDemo)}>
          <Routes>
            <Route path="/parent" element={<ParentHome />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenGetter(null);
});

describe('ParentHome', () => {
  it('with no children shows the empty state and an Add your child action', async () => {
    stub({});
    const user = userEvent.setup();
    home();
    expect(await screen.findByText(/Add your child/, { selector: 'button *, button' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add your child' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/children/new');
  });

  it('with children but no avatar puts a big "Create your avatar" card on top', async () => {
    stub({ children: [mia], avatars: [] });
    const user = userEvent.setup();
    home();
    const cta = await screen.findByRole('button', { name: /Create your avatar/ });
    await user.click(cta);
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/avatar/setup');
  });

  it('shows the child card with avatar status, the today note and the latest session', async () => {
    stub({
      children: [mia],
      avatars: [avatar()],
      plan: { todayNote: 'Grandma picks up at 4', todayNoteExpiresAt: null },
      sessions: [{ id: 's1', child: { id: 'c1', name: 'Mia' }, caregiverName: 'Ms. Jess', reason: 'upset_nap', startedAt: Date.now() - 3600_000, durationS: 240, moodAfter: 'calmer', summary: 'You talked about Bunny.', moodSignal: null, flags: [] }],
    });
    home();
    expect(await screen.findByText('Mia')).toBeInTheDocument();
    expect(await screen.findByText(/Your avatar is ready/)).toBeInTheDocument();
    expect(await screen.findByText(/Grandma picks up at 4/)).toBeInTheDocument();
    expect(await screen.findByText(/Mia felt better/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create your avatar/ })).toBeNull();
  });

  it('shows the real child photo, and quietly falls back to the placeholder when the image errors', async () => {
    stub({ children: [{ ...mia, photoUrl: 'https://m/child.jpg' }], avatars: [avatar()] });
    const { container } = home();
    await screen.findByText('Mia');
    const img = container.querySelector('img[src="https://m/child.jpg"]');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img[src="https://m/child.jpg"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Mia' })).toHaveTextContent('🧸');
  });

  it('uses the placeholder when the child has no photo', async () => {
    stub({ children: [mia], avatars: [avatar()] });
    const { container } = home();
    await screen.findByText('Mia');
    expect(container.querySelector('img[src*="child"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Mia' })).toHaveTextContent('🧸');
  });

  it('shows one pill per co-parent avatar', async () => {
    const fa = (o: object) => ({ avatarId: 'x', ownerUserId: 'u2', ownerName: 'Dan', parentTitle: 'Dad', status: 'approved', isMine: false, ...o });
    stub({
      children: [{ ...mia, familyAvatars: [fa({ avatarId: 'av1', ownerUserId: 'u1', parentTitle: 'Mom', isMine: true }), fa({}), fa({ avatarId: 'y', parentTitle: 'Papa', status: 'creating' })] }],
      avatars: [avatar()],
    });
    home();
    expect(await screen.findByText(/Your avatar is ready/)).toBeInTheDocument();
    expect(screen.getAllByText(/Your avatar is ready/)).toHaveLength(1);
    expect(screen.getByText(/Dad is ready/)).toBeInTheDocument();
    expect(screen.getByText(/Papa is setting up/)).toBeInTheDocument();
  });

  it('the today-note card opens a sheet (never a dead button)', async () => {
    stub({ children: [mia], avatars: [avatar()] });
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Add a note for today/ }));
    expect(await screen.findByRole('dialog', { name: 'Add a note for today' })).toBeInTheDocument();
  });

  it('shows an empty state for no sessions yet', async () => {
    stub({ children: [mia], avatars: [avatar()], sessions: [] });
    home();
    expect(await screen.findByText(/No comfort calls yet/)).toBeInTheDocument();
  });

  it('has the four tabs', async () => {
    stub({ children: [mia], avatars: [avatar()] });
    home();
    for (const t of ['Home', 'My Avatar', 'Sessions', 'Caregivers']) expect(await screen.findByRole('button', { name: t })).toBeInTheDocument();
  });

  it('hides child editing for a demo account', async () => {
    stub({ children: [mia], avatars: [avatar()] });
    home(true);
    await screen.findByText('Mia');
    expect(screen.queryByRole('button', { name: /Edit Mia/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add another child/ })).toBeNull();
  });
});

describe('ChildForm', () => {
  it('edit mode shows the stored photo', () => {
    stub({});
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ChildForm child={{ ...mia, photoUrl: 'https://m/stored.jpg' }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('img[src="https://m/stored.jpg"]')).not.toBeNull();
  });

  it('shows the friendly DEMO_READ_ONLY copy when saving is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'DEMO_READ_ONLY', message: 'x' } }, 403)));
    const qc = new QueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ChildForm child={mia} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const name = screen.getByLabelText(/first name/i);
    await user.clear(name);
    await user.type(name, 'Mimi');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText(/demo account, so changes are switched off/)).toBeInTheDocument();
  });
});

describe('no hard-coded palette hex in the parent and avatar screens', () => {
  it('src/features/parent and src/features/avatar use tokens only', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(__dirname, '../src/features');
    const files = ['parent', 'avatar'].flatMap((d) => readdirSync(join(root, d)).map((f) => join(root, d, f)));
    expect(files.filter((f) => /#[0-9A-Fa-f]{3,8}\b/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
