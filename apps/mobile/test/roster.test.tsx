import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MeResponse, RosterTile } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast } from '../src/ui';
import { Roster } from '../src/features/caregiver/Roster';
import { callLengthLabel, CheckIn } from '../src/features/caregiver/CheckIn';
import { CaregiverSession } from '../src/features/caregiver/CaregiverSession';
import { SharedTabletPrompt } from '../src/features/caregiver/SharedTabletPrompt';
import { resetSwitchPrompt, switchPrompt } from '../src/lib/switchPrompt';
import { rememberCall } from '../src/features/caregiver/pendingCall';
import { SessionProvider } from '../src/shell/SessionContext';
import { setTokenGetter } from '../src/lib/api';
import { clearActingToken, clearDevice, clearSessionStorage, getActingToken, getDevice, setActingToken, setDevice } from '../src/lib/storage';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const err = (code: string, status: number) => json({ error: { code, message: code } }, status);

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: any;
}
let calls: Call[] = [];
type Handler = (c: Call) => Response | undefined;

/** Routes are tried in order; the first that returns a Response wins. Anything else is `{}`. */
function stub(...handlers: Handler[]) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c: Call = { url: String(url), method: (init.method ?? 'GET').toUpperCase(), headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      for (const h of handlers) {
        const r = h(c);
        if (r) return r;
      }
      return json({});
    }),
  );
}
const on = (method: string, re: RegExp, body: unknown | ((c: Call) => Response), status = 200): Handler => (c) =>
  c.method === method && re.test(c.url) ? (typeof body === 'function' ? (body as (c: Call) => Response)(c) : json(body, status)) : undefined;

const tile = (over: Partial<RosterTile> & { name: string }): RosterTile => ({
  enrollmentId: `e-${over.name}`,
  childId: `c-${over.name}`,
  status: 'ready',
  readyAvatars: [{ avatarId: `a-${over.name}`, parentTitle: 'Mommy', parentName: 'Sarah' }],
  ...over,
});
const MIA = tile({ name: 'Mia' });
const LEO = tile({
  name: 'Leo',
  readyAvatars: [
    { avatarId: 'a-leo-1', parentTitle: 'Mommy', parentName: 'Sarah' },
    { avatarId: 'a-leo-2', parentTitle: 'Daddy', parentName: 'Dan' },
  ],
});
const NOAH = tile({ name: 'Noah', status: 'setup_pending', readyAvatars: [] });
const ISLA = tile({ name: 'Isla', status: 'invite_sent', childId: undefined, readyAvatars: [] });

const teacherMe = (over: Partial<MeResponse['roles']> = {}): MeResponse => ({
  user: { id: 'u1', name: 'Tablet Account', email: 't@x.com', isDemo: false },
  roles: { parent: false, adminOrgs: [], teacherOrgs: [{ id: 'org1', name: 'Little Acorns' }], homeCaregiverFamilies: [], ...over },
});
const nannyMe = (): MeResponse => ({
  user: { id: 'n1', name: 'Nora Nanny', email: 'n@x.com', isDemo: false },
  roles: { parent: false, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [{ id: 'f1', label: 'Kim family' }] },
});

const ROOMS = [
  { id: 'cl1', orgId: 'org1', name: 'Butterflies', emoji: null, assetKey: 'classroom.butterflies' },
  { id: 'cl2', orgId: 'org1', name: 'Bees', emoji: '🐝', assetKey: null },
];

function Where() {
  const l = useLocation();
  return (
    <div>
      <output data-testid="where">{l.pathname}</output>
      <output data-testid="state">{JSON.stringify(l.state ?? null)}</output>
    </div>
  );
}

