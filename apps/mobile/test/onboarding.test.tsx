import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinPad } from '../src/features/onboarding/PinPad';
import { ageLabel, birthdayBounds, defaultTimezone, friendlyClerkError, friendlyZone, normalizeCode, passwordChecks } from '../src/features/onboarding/lib';
import { AuthOpsProvider, type AuthOps } from '../src/features/onboarding/authOps';
import { SignUp } from '../src/features/onboarding/SignUp';
import { SignIn } from '../src/features/onboarding/SignIn';
import { TryDemoSheet } from '../src/features/onboarding/TryDemoSheet';
import { TimezonePicker } from '../src/features/onboarding/TimezonePicker';
import { setTokenGetter } from '../src/lib/api';
import { getDevice, clearDevice } from '../src/lib/storage';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function fakeOps(over: Partial<AuthOps> = {}): AuthOps {
  return {
    signUp: vi.fn(async () => 'verify' as const),
    verifySignUp: vi.fn(async () => {}),
    resendSignUp: vi.fn(async () => {}),
    signIn: vi.fn(async () => 'complete' as const),
    verifySignIn: vi.fn(async () => {}),
    resendSignIn: vi.fn(async () => {}),
    sendReset: vi.fn(async () => {}),
    verifyReset: vi.fn(async () => {}),
    submitReset: vi.fn(async () => {}),
    ticketSignIn: vi.fn(async () => ({ getToken: async () => 'tok' })),
    ...over,
  };
}
const wrap = (ui: React.ReactNode, ops: AuthOps, at = '/onboarding/signup') => (
  <QueryClientProvider client={new QueryClient()}>
    <AuthOpsProvider value={ops}>
      <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
    </AuthOpsProvider>
  </QueryClientProvider>
);

describe('PinPad', () => {
  function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
    const [v, setV] = useState('');
    return (
      <>
        <PinPad value={v} onChange={setV} onComplete={onComplete} />
        <output data-testid="v">{v}</output>
      </>
    );
  }
  it('enters digits, caps at four, and reports completion', async () => {
    const done = vi.fn();
    const user = userEvent.setup();
    render(<Harness onComplete={done} />);
    for (const d of '12345') await user.click(screen.getByRole('button', { name: d }));
    expect(screen.getByTestId('v')).toHaveTextContent('1234');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('1234');
  });
  it('backspace removes the last digit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const d of '12') await user.click(screen.getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.getByTestId('v')).toHaveTextContent(/^1$/);
  });
  it('every key is big and the progress is announced', () => {
    render(<Harness />);
    expect(screen.getByRole('img', { name: /0 of 4 digits/i })).toBeInTheDocument();
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/h-\[(6|7|8)\dpx\]/);
  });
});

