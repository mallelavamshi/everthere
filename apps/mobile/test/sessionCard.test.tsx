import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SessionItem } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCard } from '../src/features/sessions/SessionCard';
import { SessionDetail } from '../src/features/sessions/SessionDetail';
import { SessionsTab } from '../src/features/sessions/SessionsTab';
import { dayLabel, groupByDay, moodPill, sessionTitle, summaryPending } from '../src/features/sessions/sessionCopy';
import { setTokenGetter } from '../src/lib/api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const mia = { id: 'c1', name: 'Mia', photoKey: null, familyId: 'f', birthday: '2022-01-01', timezone: 'America/New_York' };

const item = (id: string, over: Partial<SessionItem> = {}): SessionItem => ({
  id,
  child: { id: 'c1', name: 'Mia' },
  caregiverName: 'Ms. Jess',
  parentTitle: 'Mom',
  reason: 'upset_nap',
  startedAt: new Date(2026, 10, 18, 11, 20).getTime(),
  durationS: 240,
  moodAfter: 'calmer',
  summary: 'You sang Twinkle Twinkle together.',
  moodSignal: null,
  flags: [],
  ...over,
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function mount(ui: ReactNode, path: string, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={ui} />
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

describe('SessionCard', () => {
  it('shows "felt better" for a calmer check-in, with the mood pill', () => {
    render(<SessionCard s={item('s1')} />);
    expect(screen.getByText('Mia felt better 💛')).toBeInTheDocument();
    expect(screen.getByLabelText('Felt upset at nap, then calmer')).toHaveTextContent('😴 → 😊');
  });

  it('shows the pending state, with a shimmer, when there is no summary yet', () => {
    const { container } = render(<SessionCard s={item('s1', { summary: null, moodAfter: null, startedAt: Date.now() - 60_000 })} />);
    expect(screen.getByText('Writing your summary…')).toBeInTheDocument();
    expect(container.querySelector('.et-skeleton')).not.toBeNull();
    expect(screen.getByText('Mia had a comfort call 💛')).toBeInTheDocument();
  });

  it('shows the facts: time, length, reason and caregiver, and the summary', () => {
    render(<SessionCard s={item('s1')} />);
    expect(screen.getByText(/4 min/)).toBeInTheDocument();
    expect(screen.getByText(/Upset at nap/)).toBeInTheDocument();
    expect(screen.getByText(/with Ms\. Jess/)).toBeInTheDocument();
    expect(screen.getByText(/Twinkle Twinkle/)).toBeInTheDocument();
  });

  it("uses the session's own parent title: Mia's call with Daddy's avatar says Daddy, even when Mom is viewing", () => {
    render(<SessionCard s={item('s1', { parentTitle: 'Daddy', reason: 'missing_parent' })} />);
    expect(screen.getByText(/Missing Daddy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Missing Mom/i)).toBeNull();
  });

  it('flags a session that has moments worth a look', () => {
    render(<SessionCard s={item('s1', { flags: [{ id: 'f1', category: 'injury', severity: 'low', quote: 'my knee' }] })} />);
    expect(screen.getByText(/A moment worth a look/)).toBeInTheDocument();
  });

  it('after 30 minutes a missing summary is final: no writing shimmer', () => {
    const old = item('s1', { summary: null, startedAt: Date.now() - 3 * 3600_000 });
    const { container } = render(<SessionCard s={old} />);
    expect(screen.queryByText('Writing your summary…')).toBeNull();
    expect(screen.getByText('No summary for this call')).toBeInTheDocument();
    expect(container.querySelector('.et-skeleton')).toBeNull();
  });

  it('a call that ended minutes ago still says it is writing', () => {
    render(<SessionCard s={item('s1', { summary: null, startedAt: Date.now() - 5 * 60_000, durationS: 120 })} />);
    expect(screen.getByText('Writing your summary…')).toBeInTheDocument();
  });

  it('is a button when it can be opened', async () => {
    const onClick = vi.fn();
    render(<SessionCard s={item('s1')} onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('session copy', () => {
  const t = (over: Partial<SessionItem>) => sessionTitle(item('x', over), 'Mia');
  it('titles from the check-in mood', () => {
    expect(t({ moodAfter: 'calmer' })).toBe('Mia felt better 💛');
    expect(t({ moodAfter: 'same' })).toBe("Mia's still a little sad");
    expect(t({ moodAfter: 'upset' })).toBe('Mia had a hard time');
  });
  it('uses mood_signal only when there is no check-in', () => {
    expect(t({ moodAfter: null, moodSignal: 'better' })).toBe('Mia felt better 💛');
    expect(t({ moodAfter: null, moodSignal: 'same' })).toBe("Mia's still a little sad");
    expect(t({ moodAfter: null, moodSignal: 'worse' })).toBe('Mia had a hard time');
    // the check-in wins over the model's guess
    expect(t({ moodAfter: 'same', moodSignal: 'better' })).toBe("Mia's still a little sad");
  });
  it('has a neutral title when there is no mood at all', () => {
    expect(t({ moodAfter: null, moodSignal: 'unclear' })).toBe('Mia had a comfort call 💛');
    expect(t({ moodAfter: null, moodSignal: null })).toBe('Mia had a comfort call 💛');
  });
  it('maps the reason to the mood before and the check-in to the mood after', () => {
    expect(moodPill(item('x', { reason: 'missing_parent', moodAfter: 'calmer' }), 'Mom')?.text).toBe('🥺 → 😊');
    expect(moodPill(item('x', { reason: 'new_nervous', moodAfter: 'same' }), 'Mom')?.text).toBe('😟 → 😐');
    expect(moodPill(item('x', { reason: 'boo_boo', moodAfter: 'upset' }), 'Mom')?.text).toBe('🤕 → 😢');
    expect(moodPill(item('x', { reason: 'missing_parent', moodAfter: 'calmer' }), 'Mom')?.label).toBe('Felt sad missing Mom, then calmer');
  });
  it('shows only the after mood when the reason is unknown, and nothing without a check-in', () => {
    expect(moodPill(item('x', { reason: null, moodAfter: 'calmer' }), 'Mom')?.text).toBe('😊');
    expect(moodPill(item('x', { moodAfter: null }), 'Mom')).toBeNull();
  });
});

describe('dates and pending boundary', () => {
  it('shows the year only for dates outside the current year', () => {
    const now = new Date(2026, 10, 18);
    expect(dayLabel(new Date(2026, 0, 5).getTime(), now)).toBe('Mon, Jan 5');
    expect(dayLabel(new Date(2025, 10, 17).getTime(), now)).toBe('Mon, Nov 17, 2025');
  });
  it('summaryPending flips at 30 minutes after the call ended', () => {
    const base = { summary: null, startedAt: 0, durationS: 60 };
    expect(summaryPending(base, 60_000 + 29 * 60_000)).toBe(true);
    expect(summaryPending(base, 60_000 + 31 * 60_000)).toBe(false);
    expect(summaryPending({ ...base, summary: 'x' }, 0)).toBe(false);
  });
});

describe('groupByDay', () => {
  const now = new Date(2026, 10, 18, 0, 30); // Wed Nov 18, just past midnight

  it('labels Today, Yesterday and the weekday plus date', () => {
    expect(dayLabel(new Date(2026, 10, 18, 0, 5).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 17, 23, 55).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 16, 9, 0).getTime(), now)).toBe('Mon, Nov 16');
  });

  it('splits sessions either side of midnight into different groups', () => {
    const items = [
      item('a', { startedAt: new Date(2026, 10, 18, 0, 10).getTime() }),
      item('b', { startedAt: new Date(2026, 10, 17, 23, 50).getTime() }),
      item('c', { startedAt: new Date(2026, 10, 17, 8, 0).getTime() }),
      item('d', { startedAt: new Date(2026, 10, 16, 8, 0).getTime() }),
    ];
    const groups = groupByDay(items, now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Mon, Nov 16']);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('crosses a month boundary correctly for Yesterday', () => {
    const first = new Date(2026, 11, 1, 10, 0);
    expect(dayLabel(new Date(2026, 10, 30, 22, 0).getTime(), first)).toBe('Yesterday');
  });
});

// ---- SessionsTab ---------------------------------------------------------------------------------------------

type Io = { cb: IntersectionObserverCallback; el?: Element };
let observers: Io[] = [];
class FakeIO {
  io: Io;
  constructor(cb: IntersectionObserverCallback) {
    this.io = { cb };
    observers.push(this.io);
  }
  observe(el: Element) {
    this.io.el = el;
  }
  disconnect() {
    observers = observers.filter((o) => o !== this.io);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const intersect = () =>
  act(() => {
    for (const o of [...observers]) o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], {} as IntersectionObserver);
  });

function stubApi(pages: Record<string, { items: SessionItem[]; nextCursor: string | null }>, extra: (u: string) => unknown = () => undefined) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    const e = extra(u);
    if (e !== undefined) return json(e);
    if (u.includes('/children')) return json({ children: [mia] });
    if (u.includes('/avatars/mine')) return json([]);
    if (u.includes('/alerts')) return json({ items: [] });
    if (u.includes('/sessions')) {
      const cursor = new URL(u, 'http://x').searchParams.get('cursor') ?? '';
      return json(pages[cursor] ?? { items: [], nextCursor: null });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sessionCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => /\/sessions\?/.test(String(c[0])));

describe('SessionsTab', () => {
  const now = new Date(2026, 10, 18, 15, 0);
  const tab = () => mount(<SessionsTab now={now} />, '/parent/sessions', '/parent/sessions');

  beforeEach(() => {
    observers = [];
    vi.stubGlobal('IntersectionObserver', FakeIO);
  });

  it('groups the feed under Today and Yesterday', async () => {
    stubApi({
      '': {
        items: [
          item('a', { startedAt: new Date(2026, 10, 18, 11, 20).getTime() }),
          item('b', { startedAt: new Date(2026, 10, 17, 9, 0).getTime(), moodAfter: 'upset' }),
        ],
        nextCursor: null,
      },
    });
    tab();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Mia had a hard time')).toBeInTheDocument();
  });

  it('opens a session when its card is tapped', async () => {
    stubApi({ '': { items: [item('a')], nextCursor: null } });
    const user = userEvent.setup();
    tab();
    await user.click(await screen.findByRole('button', { name: /Mia felt better/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/sessions/a');
  });

  it('shows the empty state when there are no sessions', async () => {
    stubApi({ '': { items: [], nextCursor: null } });
    tab();
    expect(await screen.findByText('No comfort calls yet')).toBeInTheDocument();
  });

  it('infinite scroll appends the next page and never repeats a session', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => item(`p1-${i}`, { startedAt: new Date(2026, 10, 18, 10 - i).getTime() }));
    // the second page overlaps the first by one (a session finishing between requests)
    const page2 = [page1[2]!, item('p2-0', { startedAt: new Date(2026, 10, 17, 9).getTime() })];
    const f = stubApi({ '': { items: page1, nextCursor: 'c2' }, c2: { items: page2, nextCursor: null } });
    tab();
    await screen.findByRole('heading', { name: 'Today' });
    expect(screen.getAllByText('Mia felt better 💛')).toHaveLength(3);

    intersect();
    await screen.findByRole('heading', { name: 'Yesterday' });
    expect(screen.getAllByText('Mia felt better 💛')).toHaveLength(4); // 3 + 1 new, the overlap shown once
    expect(sessionCalls(f).some((c) => String(c[0]).includes('cursor=c2'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('has a "Load more" fallback button', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const f = stubApi({ '': { items: [item('a')], nextCursor: 'c2' }, c2: { items: [item('b', { startedAt: new Date(2026, 10, 16, 9).getTime() })], nextCursor: null } });
    const user = userEvent.setup();
    tab();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('heading', { name: 'Mon, Nov 16' });
    expect(sessionCalls(f)).toHaveLength(2);
  });

  it('refreshes when pulled down from the top', async () => {
    const f = stubApi({ '': { items: [item('a')], nextCursor: null } });
    tab();
    await screen.findByText('Mia felt better 💛');
    const before = sessionCalls(f).length;
    const zone = screen.getByTestId('pull-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 260 }] });
    fireEvent.touchEnd(zone);
    await waitFor(() => expect(sessionCalls(f).length).toBeGreaterThan(before));
  });

  it('a cancelled touch resets without refreshing', async () => {
    const f = stubApi({ '': { items: [item('a')], nextCursor: null } });
    tab();
    await screen.findByText('Mia felt better 💛');
    const before = sessionCalls(f).length;
    const zone = screen.getByTestId('pull-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchCancel(zone);
    await new Promise((r) => setTimeout(r, 30));
    expect(sessionCalls(f).length).toBe(before);
  });

  it('keeps the loaded sessions when a refresh fails', async () => {
    let fail = false;
    const f = stubApi({ '': { items: [item('a')], nextCursor: null } });
    const base = f.getMockImplementation()!;
    f.mockImplementation(async (u: string) => (fail && /\/sessions\?/.test(String(u)) ? json({ error: { code: 'INTERNAL', message: 'x' } }, 500) : base(u)));
    tab();
    await screen.findByText('Mia felt better 💛');
    fail = true;
    const zone = screen.getByTestId('pull-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 260 }] });
    fireEvent.touchEnd(zone);
    await waitFor(() => expect(sessionCalls(f).length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Mia felt better 💛')).toBeInTheDocument();
  });

  it('day sections are named without breaking on spaces', async () => {
    stubApi({ '': { items: [item('a', { startedAt: new Date(2026, 10, 16, 9).getTime() })], nextCursor: null } });
    tab();
    const region = await screen.findByRole('region', { name: 'Mon, Nov 16' });
    expect(within(region).getByText('Mia felt better 💛')).toBeInTheDocument();
  });

  it('does not refresh on a short pull', async () => {
    const f = stubApi({ '': { items: [item('a')], nextCursor: null } });
    tab();
    await screen.findByText('Mia felt better 💛');
    const before = sessionCalls(f).length;
    const zone = screen.getByTestId('pull-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 120 }] });
    fireEvent.touchEnd(zone);
    await new Promise((r) => setTimeout(r, 30));
    expect(sessionCalls(f).length).toBe(before);
  });

  it("shows each session's own parent title, not the viewer's avatar title (Mom viewing Mia's call with Daddy)", async () => {
    stubApi(
      { '': { items: [item('d1', { parentTitle: 'Daddy', reason: 'missing_parent' })], nextCursor: null } },
      (u) => (u.includes('/avatars/mine') ? [{ id: 'av-mom', parentTitle: 'Mommy', status: 'approved' }] : undefined),
    );
    tab();
    expect(await screen.findByText(/Missing Daddy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Missing Mommy/i)).toBeNull();
  });

  it('lets the parent switch child', async () => {
    const leo = { ...mia, id: 'c2', name: 'Leo' };
    const f = stubApi({ '': { items: [item('a')], nextCursor: null } }, (u) => (u.includes('/children') ? { children: [mia, leo] } : undefined));
    const user = userEvent.setup();
    tab();
    await user.click(await screen.findByRole('button', { name: 'Leo' }));
    await waitFor(() => expect(sessionCalls(f).some((c) => String(c[0]).includes('childId=c2'))).toBe(true));
  });
});

// ---- SessionDetail -------------------------------------------------------------------------------------------

describe('SessionDetail', () => {
  const flag = { id: 'f1', category: 'injury', severity: 'medium', quote: 'my knee hurts from the slide' } as const;
  const transcript = [
    // The server sends epoch ms (it normalizes Napster's unix seconds, device test P-2).
    { role: 'Assistant', text: 'Hey Sunshine! Is Bunny sleepy too?', timestamp: new Date(2026, 10, 18, 11, 20, 5).getTime() },
    { role: 'User', text: 'I miss you mommy', timestamp: new Date(2026, 10, 18, 11, 20, 20).getTime() },
  ];
  const detail = (over: Record<string, unknown> = {}) => ({ ...item('s1', { flags: [flag] }), caregiverNote: 'She ate a good snack first.', transcript, ...over });
  const open = (body: unknown) => {
    stubApi({}, (u) => (/\/sessions\/s1/.test(u) ? body : undefined));
    return mount(<SessionDetail />, '/parent/sessions/s1', '/parent/sessions/:id');
  };

  it('shows flags first with the quote, then the note, the summary, the facts and the conversation', async () => {
    open(detail());
    const flagCard = await screen.findByTestId('flag-card');
    expect(flagCard).toHaveTextContent('my knee hurts from the slide');
    const note = screen.getByText('She ate a good snack first.');
    const summary = screen.getByText(/Twinkle Twinkle/);
    const convo = screen.getByRole('heading', { name: 'Conversation' });
    const order = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(flagCard, note)).toBe(true);
    expect(order(note, summary)).toBe(true);
    expect(order(summary, convo)).toBe(true);
    const facts = screen.getByTestId('facts');
    expect(facts).toHaveTextContent('4 min');
    expect(facts).toHaveTextContent('Ms. Jess');
    expect(order(summary, facts)).toBe(true);
    expect(order(facts, convo)).toBe(true);
  });

  it("names the session's own parent (Daddy) in the facts and the transcript, whoever is viewing", async () => {
    stubApi({}, (u) => {
      if (/\/sessions\/s1/.test(u)) return detail({ parentTitle: 'Daddy', reason: 'missing_parent' });
      if (u.includes('/avatars/mine')) return [{ id: 'av-mom', parentTitle: 'Mommy', status: 'approved' }];
      return undefined;
    });
    mount(<SessionDetail />, '/parent/sessions/s1', '/parent/sessions/:id');
    expect(await screen.findByTestId('facts')).toHaveTextContent(/Missing Daddy/i);
    expect(screen.getAllByText("Daddy's avatar said:", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Mommy's avatar/)).toBeNull();
  });

  it("a live or post flag quotes the child's words; a manual flag is the caregiver's note, never the child's", async () => {
    open(
      detail({
        flags: [
          { id: 'f1', source: 'live', category: 'injury', severity: 'low', quote: 'my knee hurts' },
          { id: 'f2', source: 'manual', category: 'other', severity: 'low', quote: 'Seemed tired after lunch' },
          { id: 'f3', source: 'post', category: 'illness', severity: 'low', quote: 'my tummy' },
        ],
      }),
    );
    const cards = await screen.findAllByTestId('flag-card');
    expect(cards[0]).toHaveTextContent('Mia said: “my knee hurts”');
    expect(cards[1]).toHaveTextContent('Ms. Jess noted: “Seemed tired after lunch”');
    expect(cards[1]).not.toHaveTextContent('Mia said');
    expect(cards[2]).toHaveTextContent('Mia said: “my tummy”');
  });

  it('a manual flag without a caregiver name reads "Your caregiver noted"', async () => {
    open(detail({ caregiverName: '', flags: [{ id: 'f2', source: 'manual', category: 'other', severity: 'low', quote: 'Tired' }] }));
    expect(await screen.findByTestId('flag-card')).toHaveTextContent('Your caregiver noted: “Tired”');
  });

  it('shows the transcript as chat bubbles: avatar on the left, child on the right, with times', async () => {
    open(detail());
    const av = await screen.findByText('Hey Sunshine! Is Bunny sleepy too?');
    const kid = screen.getByText('I miss you mommy');
    expect(av.closest('[data-side]')).toHaveAttribute('data-side', 'left');
    expect(kid.closest('[data-side]')).toHaveAttribute('data-side', 'right');
    expect(screen.getAllByText('11:20am').length).toBeGreaterThan(0);
  });

  it('formats the epoch-ms times of a real call, never a 1970 time (P-2)', async () => {
    // A real Napster item (unix seconds 1795135636) as the API now returns it: epoch ms.
    const ms = 1795135636_000;
    open(detail({ transcript: [{ role: 'Assistant', text: 'Hello, sweet pea.', timestamp: ms }] }));
    await screen.findByText('Hello, sweet pea.');
    const want = new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
    expect(screen.getByText(want)).toBeInTheDocument();
    const wrong = new Date(1795135636).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
    if (wrong !== want) expect(screen.queryByText(wrong)).toBeNull();
  });

  it('a line without a usable time shows no time label', async () => {
    open(detail({ transcript: [{ role: 'User', text: 'no clock here', timestamp: null }] }));
    const li = (await screen.findByText('no clock here')).closest('li')!;
    expect(li).not.toHaveTextContent(/\d:\d\d[ap]m/);
  });

  it('never draws an empty "Mia said" bubble for an empty or whitespace-only turn (P-5)', async () => {
    const at = transcript[1]!.timestamp;
    open(detail({ transcript: [...transcript, { role: 'User', text: '', timestamp: at }, { role: 'Assistant', text: '  \n ', timestamp: at }] }));
    await screen.findByText('I miss you mommy');
    expect(within(screen.getByRole('list', { name: 'Conversation' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('a transcript of only empty turns reads as nothing saved', async () => {
    open(detail({ transcript: [{ role: 'User', text: ' ', timestamp: transcript[0]!.timestamp }] }));
    expect(await screen.findByText(/No conversation was saved/)).toBeInTheDocument();
  });

  it('without transcript access, shows the private card and no conversation', async () => {
    const { transcript: _t, ...noAccess } = detail();
    open(noAccess);
    expect(await screen.findByText("Full conversation is private to Mia's parents")).toBeInTheDocument();
    expect(screen.queryByText('I miss you mommy')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Conversation' })).toBeNull();
    // the summary is still there
    expect(screen.getByText(/Twinkle Twinkle/)).toBeInTheDocument();
  });

  it('never shows System lines, even if the server sent them', async () => {
    const withSystem = [{ role: 'System', text: 'secret tool call', timestamp: transcript[0]!.timestamp }, ...transcript];
    open(detail({ transcript: withSystem }));
    await screen.findByText('I miss you mommy');
    expect(screen.queryByText('secret tool call')).toBeNull();
  });

  it('a transcript of only System lines reads as nothing saved', async () => {
    open(detail({ transcript: [{ role: 'System', text: 'x', timestamp: transcript[0]!.timestamp }] }));
    expect(await screen.findByText(/No conversation was saved/)).toBeInTheDocument();
  });

  it('an old call with no summary says so gently, and points to the conversation', async () => {
    open(detail({ summary: null, startedAt: Date.now() - 5 * 3600_000 }));
    expect(await screen.findByText('No summary for this call')).toBeInTheDocument();
    expect(screen.getByText(/conversation is still below/)).toBeInTheDocument();
    expect(screen.queryByText('Writing your summary…')).toBeNull();
  });

  it('says so kindly when access is granted but nothing was recorded', async () => {
    open(detail({ transcript: null }));
    expect(await screen.findByText(/No conversation was saved/)).toBeInTheDocument();
  });

  it('shows the pending summary shimmer, and no flags section, when nothing has been written yet', async () => {
    const { container } = open(detail({ summary: null, flags: [], moodAfter: null, caregiverNote: null, startedAt: Date.now() - 60_000 }));
    expect(await screen.findByText('Writing your summary…')).toBeInTheDocument();
    expect(container.querySelector('.et-skeleton')).not.toBeNull();
    expect(screen.queryByTestId('flag-card')).toBeNull();
  });

  it('shows a friendly error with retry when the session cannot be loaded', async () => {
    const f = vi.fn(async (url: string) => (String(url).includes('/sessions/s1') ? json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404) : json({})));
    vi.stubGlobal('fetch', f);
    mount(<SessionDetail />, '/parent/sessions/s1', '/parent/sessions/:id');
    expect(await screen.findByText(/couldn't find that/i)).toBeInTheDocument();
  });

  it('goes back to the feed with the back button', async () => {
    open(detail());
    await screen.findByTestId('facts');
    await userEvent.setup().click(within(document.body).getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/parent/sessions');
  });
});