function mount(m: MeResponse, path = '/caregiver', prompt = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider me={m}>
          <Routes>
            <Route path="/caregiver" element={<Roster />} />
            <Route path="/caregiver/done" element={<CaregiverSession />} />
            <Route path="*" element={<Where />} />
          </Routes>
          {prompt ? <SharedTabletPrompt /> : null}
        </SessionProvider>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

const TABLET = { orgId: 'org1', deviceId: 'dev1' };
const TABLE_ = () => TABLET;
const A_ = () => ({ avatarId: 'a1', parentTitle: 'Mommy', parentName: 'Sarah' });
const rosterOf = (...tiles: RosterTile[]) => on('GET', /\/orgs\/org1\/roster/, { tiles });
const roomsOf = (...rooms: unknown[]) => on('GET', /\/orgs\/org1\/my-classrooms/, { classrooms: rooms });

const originalWidth = window.innerWidth;
beforeEach(async () => {
  toast.clear();
  resetSwitchPrompt();
  localStorage.clear();
  await clearDevice();
  await clearActingToken();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setTokenGetter(null);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

describe('Roster tiles', () => {
  it('a setup_pending tile is not startable and explains why; an invite_sent tile says who we are waiting for', { timeout: 20_000 }, async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA, NOAH, ISLA));
    const user = userEvent.setup();
    mount(teacherMe());
    // Generous waits: under a loaded parallel run the first render of the roster can take well over 1 s.
    await user.click(await screen.findByRole('button', { name: /Noah/ }, { timeout: 8000 }));
    expect(await screen.findByText("Noah's family is still setting up", undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Isla/ }));
    expect(await screen.findByText("Waiting for Isla's family to join", undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Noah/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the status badge with the parent titles', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA, LEO, NOAH));
    mount(teacherMe());
    expect(await screen.findByText('✨ Mommy ready')).toBeInTheDocument();
    expect(screen.getByText('✨ Mommy + Daddy')).toBeInTheDocument();
    expect(screen.getByText('⏳ Setup pending')).toBeInTheDocument();
  });

  it('a child with two ready avatars opens the AvatarPicker, then the ReasonSheet for the chosen parent', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(LEO));
    const user = userEvent.setup();
    mount(teacherMe());
    await user.click(await screen.findByRole('button', { name: /Leo/ }));
    const picker = await screen.findByRole('dialog', { name: /Who should Leo talk to/ });
    expect(within(picker).getByRole('button', { name: 'Call Mommy' })).toBeInTheDocument();
    // The heart and the words are separated by a space (device test M-6).
    expect(within(picker).getByRole('button', { name: 'Call Mommy' }).textContent).toBe('💛 Call Mommy');
    await user.click(within(picker).getByRole('button', { name: 'Call Daddy' }));
    expect(await screen.findByRole('dialog', { name: /What's going on with Leo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "💛 Call Daddy's avatar" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Missing Daddy/ })).toBeInTheDocument();
  });

  it('one ready avatar goes straight to the ReasonSheet; the call opens /live/child with the route state', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA));
    const user = userEvent.setup();
    setActingToken({ token: 'tok', expiresAt: Date.now() + 3_600_000, teacherUserId: 't1', teacherName: 'Ms. Jess' });
    await setDevice(TABLET);
    mount(teacherMe());
    await user.click(await screen.findByRole('button', { name: /Mia/ }));
    const sheet = await screen.findByRole('dialog', { name: /What's going on with Mia/ });
    expect(screen.queryByRole('dialog', { name: /Who should/ })).toBeNull();
    for (const label of ['Missing Mommy', 'Upset at nap', 'New & nervous', 'Got a boo-boo']) expect(within(sheet).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /Upset at nap/ }));
    await user.click(within(sheet).getByRole('button', { name: "💛 Call Mommy's avatar" }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/live/child');
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toMatchObject({
      avatarId: 'a-Mia',
      childId: 'c-Mia',
      reason: 'upset_nap',
      childName: 'Mia',
      caregiverName: 'Ms. Jess',
      parentTitle: 'Mommy',
      returnTo: '/caregiver/done',
    });
  });

  it('shows the empty state when the classroom has no children', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf());
    mount(teacherMe());
    expect(await screen.findByText(/No little ones here yet/)).toBeInTheDocument();
  });
});