describe('helpers', () => {
  it('normalizeCode uppercases, filters to the invite alphabet and caps at 6', () => {
    expect(normalizeCode('abc-234 xyz')).toBe('ABC234');
    expect(normalizeCode('o0il1')).toBe('');
  });

  it('defaultTimezone reads the device zone and falls back safely', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { return { resolvedOptions: () => ({ timeZone: 'America/Chicago' }) }; } as never);
    expect(defaultTimezone()).toBe('America/Chicago');
    spy.mockImplementation(function () { return { resolvedOptions: () => ({ timeZone: '' }) }; } as never);
    expect(defaultTimezone()).toBe('America/New_York');
    spy.mockRestore();
  });

  it('friendlyZone names the US zones and prettifies the rest', () => {
    expect(friendlyZone('America/New_York')).toBe('Eastern Time');
    expect(friendlyZone('Pacific/Honolulu')).toBe('Hawaii Time');
    expect(friendlyZone('Asia/Kolkata')).toBe('Kolkata (Asia)');
  });

  describe('ageLabel', () => {
    const now = new Date(2026, 10, 18);
    it('years with a cake', () => expect(ageLabel('2023-05-02', now)).toBe('3 years old 🎂'));
    it('a birthday today counts', () => expect(ageLabel('2023-11-18', now)).toBe('3 years old 🎂'));
    it('the day before the birthday does not', () => expect(ageLabel('2023-11-19', now)).toBe('2 years old 🎂'));
    it('months under two years', () => expect(ageLabel('2025-09-01', now)).toBe('14 months old 🍼'));
    it('brand new', () => expect(ageLabel('2026-11-10', now)).toBe('Brand new! 👶'));
    it('future or invalid dates give nothing', () => {
      expect(ageLabel('2027-01-01', now)).toBeNull();
      expect(ageLabel('', now)).toBeNull();
      expect(ageLabel('2023-02-31', now)).toBeNull();
    });
  });

  describe('friendlyClerkError', () => {
    const e = (code: string, longMessage = 'RAW CLERK TEXT') => ({ errors: [{ code, message: 'raw', longMessage }] });
    it.each([
      ['form_identifier_exists', /already has an EverThere account/i, 'email'],
      ['form_password_pwned', /data breach/i, 'password'],
      ['form_password_length_too_short', /at least 8/i, 'password'],
      ['form_param_format_invalid', /email/i, 'email'],
      ['form_password_incorrect', /don.t match/i, 'password'],
      ['form_identifier_not_found', /don.t match/i, 'password'],
      ['form_code_incorrect', /code isn.t right/i, 'code'],
      ['verification_expired', /expired/i, 'code'],
      ['too_many_requests', /try again in a moment/i, undefined],
    ])('%s maps to friendly copy', (code, re, field) => {
      const r = friendlyClerkError(e(code as string));
      expect(r.message).toMatch(re as RegExp);
      expect(r.field).toBe(field);
    });
    it('never leaks raw Clerk text, even for unknown codes', () => {
      for (const err of [e('something_new'), new Error('RAW CLERK TEXT'), 'RAW CLERK TEXT', null, { message: 'RAW CLERK TEXT' }]) {
        expect(friendlyClerkError(err).message).not.toMatch(/RAW CLERK/);
      }
    });
    it('a dropped connection reads as an offline message', () => {
      expect(friendlyClerkError(new TypeError('Failed to fetch')).message).toMatch(/connection/i);
    });
  });

  it('passwordChecks tracks the 8-character rule', () => {
    expect(passwordChecks('abc').find((c) => c.id === 'length')!.ok).toBe(false);
    expect(passwordChecks('abcdefg1').find((c) => c.id === 'length')!.ok).toBe(true);
  });
});

