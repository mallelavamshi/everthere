import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollSheet } from '../src/features/admin/EnrollSheet';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));
const shareMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@capacitor/share', () => ({ Share: { share: shareMock } }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const rooms = [
  { id: 'cl1', orgId: 'o1', name: 'Butterflies', emoji: null, assetKey: 'classroom.butterflies', staffUserIds: [] },
  { id: 'cl2', orgId: 'o1', name: 'Owls', emoji: '🦉', assetKey: null, staffUserIds: [] },
];

let reqs: { method: string; url: string; body?: Record<string, unknown> }[] = [];
beforeEach(() => {
  reqs = [];
  shareMock.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      reqs.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/enrollments') && init?.method === 'POST') {
        return json({ enrollment: { id: 'e1', childName: 'Leo', classroomId: 'cl2', status: 'invited' }, code: 'ABC234', expiresAt: Date.now() + 7 * 864e5 }, 201);
      }
      return json({});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(extra: Partial<Parameters<typeof EnrollSheet>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EnrollSheet open onClose={() => {}} orgId="o1" orgName="Little Acorns" classrooms={rooms} {...extra} />
    </QueryClientProvider>,
  );
}

async function nativeShare() {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: undefined }));
  const cap = await import('@capacitor/core');
  vi.spyOn(cap.Capacitor, 'isNativePlatform').mockReturnValue(true);
}

describe('EnrollSheet', () => {
  it('needs both a child name and a classroom before "Create invite" is enabled', async () => {
    const user = userEvent.setup();
    mount();
    const create = screen.getByRole('button', { name: 'Create invite' });
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('Child’s name'), 'Leo');
    expect(create).toBeDisabled(); // a name alone is not enough

    await user.click(screen.getByRole('radio', { name: 'Owls' }));
    expect(create).toBeEnabled();

    await user.clear(screen.getByLabelText('Child’s name'));
    expect(create).toBeDisabled(); // a classroom alone is not enough either
  });

  it('does not enable for a name made of spaces', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Child’s name'), '   ');
    await user.click(screen.getByRole('radio', { name: 'Owls' }));
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeDisabled();
  });

  it('creates the enrollment once, shows the code and shares the daycare text', async () => {
    const user = userEvent.setup();
    await nativeShare();
    mount();
    await user.type(screen.getByLabelText('Child’s name'), ' Leo ');
    await user.click(screen.getByRole('radio', { name: 'Owls' }));
    await user.dblClick(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText('ABC234')).toBeInTheDocument();
    const posts = reqs.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ url: expect.stringContaining('/orgs/o1/enrollments'), body: { childName: 'Leo', classroomId: 'cl2' } });
    expect(screen.getByText(/Your invite code is A B C 2 3 4/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(shareMock).toHaveBeenCalledWith({ text: 'Little Acorns invites you to EverThere 💛 Code: ABC234' });
  });

  it('re-shares an existing code without creating a new enrollment', async () => {
    const user = userEvent.setup();
    await nativeShare();
    mount({ existing: { code: 'XYZ789', childName: 'Mia' } });
    expect(screen.getByText('XYZ789')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(shareMock).toHaveBeenCalledWith({ text: 'Little Acorns invites you to EverThere 💛 Code: XYZ789' }));
    expect(reqs.some((r) => r.method === 'POST')).toBe(false);
  });
});