describe('Roster header and classrooms', () => {
  it('a single classroom shows its name, the org and no selector', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA));
    mount(teacherMe());
    expect(await screen.findByRole('heading', { name: 'Butterflies' })).toBeInTheDocument();
    expect(screen.getByText(/Little Acorns/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('with more than one classroom a selector appears and picking one refetches that roster', async () => {
    stub(roomsOf(...ROOMS), (c) => (/classroomId=cl2/.test(c.url) ? json({ tiles: [tile({ name: 'Bea' })] }) : undefined), rosterOf(MIA));
    const user = userEvent.setup();
    mount(teacherMe());
    expect(await screen.findByRole('button', { name: /Mia/ })).toBeInTheDocument();
    expect(calls.some((c) => /roster\?classroomId=cl1/.test(c.url))).toBe(true);
    await user.click(screen.getByRole('tab', { name: /Bees/ }));
    expect(await screen.findByRole('button', { name: /Bea/ })).toBeInTheDocument();
  });

  it('the Switch chip appears only on a registered device', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA));
    const first = mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    first.unmount();
    await setDevice(TABLET);
    setActingToken({ token: 'tok', expiresAt: Date.now() + 3_600_000, teacherUserId: 't1', teacherName: 'Ms. Jess' });
    mount(teacherMe());
    expect(await screen.findByRole('button', { name: /Ms\. Jess/ })).toHaveTextContent('Ms. Jess · Switch');
  });

  it('the nanny view reads /caregiver/children, says "<Child> & friends" and has no switch chip', async () => {
    stub(on('GET', /\/caregiver\/children/, { children: [{ id: 'c1', name: 'Leo', readyAvatars: [{ avatarId: 'a1', parentTitle: 'Mommy', parentName: 'Sarah' }], familyLabel: 'Kim family' }] }));
    const user = userEvent.setup();
    mount(nannyMe());
    expect(await screen.findByRole('heading', { name: 'Leo & friends' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    expect(calls.some((c) => /\/orgs\//.test(c.url))).toBe(false);
    await user.click(screen.getByRole('button', { name: /Leo/ }));
    expect(await screen.findByRole('dialog', { name: /What's going on with Leo/ })).toBeInTheDocument();
  });
});

describe('SwitchTeacher', () => {
  const STAFF = [
    { userId: 't1', name: 'Ms. Jess', hasPin: true },
    { userId: 't2', name: 'Mr. Sam', hasPin: false },
  ];
  async function openPin() {
    await setDevice(TABLET);
    const user = userEvent.setup();
    mount(teacherMe());
    // a registered tablet with nobody teaching asks straight away
    await screen.findByRole('dialog', { name: /Who's teaching/ });
    await user.click(await screen.findByRole('button', { name: /Ms\. Jess/ }));
    return user;
  }
  const pin = async (user: ReturnType<typeof userEvent.setup>, digits: string) => {
    for (const d of digits) await user.click(screen.getByRole('button', { name: d }));
  };

  it('a correct PIN stores the acting token, greets the teacher and refetches the roster as them', async () => {
    stub(
      roomsOf(ROOMS[0]),
      on('GET', /staff\/switch/, { staff: STAFF }),
      on('POST', /\/orgs\/org1\/acting/, { actingToken: 'act-123', expiresAt: Date.now() + 12 * 3_600_000 }),
      rosterOf(MIA),
    );
    const user = await openPin();
    const before = calls.filter((c) => /roster/.test(c.url)).length;
    await pin(user, '1234');
    expect(await screen.findByText('Hi Ms. Jess 👋')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && /acting/.test(c.url))!;
    expect(post.body).toEqual({ deviceId: 'dev1', teacherUserId: 't1', pin: '1234' });
    expect((await getActingToken())?.token).toBe('act-123');
    await waitFor(() => expect(calls.filter((c) => /roster/.test(c.url)).length).toBeGreaterThan(before));
    expect(calls.filter((c) => /roster/.test(c.url)).at(-1)!.headers.get('X-Acting-Token')).toBe('act-123');
    expect(await screen.findByRole('button', { name: /Ms\. Jess · Switch/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('on a short landscape screen (863x360) the PIN step switches to a compact two-column layout with every key reachable', async () => {
    const h = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 863 });
    try {
      stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), on('POST', /acting/, () => err('FORBIDDEN', 403)), rosterOf(MIA));
      const user = await openPin();
      const dialog = screen.getByRole('dialog', { name: /Ms\. Jess, enter your PIN/ });
      const compact = dialog.querySelector('[data-layout="compact"]');
      expect(compact).not.toBeNull();
      // Both columns live in the scrollable body: the keypad and "Pick someone else" side by side, no footer needed.
      for (const k of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Delete']) {
        const key = within(dialog).getByRole('button', { name: k });
        expect(compact!.contains(key)).toBe(true);
        expect(key.className).toMatch(/h-\[48px\]/);
      }
      expect(compact!.contains(within(dialog).getByRole('button', { name: 'Pick someone else' }))).toBe(true);
      await pin(user, '1234');
      expect(calls.some((c) => c.method === 'POST' && /acting/.test(c.url))).toBe(true);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    }
  });

  it('on a tall screen the PIN step keeps the stacked layout with the big keys', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), rosterOf(MIA));
    await openPin();
    const dialog = screen.getByRole('dialog', { name: /Ms\. Jess, enter your PIN/ });
    expect(dialog.querySelector('[data-layout="compact"]')).toBeNull();
    expect(within(dialog).getByRole('button', { name: '5' }).className).toMatch(/h-\[72px\]/);
  });

  it('a wrong PIN keeps you on the pad with a gentle message and no token', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), on('POST', /acting/, () => err('FORBIDDEN', 403)), rosterOf(MIA));
    const user = await openPin();
    await pin(user, '9999');
    expect(await screen.findByText(/didn't match/)).toBeInTheDocument();
    expect(await getActingToken()).toBeNull();
    expect(screen.getByRole('img', { name: /0 of 4 digits/ })).toBeInTheDocument();
  });

  it('PIN_LOCKED shows the breather message and stops accepting digits', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), on('POST', /acting/, () => err('PIN_LOCKED', 429)), rosterOf(MIA));
    const user = await openPin();
    await pin(user, '1111');
    expect(await screen.findByText('Too many tries — take a breather and try again in a few minutes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled();
  });

  it('a teacher without a PIN cannot be picked', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), rosterOf(MIA));
    await setDevice(TABLET);
    const user = userEvent.setup();
    mount(teacherMe());
    await screen.findByRole('dialog', { name: /Who's teaching/ });
    const sam = await screen.findByRole('button', { name: /Mr\. Sam/ });
    expect(sam).toBeDisabled();
    expect(sam).toHaveTextContent(/No PIN yet/);
  });

  it('End shift clears the acting token', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), rosterOf(MIA));
    await setDevice(TABLET);
    await setActingToken({ token: 'tok', expiresAt: Date.now() + 3_600_000, teacherUserId: 't1', teacherName: 'Ms. Jess' });
    const user = userEvent.setup();
    mount(teacherMe());
    await user.click(await screen.findByRole('button', { name: /Ms\. Jess · Switch/ }));
    await user.click(await screen.findByRole('button', { name: 'End shift' }));
    await waitFor(async () => expect(await getActingToken()).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: /Who's teaching/ })).toBeInTheDocument();
  });

  it('an expired acting token is dropped and the tablet asks you to switch again', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: STAFF }), rosterOf(MIA));
    await setDevice(TABLET);
    await setActingToken({ token: 'old', expiresAt: Date.now() - 1000, teacherUserId: 't1', teacherName: 'Ms. Jess' });
    mount(teacherMe());
    expect(await screen.findByRole('dialog', { name: /Who's teaching/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Who's teaching/, hidden: true })).toBeInTheDocument();
    expect(await getActingToken()).toBeNull();
  });
});

