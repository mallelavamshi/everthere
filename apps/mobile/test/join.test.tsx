import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Join } from '../src/features/onboarding/Join';
import { setTokenGetter } from '../src/lib/api';
import { PENDING_CODE_TTL_MS, readStashedCode, stashCode } from '../src/lib/pendingCode';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let peek: unknown;

function Probe() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname + l.search}</output>;
}

function renderJoin(opts: { signedIn?: boolean; at?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.at ?? '/onboarding/join']}>
        <Join signedIn={opts.signedIn ?? true} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  setTokenGetter(null);
  peek = { type: 'staff', orgName: 'Little Acorns', inviterName: 'Ms. Rose' };
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/invites/peek')) return peek instanceof Response ? peek : json(peek);
    if (url.endsWith('/api/invites/redeem')) return json({ ok: true });
    if (url.endsWith('/api/me'))
      return json({
        user: { id: 'u', name: 'T', email: 't@e.com', isDemo: false },
        roles: { parent: false, adminOrgs: [], teacherOrgs: [{ id: 'o', name: 'Little Acorns' }], homeCaregiverFamilies: [] },
      });
    return json({ children: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const typeCode = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  await user.click(boxes()[0]!);
  await user.paste(code);
};

describe('Join: code entry', () => {
  it('pasting "abc234" fills the six boxes, uppercased', async () => {
    const user = userEvent.setup();
    renderJoin();
    expect(boxes()).toHaveLength(6);
    await typeCode(user, 'abc234');
    expect(boxes().map((b) => b.value)).toEqual(['A', 'B', 'C', '2', '3', '4']);
  });

  it('drops characters outside the invite alphabet (no 0, O, 1, I, L)', async () => {
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'a0b1c-d2e3');
    expect(boxes().map((b) => b.value).join('')).toBe('ABCD2E');
  });

  it('typing auto-advances and backspace on an empty box goes back', async () => {
    const user = userEvent.setup();
    renderJoin();
    await user.click(boxes()[0]!);
    await user.keyboard('ab');
    expect(boxes()[2]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(boxes()[1]).toHaveFocus();
    expect(boxes()[1]!.value).toBe('');
    expect(boxes()[0]!.value).toBe('A');
  });
});

describe('Join: peek and PIN', () => {
  it('a staff invite shows the friendly card, then the PIN step', async () => {
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/Little Acorns invited you to join as a teacher/i)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ code: 'ABC234' });
    await user.click(screen.getByRole('button', { name: /accept/i }));
    expect(await screen.findByRole('heading', { name: /create your classroom pin/i })).toBeInTheDocument();
  });

  it('a mismatched PIN confirmation shows "PINs don\'t match"', async () => {
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /accept/i }));
    await screen.findByRole('heading', { name: /create your classroom pin/i });
    for (const d of '1234') await user.click(screen.getByRole('button', { name: d }));
    await screen.findByRole('heading', { name: /one more time/i });
    for (const d of '1235') await user.click(screen.getByRole('button', { name: d }));
    expect(await screen.findByText("PINs don't match")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/invites/redeem'))).toBe(false);
  });

  it('matching PINs redeem with the pin and go to the role home', async () => {
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /accept/i }));
    await screen.findByRole('heading', { name: /create your classroom pin/i });
    for (const d of '2468') await user.click(screen.getByRole('button', { name: d }));
    await screen.findByRole('heading', { name: /one more time/i });
    for (const d of '2468') await user.click(screen.getByRole('button', { name: d }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/caregiver'));
    const redeem = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/invites/redeem'))!;
    expect(JSON.parse(redeem[1].body)).toEqual({ code: 'ABC234', pin: '2468' });
  });

  it("INVITE_INVALID shows the friendly \"didn't work\" message and keeps the boxes", async () => {
    peek = json({ error: { code: 'INVITE_INVALID', message: 'x' } }, 400);
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/That code didn.t work/i)).toBeInTheDocument();
    expect(boxes().map((b) => b.value).join('')).toBe('ABC234');
  });

  it('parent_enrollment lists existing children plus "Add <child> as new"', async () => {
    peek = { type: 'parent_enrollment', orgName: 'Little Acorns', childName: 'Mia', inviterName: 'Ms. Rose' };
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/invites/peek')) return json(peek);
      if (url.endsWith('/api/children')) return json({ children: [{ id: 'c1', name: 'Mimi', photoKey: null, familyId: 'f1' }] });
      return json({});
    });
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /accept/i }));
    expect(await screen.findByText(/is this one of your children/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Mimi/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Mia as new/i })).toBeInTheDocument();
  });
});

describe('Join: signed out', () => {
  it('asks to sign up or sign in first; no URL it produces contains the code', async () => {
    const user = userEvent.setup();
    renderJoin({ signedIn: false });
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(fetchMock).not.toHaveBeenCalled(); // peek needs a session
    await user.click(await screen.findByRole('button', { name: /create my account/i }));
    const loc = screen.getByTestId('loc').textContent!;
    expect(loc).toContain('/signup');
    expect(decodeURIComponent(loc)).not.toMatch(/ABC234/i);
    expect(new URLSearchParams(loc.split('?')[1]).get('next')).toBe('/onboarding/join');
  });

  it('the sign-in route carries no code either', async () => {
    const user = userEvent.setup();
    renderJoin({ signedIn: false });
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /i already have an account/i }));
    expect(decodeURIComponent(screen.getByTestId('loc').textContent!)).not.toMatch(/ABC234/i);
  });

  it('the code survives the round trip and is cleared once redeemed', async () => {
    const user = userEvent.setup();
    const first = renderJoin({ signedIn: false });
    await typeCode(user, 'abc234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    first.unmount(); // the sign-up screens replace Join
    renderJoin({ at: '/onboarding/join' });
    expect(boxes().map((b) => b.value).join('')).toBe('ABC234');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /accept/i }));
    await screen.findByRole('heading', { name: /create your classroom pin/i });
    for (const d of '2468') await user.click(screen.getByRole('button', { name: d }));
    await screen.findByRole('heading', { name: /one more time/i });
    for (const d of '2468') await user.click(screen.getByRole('button', { name: d }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/caregiver'));
    expect(readStashedCode()).toBe('');
  });

  it('a stashed code expires after 30 minutes', () => {
    stashCode('ABC234', Date.now() - PENDING_CODE_TTL_MS - 1000);
    expect(readStashedCode()).toBe('');
    stashCode('ABC234', Date.now() - 60_000);
    expect(readStashedCode()).toBe('ABC234');
  });

  it('a double tap on Continue peeks once', async () => {
    const user = userEvent.setup();
    renderJoin();
    await typeCode(user, 'abc234');
    const btn = screen.getByRole('button', { name: /continue/i });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await screen.findByText(/invited you/i);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/invites/peek'))).toHaveLength(1);
  });
});