describe('SignUp', () => {
  it('collects first name, last name, email and password, then shows the 6-box email code step', async () => {
    const ops = fakeOps();
    const user = userEvent.setup();
    render(wrap(<SignUp />, ops, '/onboarding/signup?door=parent'));
    await user.type(screen.getByLabelText(/first name/i), 'Dana');
    await user.type(screen.getByLabelText(/last name/i), 'Lee');
    await user.type(screen.getByLabelText(/^email/i), 'dana@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'sunny-days-1');
    await user.click(screen.getByRole('button', { name: /create my account/i }));
    expect(ops.signUp).toHaveBeenCalledWith({ firstName: 'Dana', lastName: 'Lee', email: 'dana@example.com', password: 'sunny-days-1' });
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    await user.click(screen.getAllByRole('textbox')[0]!);
    await user.paste('424242');
    await waitFor(() => expect(ops.verifySignUp).toHaveBeenCalledWith('424242'));
  });

  it('shows friendly copy for a Clerk error and never the raw text', async () => {
    const ops = fakeOps({
      signUp: vi.fn(async () => {
        throw { errors: [{ code: 'form_identifier_exists', longMessage: 'RAW CLERK TEXT' }] };
      }),
    });
    const user = userEvent.setup();
    render(wrap(<SignUp />, ops));
    await user.type(screen.getByLabelText(/first name/i), 'D');
    await user.type(screen.getByLabelText(/last name/i), 'L');
    await user.type(screen.getByLabelText(/^email/i), 'd@e.com');
    await user.type(screen.getByLabelText(/^password/i), 'sunny-days-1');
    await user.click(screen.getByRole('button', { name: /create my account/i }));
    expect(await screen.findByText(/already has an EverThere account/i)).toBeInTheDocument();
    expect(screen.queryByText(/RAW CLERK/)).toBeNull();
  });

  it('mounts the #clerk-captcha element inside the sign-up form (Clerk bot protection in custom flows)', () => {
    render(wrap(<SignUp />, fakeOps()));
    const el = document.getElementById('clerk-captcha');
    expect(el).not.toBeNull();
    expect(el!.closest('form#signup-form')).not.toBeNull();
  });

  it('offers to resume an unfinished sign-up (e.g. after the app was killed mid sign-up)', async () => {
    const ops = fakeOps({
      pendingSignUp: vi.fn(() => ({ email: 'dana@example.com' })),
      resumeSignUp: vi.fn(async () => 'verify' as const),
    });
    const user = userEvent.setup();
    render(wrap(<SignUp />, ops, '/onboarding/signup?door=parent'));
    expect(screen.getByText(/dana@example\.com/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /pick up where I left off/i }));
    expect(ops.resumeSignUp).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    await user.click(screen.getAllByRole('textbox')[0]!);
    await user.paste('424242');
    await waitFor(() => expect(ops.verifySignUp).toHaveBeenCalledWith('424242'));
    expect(ops.signUp).not.toHaveBeenCalled();
  });

  it('can dismiss the resume offer and start fresh', async () => {
    const ops = fakeOps({ pendingSignUp: vi.fn(() => ({ email: 'dana@example.com' })), resumeSignUp: vi.fn(async () => 'verify' as const) });
    const user = userEvent.setup();
    render(wrap(<SignUp />, ops));
    await user.click(screen.getByRole('button', { name: /start over/i }));
    expect(screen.queryByText(/dana@example\.com/)).toBeNull();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(ops.resumeSignUp).not.toHaveBeenCalled();
  });

  it('a Protect check error gets friendly copy', () => {
    for (const code of ['protect_check_required', 'protect_check_timed_out', 'protect_check_unsupported_environment']) {
      expect(friendlyClerkError({ errors: [{ code }] }).message).toMatch(/security check/i);
    }
  });

  it('keeps the button disabled while the password is too short', async () => {
    const user = userEvent.setup();
    render(wrap(<SignUp />, fakeOps()));
    await user.type(screen.getByLabelText(/^password/i), 'short');
    expect(screen.getAllByText(/at least 8 characters/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create my account/i })).toBeDisabled();
  });
});

