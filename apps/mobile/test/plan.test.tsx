import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AvatarView, ChildView, MeResponse, PlanView } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfortPlan } from '../src/features/plan/ComfortPlan';
import { TodayNoteSheet } from '../src/features/plan/TodayNoteSheet';
import { ParentHome } from '../src/features/parent/ParentHome';
import { sheetStack } from '../src/ui';
import { toast, toastStore } from '../src/ui/toast';
import { SessionProvider } from '../src/shell/SessionContext';
import { setTokenGetter } from '../src/lib/api';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const me: MeResponse = {
  user: { id: 'u1', name: 'Sarah Lee', email: 's@x.com', isDemo: false },
  roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
};
const avatar = (over: Partial<AvatarView> = {}): AvatarView => ({
  id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'k', photoUrl: 'https://m/1.jpg', parentTitle: 'Mom',
  consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true, ...over,
});
const child = (over: Partial<ChildView> = {}): ChildView =>
  ({ id: 'c1', name: 'Mia', photoKey: null, familyId: 'f', birthday: '2022-01-01', timezone: 'America/New_York', ...over }) as ChildView;
const emptyPlan = (over: Partial<PlanView> = {}): PlanView => ({
  childId: 'c1', avatarId: 'av1', parentTitle: 'Mom', tone: 'playful', nicknames: [], favorites: [], phrases: [], songTitle: null,
  songLyrics: null, neverTopics: [], todayNote: null, todayNoteExpiresAt: null, ...over,
});
const fam = (avatarId: string, status: string, isMine: boolean, title = 'Mom') => ({
  avatarId, ownerUserId: isMine ? 'u1' : 'u2', ownerName: 'x', parentTitle: title, status, isMine,
});