describe('CheckIn', () => {
  const props = { sessionId: 's1', childName: 'Mia', parentTitle: 'Mommy', parentName: 'Sarah' };

  it('says how long the call was, rounded sensibly (P-7)', () => {
    expect(callLengthLabel(118)).toBe('2 min');
    expect(callLengthLabel(90)).toBe('2 min');
    expect(callLengthLabel(89)).toBe('1 min');
    expect(callLengthLabel(60)).toBe('1 min');
    expect(callLengthLabel(59)).toBe('Under a minute');
    expect(callLengthLabel(0)).toBe('Under a minute');
    expect(callLengthLabel(undefined)).toBeNull();
    const { unmount } = render(<CheckIn {...props} durationS={42} onDone={() => {}} />);
    expect(screen.getByText("Under a minute with Mommy's avatar")).toBeInTheDocument();
    unmount();
    render(<CheckIn {...props} onDone={() => {}} />);
    expect(screen.getByText("A quick visit with Mommy's avatar")).toBeInTheDocument();
  });

  it('sends the mood and note, celebrates, then goes back', async () => {
    stub(on('POST', /sessions\/s1\/checkin/, { ok: true }));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<CheckIn {...props} onDone={onDone} />);
    expect(screen.getByRole('button', { name: /Send to Sarah/ })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Calmer/ }));
    await user.type(screen.getByLabelText(/Add a note for Sarah/), 'Went right down for nap!');
    await user.click(screen.getByRole('button', { name: 'Send to Sarah 💌' }));
    expect(await screen.findByText(/Sent to Sarah/)).toBeInTheDocument();
    expect(calls.find((c) => /checkin/.test(c.url))!.body).toEqual({ moodAfter: 'calmer', note: 'Went right down for nap!' });
    await user.click(screen.getByRole('button', { name: /Back to the classroom/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('on an API error it offers Retry and keeps the mood and note', async () => {
    let n = 0;
    stub(on('POST', /checkin/, () => (++n === 1 ? err('INTERNAL', 500) : json({ ok: true }))));
    const user = userEvent.setup();
    render(<CheckIn {...props} onDone={() => {}} />);
    await user.click(screen.getByRole('radio', { name: /Still upset/ }));
    await user.type(screen.getByLabelText(/Add a note/), 'Cried a bit');
    await user.click(screen.getByRole('button', { name: 'Send to Sarah 💌' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a note/)).toHaveValue('Cried a bit');
    expect(screen.getByRole('radio', { name: /Still upset/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Sent to Sarah/)).toBeInTheDocument();
    expect(calls.filter((c) => /checkin/.test(c.url)).map((c) => c.body)).toEqual([
      { moodAfter: 'upset', note: 'Cried a bit' },
      { moodAfter: 'upset', note: 'Cried a bit' },
    ]);
  });

  it('caps the note at 280 characters and omits an empty note', async () => {
    stub(on('POST', /checkin/, { ok: true }));
    const user = userEvent.setup();
    render(<CheckIn {...props} onDone={() => {}} />);
    expect(screen.getByLabelText(/Add a note/)).toHaveAttribute('maxlength', '280');
    await user.click(screen.getByRole('radio', { name: /Same/ }));
    await user.click(screen.getByRole('button', { name: 'Send to Sarah 💌' }));
    await screen.findByText(/Sent to Sarah/);
    expect(calls.find((c) => /checkin/.test(c.url))!.body).toEqual({ moodAfter: 'same' });
  });

  it('falls back to the parent title when the parent name is unknown', () => {
    render(<CheckIn {...props} parentName={undefined} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Send to Mommy 💌' })).toBeInTheDocument();
  });
});

describe('CaregiverSession (after the call)', () => {
  const remember = () => rememberCall({ childId: 'c1', childName: 'Mia', parentTitle: 'Mommy', parentName: 'Sarah', startedAt: Date.now() - 4 * 60_000 });

  it("shows the check-in when the call went live, with the call's own length (not the time since the tap, P-7)", async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(MIA));
    remember(); // tapped 4 minutes ago, but the call itself was 118 s
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[{ pathname: '/caregiver/done', state: { endedSessionId: 's9', endedDurationS: 118 } }]}>
          <Routes>
            <Route path="/caregiver/done" element={<CaregiverSession />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/How's Mia now/)).toBeInTheDocument();
    expect(screen.getByText("2 min with Mommy's avatar")).toBeInTheDocument();
  });

  it('skips the check-in when the call never went live: back to the roster with a gentle toast', async () => {
    remember();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[{ pathname: '/caregiver/done', state: { endedSessionId: undefined } }]}>
          <Routes>
            <Route path="/caregiver/done" element={<CaregiverSession />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
        <Toaster />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('where')).toHaveTextContent('/caregiver');
    expect(screen.queryByText(/How's Mia now/)).toBeNull();
    expect(await screen.findByText(/didn't connect/)).toBeInTheDocument();
  });
});

describe('SharedTabletPrompt', () => {
  it('asks once on a wide screen for staff with no registered device; Yes registers and remembers it', async () => {
    stub(on('POST', /\/orgs\/org1\/devices/, { deviceId: 'newdev' }), roomsOf(ROOMS[0]), rosterOf(MIA));
    const user = userEvent.setup();
    const first = mount(teacherMe(), '/parent', true);
    expect(await screen.findByRole('dialog', { name: 'Is this a shared classroom tablet?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Yes/ }));
    await waitFor(async () => expect(await getDevice()).toEqual({ orgId: 'org1', deviceId: 'newdev' }));
    first.unmount();
    // already registered: never asked again
    mount(teacherMe(), '/parent', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('No is remembered: the question is not asked again on this device', async () => {
    stub();
    const user = userEvent.setup();
    const first = mount(teacherMe(), '/parent', true);
    await user.click(await screen.findByRole('button', { name: /No/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await getDevice()).toBeNull();
    expect(calls.some((c) => /devices/.test(c.url))).toBe(false);
    first.unmount();
    mount(teacherMe(), '/parent', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not shown on a phone-sized screen, or to someone who is not staff', async () => {
    stub();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const phone = mount(teacherMe(), '/parent', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
    phone.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    mount(nannyMe(), '/parent', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});


const never = () => new Promise<Response>(() => {});

describe('roster identity (no stale children under a new teacher)', () => {
  const FUTURE = () => Date.now() + 3_600_000;
  const ROOM_OK = roomsOf(ROOMS[0]);
  // Jess ('tok') sees Mia; anyone else's roster never arrives, so anything on screen would be left over.
  const asJessOnly: Handler = (c) => (/\/roster/.test(c.url) ? (c.headers.get('X-Acting-Token') === 'tok' ? json({ tiles: [MIA] }) : (never() as unknown as Response)) : undefined);
  const jess = () => setActingToken({ token: 'tok', expiresAt: FUTURE(), teacherUserId: 't1', teacherName: 'Ms. Jess' });
  const STAFF = [
    { userId: 't1', name: 'Ms. Jess', hasPin: true },
    { userId: 't2', name: 'Mr. Sam', hasPin: true },
  ];

  it('switching teacher drops the previous roster and shows the skeleton until the new one arrives', async () => {
    stub(ROOM_OK, on('GET', /staff\/switch/, { staff: STAFF }), on('POST', /acting/, { actingToken: 'act-2', expiresAt: FUTURE() }), asJessOnly);
    await setDevice(TABLE_());
    await jess();
    const user = userEvent.setup();
    mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    await user.click(screen.getByRole('button', { name: /Ms\. Jess · Switch/ }));
    await user.click(await screen.findByRole('button', { name: /Mr\. Sam/ }));
    for (const d of '1234') await user.click(screen.getByRole('button', { name: d }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mia/ })).toBeNull());
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('End shift drops the roster too', async () => {
    stub(ROOM_OK, on('GET', /staff\/switch/, { staff: STAFF }), asJessOnly);
    await setDevice(TABLE_());
    await jess();
    const user = userEvent.setup();
    mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    await user.click(screen.getByRole('button', { name: /Ms\. Jess · Switch/ }));
    await user.click(await screen.findByRole('button', { name: 'End shift' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mia/, hidden: true })).toBeNull());
  });

  it('an expired shift drops the roster and asks who is teaching', async () => {
    stub(ROOM_OK, on('GET', /staff\/switch/, { staff: STAFF }), asJessOnly);
    await setDevice(TABLE_());
    await setActingToken({ token: 'tok', expiresAt: Date.now() + 700, teacherUserId: 't1', teacherName: 'Ms. Jess' });
    mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mia/, hidden: true })).toBeNull(), { timeout: 3000 });
    expect(await screen.findByRole('dialog', { name: /Who's teaching/ })).toBeInTheDocument();
  });
});

describe('tablet registration and prompts', () => {
  it('DEVICE_UNKNOWN is not a wrong PIN: says so, forgets the registration', async () => {
    const gone = () => json({ error: { code: 'DEVICE_UNKNOWN', message: 'gone' } }, 403);
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: [{ userId: 't1', name: 'Ms. Jess', hasPin: true }] }), on('POST', /acting/, gone), rosterOf(MIA));
    await setDevice(TABLE_());
    const user = userEvent.setup();
    mount(teacherMe());
    await screen.findByRole('dialog', { name: /Who's teaching/ });
    await user.click(await screen.findByRole('button', { name: /Ms\. Jess/ }));
    for (const d of '1234') await user.click(screen.getByRole('button', { name: d }));
    expect(await screen.findByText('This tablet needs to be set up again')).toBeInTheDocument();
    expect(screen.queryByText(/didn't match/)).toBeNull();
    await waitFor(async () => expect(await getDevice()).toBeNull());
    // the prompt flag and the in-memory teacher are reset with it
    expect(switchPrompt.shown).toBe(false);
    await waitFor(() => expect(screen.queryByText(/Ms\. Jess/)).toBeNull());
  });

  it('a staff list that answers DEVICE_UNKNOWN sends the tablet to set-up-again too', async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, () => json({ error: { code: 'DEVICE_UNKNOWN', message: 'gone' } }, 403)), rosterOf(MIA));
    await setDevice(TABLE_());
    mount(teacherMe());
    expect(await screen.findByText('This tablet needs to be set up again')).toBeInTheDocument();
    await waitFor(async () => expect(await getDevice()).toBeNull());
    expect(switchPrompt.shown).toBe(false);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull());
  });

  it('sign-out / account change (clearSessionStorage) resets the once-per-session prompt flag', async () => {
    switchPrompt.shown = true;
    await clearSessionStorage();
    expect(switchPrompt.shown).toBe(false);
  });

  it("Who's teaching? does not pop up by itself when nobody on the list has a PIN yet (the button still opens it)", async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: [{ userId: 't1', name: 'Ms. Jess', hasPin: false }] }), rosterOf(MIA));
    await setDevice(TABLE_());
    const user = userEvent.setup();
    mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    await waitFor(() => expect(calls.some((c) => /staff\/switch/.test(c.url))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Who's teaching/ }));
    expect(await screen.findByRole('dialog', { name: /Who's teaching/ })).toBeInTheDocument();
  });

  it("Who's teaching? opens once per session, not again when the roster remounts after a call", async () => {
    stub(roomsOf(ROOMS[0]), on('GET', /staff\/switch/, { staff: [{ userId: 't1', name: 'Ms. Jess', hasPin: true }] }), rosterOf(MIA));
    await setDevice(TABLE_());
    const user = userEvent.setup();
    const first = mount(teacherMe());
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();
    mount(teacherMe());
    await screen.findByRole('button', { name: /Mia/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a nanny of several families gets "<child> & friends", not one family label', async () => {
    const kid = (id: string, name: string, familyLabel: string) => ({ id, name, familyLabel, readyAvatars: [A_()] });
    stub(on('GET', /caregiver\/children/, { children: [kid('c1', 'Leo', 'Kim family'), kid('c2', 'Ivy', 'Park family')] }));
    mount(nannyMe());
    expect(await screen.findByRole('heading', { name: 'Leo & friends' })).toBeInTheDocument();
  });

  it('a disabled tile keeps readable text: only the photo is dimmed', async () => {
    stub(roomsOf(ROOMS[0]), rosterOf(NOAH));
    mount(teacherMe());
    const tileEl = await screen.findByRole('button', { name: /Noah/ });
    expect(tileEl.className).not.toMatch(/opacity/);
    expect(screen.getByText('⏳ Setup pending').className).not.toMatch(/opacity/);
  });
});