describe('SignIn', () => {
  it('a new device goes to the email-code step (client trust)', async () => {
    const ops = fakeOps({ signIn: vi.fn(async () => 'verify' as const) });
    const user = userEvent.setup();
    render(wrap(<SignIn />, ops, '/onboarding/signin'));
    await user.type(screen.getByLabelText(/^email/i), 'dana@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'sunny-days-1');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    await user.click(screen.getAllByRole('textbox')[0]!);
    await user.paste('123456');
    await waitFor(() => expect(ops.verifySignIn).toHaveBeenCalledWith('123456'));
  });
});

describe('TryDemoSheet', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    setTokenGetter(null);
    await clearDevice();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [429, 'RATE_LIMITED'],
    [404, 'NOT_FOUND'],
  ])('HTTP %i shows the friendly "waking up" copy', async (status, code) => {
    fetchMock.mockResolvedValue(json({ error: { code, message: 'x' } }, status));
    const ops = fakeOps();
    const user = userEvent.setup();
    render(wrap(<TryDemoSheet open onClose={() => {}} />, ops));
    await user.click(screen.getByRole('button', { name: /peek as a parent/i }));
    expect(await screen.findByText(/The demo is waking up/i)).toBeInTheDocument();
    expect(ops.ticketSignIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('parent: gets a ticket and signs in with it', async () => {
    fetchMock.mockResolvedValue(json({ ticket: 'tkt_1' }));
    const ops = fakeOps();
    const user = userEvent.setup();
    render(wrap(<TryDemoSheet open onClose={() => {}} />, ops));
    await user.click(screen.getByRole('button', { name: /peek as a parent/i }));
    await waitFor(() => expect(ops.ticketSignIn).toHaveBeenCalledWith('tkt_1'));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ persona: 'parent' });
  });

  it("teacher: also registers this device for the teacher's first org and stores it", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/demo/sign-in')) return json({ ticket: 'tkt_2' });
      if (url.endsWith('/api/me')) {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
        return json({
          user: { id: 't', name: 'T', email: 't@e', isDemo: true },
          roles: { parent: false, adminOrgs: [], teacherOrgs: [{ id: 'org-9', name: 'Little Acorns' }], homeCaregiverFamilies: [] },
        });
      }
      if (url.endsWith('/api/orgs/org-9/devices')) return json({ deviceId: 'dev-7' });
      return json({}, 500);
    });
    const ops = fakeOps();
    const user = userEvent.setup();
    render(wrap(<TryDemoSheet open onClose={() => {}} />, ops));
    await user.click(screen.getByRole('button', { name: /peek as a teacher/i }));
    await waitFor(async () => expect(await getDevice()).toEqual({ orgId: 'org-9', deviceId: 'dev-7' }));
  });

  it('teacher on a phone (narrower than 700px): signs in as a plain teacher view, no tablet registration', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/demo/sign-in')) return json({ ticket: 'tkt_3' });
        if (url.endsWith('/api/me')) {
          return json({
            user: { id: 't', name: 'T', email: 't@e', isDemo: true },
            roles: { parent: false, adminOrgs: [], teacherOrgs: [{ id: 'org-9', name: 'Little Acorns' }], homeCaregiverFamilies: [] },
          });
        }
        return json({ deviceId: 'dev-8' });
      });
      const ops = fakeOps();
      const user = userEvent.setup();
      render(wrap(<TryDemoSheet open onClose={() => {}} />, ops));
      await user.click(screen.getByRole('button', { name: /peek as a teacher/i }));
      await waitFor(() => expect(ops.ticketSignIn).toHaveBeenCalledWith('tkt_3'));
      await waitFor(() => expect(screen.getByRole('button', { name: /peek as a teacher/i })).not.toBeDisabled());
      expect(fetchMock.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/devices'))).toBe(false);
      expect(await getDevice()).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});

describe('TimezonePicker', () => {
  it('shows the friendly name and lets you pick another US zone', async () => {
    const user = userEvent.setup();
    function H() {
      const [tz, setTz] = useState('America/New_York');
      return <TimezonePicker value={tz} onChange={setTz} />;
    }
    render(<H />);
    await user.click(screen.getByRole('button', { name: /eastern time/i }));
    await user.click(await screen.findByRole('radio', { name: /pacific time/i }));
    expect(await screen.findByRole('button', { name: /pacific time/i })).toBeInTheDocument();
  });
});