interface Calls {
  puts: { url: string; body: Record<string, unknown> }[];
}
function stub(
  opts: { plan?: PlanView | ((avatarId: string) => PlanView); children?: ChildView[]; avatars?: AvatarView[]; planStatus?: number; putStatus?: number; failPutOnce?: string; putDelayMs?: number } = {},
): Calls {
  const calls: Calls = { puts: [] };
  let failLeft = opts.failPutOnce ? 1 : 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const m = /\/children\/([^/]+)\/plans\/([^/?]+)/.exec(u);
      if (m) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          calls.puts.push({ url: u, body });
          if (opts.putDelayMs) await new Promise((r) => setTimeout(r, opts.putDelayMs));
          if (failLeft && u.includes(`/plans/${opts.failPutOnce}`)) {
            failLeft--;
            return json({ error: { code: 'INTERNAL', message: 'x' } }, 500);
          }
          if (opts.putStatus) return json({ error: { code: 'INVALID', message: 'no' } }, opts.putStatus);
          return json({ ...emptyPlan({ avatarId: m[2] }), ...body, songTitle: body.songTitle ?? null, songLyrics: body.songLyrics ?? null, todayNote: body.todayNote || null });
        }
        if (opts.planStatus) return json({ error: { code: opts.planStatus === 404 ? 'NOT_FOUND' : 'INTERNAL', message: 'x' } }, opts.planStatus);
        const p = typeof opts.plan === 'function' ? opts.plan(m[2]!) : (opts.plan ?? emptyPlan({ avatarId: m[2] }));
        return json(p);
      }
      if (u.includes('/children')) return json({ children: opts.children ?? [child()] });
      if (u.includes('/avatars/mine')) return json(opts.avatars ?? [avatar()]);
      if (u.includes('/sessions')) return json({ items: [], nextCursor: null });
      return json({});
    }),
  );
  return calls;
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function renderPlan(path = '/parent/children/c1/plan/av1') {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/parent', path]} initialIndex={1}>
        <SessionProvider me={me}>
          <Routes>
            <Route path="/parent/children/:childId/plan/:avatarId" element={<ComfortPlan />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function renderHome() {
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/parent']}>
        <SessionProvider me={me}>
          <Routes>
            <Route path="/parent" element={<ParentHome />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const save = () => screen.getByRole('button', { name: /^save$/i });
const addTo = (label: RegExp) => screen.getByRole('textbox', { name: label });
const toasts = () => toastStore.getSnapshot().map((t) => t.message);
const ready = () => screen.findByText('How do you comfort Mia?');

beforeEach(() => toast.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  setTokenGetter(null);
});

describe('ComfortPlan', () => {
  it('shows a skeleton while loading, then every section and the locked rules', async () => {
    stub();
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', async (...a: Parameters<typeof fetch>) => {
      await new Promise((r) => setTimeout(r, 150));
      return inner(...a);
    });
    renderPlan();
    expect((await screen.findAllByText('Loading')).length).toBeGreaterThan(0);
    await ready();
    for (const name of [/Mia calls me/, /I call Mia/, /^Tone$/, /Favorite things/, /Comfort phrases/, /Our song/, /Never talk about/]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Always on/)).toBeInTheDocument();
    for (const rule of [/pickup times/i, /no secrets/i, /never scolds/i, /medical advice/i]) expect(screen.getByText(rule)).toBeInTheDocument();
  });

  it('Save is disabled while the form is clean and enables on the first change', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    expect(save()).toBeDisabled();
    await user.type(addTo(/add to i call mia/i), 'Sunshine,');
    expect(save()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Remove Sunshine' }));
    expect(save()).toBeDisabled();
  });

  it('"Mia calls me" is a single choice with a custom entry', async () => {
    const user = userEvent.setup();
    stub({ plan: emptyPlan({ parentTitle: 'Mommy' }) });
    renderPlan();
    await ready();
    const group = screen.getByRole('radiogroup', { name: /mia calls me/i });
    expect(within(group).getByRole('radio', { name: 'Mommy' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Papa' }));
    expect(within(group).getByRole('radio', { name: 'Papa' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Mommy' })).not.toBeChecked();
    await user.click(within(group).getByRole('button', { name: /add your own/i }));
    await user.type(within(group).getByRole('textbox', { name: /what does mia call you/i }), 'Mumsy{Enter}');
    expect(within(group).getByRole('radio', { name: 'Mumsy' })).toBeChecked();
    expect(within(group).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it('saves the whole plan and thanks the parent by their title', async () => {
    const user = userEvent.setup();
    const calls = stub({ plan: emptyPlan({ parentTitle: 'Mommy' }) });
    renderPlan();
    await ready();
    await user.click(screen.getByRole('radio', { name: /Soothing/ }));
    await user.type(addTo(/add to i call mia/i), 'Sunshine,Mia-bear,');
    await user.click(screen.getByRole('button', { name: 'Bunny' }));
    await user.type(addTo(/add to comfort phrases/i), 'You are safe{Enter}');
    await user.type(screen.getByLabelText(/song title/i), 'Twinkle Twinkle');
    await user.type(screen.getByLabelText(/lyrics/i), 'Twinkle twinkle little star');
    await user.type(addTo(/add to never talk about/i), "Grandpa's hospital stay{Enter}");
    await user.click(save());
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(calls.puts[0]!.url).toContain('/children/c1/plans/av1');
    expect(calls.puts[0]!.body).toMatchObject({
      parentTitle: 'Mommy', tone: 'soothing', nicknames: ['Sunshine', 'Mia-bear'], favorites: ['Bunny'], phrases: ['You are safe'],
      songTitle: 'Twinkle Twinkle', songLyrics: 'Twinkle twinkle little star', neverTopics: ["Grandpa's hospital stay"],
    });
    await waitFor(() => expect(toasts()).toContain("Saved — Mommy's avatar will remember 💛"));
    expect(save()).toBeDisabled();
  });

  it("keeps today's note when saving the plan", async () => {
    const user = userEvent.setup();
    const calls = stub({ plan: emptyPlan({ todayNote: 'Pajama day!' }) });
    renderPlan();
    await ready();
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    await user.click(save());
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(calls.puts[0]!.body.todayNote).toBe('Pajama day!');
  });

  it('shows inline validation and does not send when a field is invalid', async () => {
    const user = userEvent.setup();
    const calls = stub();
    renderPlan();
    await ready();
    // Some keyboards can paste past maxLength: simulate with a direct value change.
    fireEvent.change(screen.getByLabelText(/lyrics/i), { target: { value: 'l'.repeat(1501) } });
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(/1500/);
    expect(calls.puts).toHaveLength(0);
  });

  it('a failed save keeps the edits and says so', async () => {
    const user = userEvent.setup();
    stub({ putStatus: 400 });
    renderPlan();
    await ready();
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    await user.click(save());
    await waitFor(() => expect(toastStore.getSnapshot().some((t) => t.kind === 'error')).toBe(true));
    expect(save()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove Bee' })).toBeInTheDocument();
  });

  it('leaving with unsaved changes asks first; "Keep editing" stays, "Leave" goes', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Remove Bee' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent');
  });

  it('a clean form leaves immediately', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('where')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the Android back button (sheet stack) asks first when dirty, and is not consumed when clean', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    expect(sheetStack.closeTop()).toBe(false);
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    // the guard must not lock the page behind it
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(sheetStack.closeTop()).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    // back again closes the question (stay)
    expect(sheetStack.closeTop()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Remove Bee' })).toBeInTheDocument();
  });

  it('"Try a test call" deep-links to test-and-approve', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    await user.click(await screen.findByRole('button', { name: /try a test call/i }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/avatar/test/av1');
  });

  it('"Try a test call" asks first when there are unsaved changes', async () => {
    const user = userEvent.setup();
    stub();
    renderPlan();
    await ready();
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    await user.click(await screen.findByRole('button', { name: /try a test call/i }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/avatar/test/av1');
  });

  it('NOT_FOUND gets friendly copy and a way back', async () => {
    const user = userEvent.setup();
    stub({ planStatus: 404 });
    renderPlan();
    expect(await screen.findByText(/couldn't find/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to home/i }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent');
  });

  it('a failed load shows a retry', async () => {
    const user = userEvent.setup();
    stub({ planStatus: 500 });
    renderPlan();
    const retry = await screen.findByRole('button', { name: /try again/i });
    stub();
    await user.click(retry);
    expect(await ready()).toBeInTheDocument();
  });

  it('edits made while a save is in flight are kept and leave the form dirty', async () => {
    const user = userEvent.setup();
    const calls = stub({ putDelayMs: 150 });
    renderPlan();
    await ready();
    await user.type(addTo(/add to i call mia/i), 'Bee{Enter}');
    await user.click(save());
    await user.type(addTo(/add to i call mia/i), 'Bug{Enter}'); // while the PUT is pending
    await waitFor(() => expect(toasts().some((t) => t.startsWith('Saved'))).toBe(true));
    expect(calls.puts).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Bug' })).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('the lyrics counter appears near the limit only', async () => {
    stub();
    renderPlan();
    await ready();
    expect(screen.queryByText(/\/ 1500/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/lyrics/i), { target: { value: 'l'.repeat(1400) } });
    expect(screen.getByText('1400 / 1500')).toBeInTheDocument();
  });
});

describe('TodayNoteSheet', () => {
  function sheet(c: ChildView, props: Partial<React.ComponentProps<typeof TodayNoteSheet>> = {}) {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <TodayNoteSheet open onClose={onClose} child={c} {...props} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('offers quick suggestions, keeps "Clears at midnight." visible, and limits to 120 characters', async () => {
    const user = userEvent.setup();
    stub();
    sheet(child({ familyAvatars: [fam('av1', 'approved', true)] }));
    expect(screen.getByText('Clears at midnight.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grandma picks up today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Daddy picks up today' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pajama day!' }));
    const input = screen.getByRole('textbox', { name: /note/i });
    expect(input).toHaveValue('Pajama day!');
    await user.clear(input);
    await user.click(input);
    await user.paste('y'.repeat(150));
    expect((input as HTMLInputElement).value).toHaveLength(120);
    expect(screen.getByText('Clears at midnight.')).toBeInTheDocument();
  });

  it('saves to every approved/ready avatar the caller owns, preserving each plan, skipping co-parents and unfinished avatars', async () => {
    const user = userEvent.setup();
    const calls = stub({ plan: (id) => emptyPlan({ avatarId: id, tone: 'calm', nicknames: [id === 'av1' ? 'Bee' : 'Bug'], songTitle: 'Twinkle' }) });
    const { onClose } = sheet(
      child({ familyAvatars: [fam('av1', 'approved', true), fam('av2', 'ready', true, 'Mommy'), fam('av3', 'approved', false, 'Dad'), fam('av4', 'creating', true)] }),
    );
    await user.click(screen.getByRole('button', { name: 'Daddy picks up today' }));
    await user.click(screen.getByRole('button', { name: /save note/i }));
    await waitFor(() => expect(calls.puts).toHaveLength(2));
    const byAvatar = Object.fromEntries(calls.puts.map((p) => [/plans\/([^/?]+)/.exec(p.url)![1]!, p.body]));
    expect(Object.keys(byAvatar).sort()).toEqual(['av1', 'av2']);
    expect(byAvatar.av1).toMatchObject({ todayNote: 'Daddy picks up today', tone: 'calm', nicknames: ['Bee'], songTitle: 'Twinkle' });
    expect(byAvatar.av2).toMatchObject({ todayNote: 'Daddy picks up today', nicknames: ['Bug'] });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a partial failure offers "Try again" for only the avatar that failed, and closes once everything is saved', async () => {
    const user = userEvent.setup();
    const calls = stub({ failPutOnce: 'av2' });
    const { onClose } = sheet(child({ familyAvatars: [fam('av1', 'approved', true), fam('av2', 'ready', true, 'Mommy')] }));
    await user.click(screen.getByRole('button', { name: 'Pajama day!' }));
    await user.click(screen.getByRole('button', { name: /save note/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Saved for your other avatar, but we couldn't reach Mommy's/);
    expect(onClose).not.toHaveBeenCalled();
    expect(calls.puts).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.puts).toHaveLength(3);
    expect(calls.puts[2]!.url).toContain('/plans/av2');
  });

  it('clearing the note sends an empty string', async () => {
    const user = userEvent.setup();
    const calls = stub({ plan: emptyPlan({ todayNote: 'Pajama day!' }) });
    sheet(child({ familyAvatars: [fam('av1', 'approved', true)] }), { note: 'Pajama day!' });
    const input = screen.getByRole('textbox', { name: /note/i });
    expect(input).toHaveValue('Pajama day!');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /clear note/i }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(calls.puts[0]!.body.todayNote).toBe('');
  });

  it("falls back to the caller's own avatars when the child has no family list yet", async () => {
    const user = userEvent.setup();
    const calls = stub();
    sheet(child(), { fallbackAvatarIds: ['av1'] });
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Hi');
    await user.click(screen.getByRole('button', { name: /save note/i }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
  });

  it('with no ready avatar it explains instead of saving', () => {
    stub();
    sheet(child({ familyAvatars: [fam('av4', 'creating', true)] }));
    expect(screen.getByText(/once your avatar is ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save note/i })).toBeDisabled();
  });
});

describe('ParentHome wiring', () => {
  it('opens the note editor from the card and then shows the saved note', async () => {
    const user = userEvent.setup();
    const calls = stub({ children: [child({ familyAvatars: [fam('av1', 'approved', true)] })] });
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Add a note for today' }));
    await user.click(await screen.findByRole('button', { name: 'Pajama day!' }));
    await user.click(screen.getByRole('button', { name: /save note/i }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(await screen.findByRole('button', { name: "Today's note: Pajama day!" })).toBeInTheDocument();
  });

  it('the child card links to the comfort plan', async () => {
    const user = userEvent.setup();
    stub();
    renderHome();
    await user.click(await screen.findByRole('button', { name: /comfort plan/i }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/children/c1/plan/av1');
  });
});