describe('Welcome', () => {
  it('has the house copy, both doors, Join and the demo link', async () => {
    const { Welcome } = await import('../src/features/onboarding/Welcome');
    render(wrap(<Welcome />, fakeOps(), '/onboarding'));
    expect(screen.getByRole('heading', { name: /be there, even when you can't\./i })).toBeInTheDocument();
    expect(screen.getByText(/Your face, your voice, your words — comforting your little one whenever they need you\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I'm a parent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I'm a daycare/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Got an invite code\? Join here/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try the demo/ })).toBeInTheDocument();
  });

  it('no empty band on tall phones: the text block is centred and the hero fills the space it is given (task 26c)', async () => {
    const { Welcome } = await import('../src/features/onboarding/Welcome');
    render(wrap(<Welcome />, fakeOps(), '/onboarding'));
    const hero = screen.getByTestId('welcome-hero');
    expect(hero).toHaveClass('welcome-hero');
    expect(hero.parentElement).toHaveClass('welcome-body', 'justify-center', 'min-h-full');
    const img = hero.querySelector('img')!;
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
    // The doors stay in the Screen footer, anchored at the bottom, outside the scrolling body.
    expect(screen.getByRole('button', { name: /I'm a parent/ }).closest('footer')).not.toBeNull();

    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, '../src/theme/global.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    const box = rule('.welcome-hero');
    expect(box).toMatch(/flex:\s*1 1 0/);
    expect(box).toMatch(/min-height:\s*\d+px/);
    expect(box).toMatch(/max-height:\s*calc\(100cqw \/ 1\.25\)/);
    expect(box).toMatch(/container:\s*welcome-hero \/ size/);
    expect(rule('.welcome-body')).toMatch(/container:\s*welcome \/ inline-size/);
    expect(rule('.welcome-hero img')).toMatch(/object-fit:\s*cover/);
    expect(css).toMatch(/@container welcome-hero \(min-aspect-ratio: 7 \/ 4\) \{\s*\.welcome-hero img \{ object-fit: contain; \}/);
  });
});

describe('ParentStart', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setTokenGetter(null);
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/me')) return json({ user: { id: 'u', name: 'D', email: 'd@e', isDemo: false }, roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] } });
      return json({ id: 'x' });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('previews the age, then creates the family and the child and heads to avatar setup', async () => {
    const { ParentStart } = await import('../src/features/onboarding/ParentStart');
    const user = userEvent.setup();
    const y = new Date().getFullYear() - 3;
    render(wrap(<ParentStart />, fakeOps(), '/onboarding/parent/start'));
    await user.type(screen.getByLabelText(/first name/i), 'Mia');
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    // The native picker sets the whole date at once.
    fireEvent.change(screen.getByLabelText(/birthday/i), { target: { value: `${y}-01-01` } });
    expect(await screen.findByText(/3 years old 🎂|2 years old 🎂/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/children'))).toBe(true));
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.findIndex((u) => u.endsWith('/api/families'))).toBeLessThan(urls.findIndex((u) => u.endsWith('/api/children')));
    const child = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/children'))!;
    expect(JSON.parse(child[1].body)).toMatchObject({ name: 'Mia', birthday: `${y}-01-01` });
  });

  it('birthday picker: opens about 3 years back, max today, min 12 years ago (device test M-5)', async () => {
    const { ParentStart } = await import('../src/features/onboarding/ParentStart');
    const b = birthdayBounds();
    render(wrap(<ParentStart />, fakeOps(), '/onboarding/parent/start'));
    const input = screen.getByLabelText(/birthday/i) as HTMLInputElement;
    expect(input.max).toBe(b.max);
    expect(input.min).toBe(b.min);
    expect(input.value).toBe('');
    // Opening the empty picker starts it ~3 years back instead of on today.
    input.focus();
    await waitFor(() => expect(input.value).toBe(b.start));
  });

  it('birthdayBounds: today, 12 years back and 3 years back, clamped for Feb 29', () => {
    expect(birthdayBounds(new Date(2026, 10, 19))).toEqual({ max: '2026-11-19', min: '2014-11-19', start: '2023-11-19' });
    expect(birthdayBounds(new Date(2028, 1, 29))).toEqual({ max: '2028-02-29', min: '2016-02-29', start: '2025-02-28' });
  });

  it('shows a friendly error with Try again when the server fails', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'INTERNAL', message: 'boom' } }, 500));
    const { ParentStart } = await import('../src/features/onboarding/ParentStart');
    const user = userEvent.setup();
    render(wrap(<ParentStart />, fakeOps(), '/onboarding/parent/start'));
    await user.type(screen.getByLabelText(/first name/i), 'Mia');
    fireEvent.change(screen.getByLabelText(/birthday/i), { target: { value: '2022-03-04' } });
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/tangled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('DaycareStart', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    setTokenGetter(null);
    await clearDevice();
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/orgs')) return json({ id: 'org-1' }, 201);
      if (url.endsWith('/api/orgs/org-1/classrooms')) return json({ id: 'cl-1' }, 201);
      if (url.endsWith('/api/orgs/org-1/devices')) return json({ deviceId: 'dev-1' });
      if (url.endsWith('/api/me')) return json({ user: { id: 'u', name: 'D', email: 'd@e', isDemo: false }, roles: { parent: false, adminOrgs: [{ id: 'org-1', name: 'x' }], teacherOrgs: [], homeCaregiverFamilies: [] } });
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('profile, classroom with an emblem, then a shared tablet registers this device', async () => {
    const { DaycareStart } = await import('../src/features/onboarding/DaycareStart');
    const user = userEvent.setup();
    render(wrap(<DaycareStart />, fakeOps(), '/onboarding/daycare/start'));
    await user.type(screen.getByLabelText(/daycare name/i), 'Little Acorns');
    await user.type(screen.getByLabelText(/address/i), '1 Oak Way');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('heading', { name: /create your first classroom/i })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Owls' }));
    expect(screen.getByLabelText(/classroom name/i)).toHaveValue('Owls');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('heading', { name: /shared classroom tablet/i })).toBeInTheDocument();
    const room = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/classrooms'))!;
    expect(JSON.parse(room[1].body)).toEqual({ name: 'Owls', assetKey: 'classroom.owls' });
    await user.click(screen.getByRole('button', { name: /yes, it lives in the classroom/i }));
    await waitFor(async () => expect(await getDevice()).toEqual({ orgId: 'org-1', deviceId: 'dev-1' }));
    const org = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/orgs'))!;
    expect(JSON.parse(org[1].body)).toMatchObject({ name: 'Little Acorns', address: '1 Oak Way' });
  });
});

describe('fix round 1', () => {
  it('auth_incomplete maps to generic copy, distinct from a wrong code', () => {
    const a = friendlyClerkError({ code: 'auth_incomplete' });
    expect(a.message).toMatch(/needs a little more attention/i);
    expect(a.field).toBeUndefined();
    expect(friendlyClerkError({ code: 'verification_failed' }).field).toBe('code');
  });

  it('the email code is verified once even when auto-submit fires twice in one tick', async () => {
    const { VerifyCode } = await import('../src/features/onboarding/VerifyCode');
    const { act, fireEvent } = await import('@testing-library/react');
    const verify = vi.fn(() => new Promise<void>(() => {}));
    render(<VerifyCode email="a@b.co" onVerify={verify} onResend={async () => {}} onBack={() => {}} />);
    const box = screen.getAllByRole('textbox')[0]!;
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { getData: () => '123456' } });
      fireEvent.paste(box, { clipboardData: { getData: () => '123456' } });
    });
    const verifyBtn = screen.getByRole('button', { name: /^verify$/i });
    await act(async () => {
      fireEvent.click(verifyBtn);
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('after a wrong code the boxes clear and box 1 is focused again', async () => {
    const { VerifyCode } = await import('../src/features/onboarding/VerifyCode');
    const verify = vi.fn(async () => {
      throw { errors: [{ code: 'form_code_incorrect' }] };
    });
    const user = userEvent.setup();
    render(<VerifyCode email="a@b.co" onVerify={verify} onResend={async () => {}} onBack={() => {}} />);
    await user.click(screen.getAllByRole('textbox')[0]!);
    await user.paste('123456');
    expect(await screen.findByText(/code isn.t right/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveFocus());
    expect((screen.getAllByRole('textbox') as HTMLInputElement[]).every((b) => b.value === '')).toBe(true);
  });

  it('a failed teacher device registration shows a friendly toast', async () => {
    const { toastStore } = await import('../src/ui/toast');
    setTokenGetter(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).endsWith('/demo/sign-in') ? json({ ticket: 't' }) : json({ error: { code: 'INTERNAL', message: 'x' } }, 500))),
    );
    const user = userEvent.setup();
    render(wrap(<TryDemoSheet open onClose={() => {}} />, fakeOps()));
    await user.click(screen.getByRole('button', { name: /peek as a teacher/i }));
    await waitFor(() => expect(toastStore.getSnapshot().some((t) => /set up this tablet/i.test(t.message))).toBe(true));
    vi.unstubAllGlobals();
  });
});
