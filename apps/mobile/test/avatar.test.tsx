import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AvatarView, MeResponse } from '@everthere/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoStep } from '../src/features/avatar/PhotoStep';
import { VoiceStep } from '../src/features/avatar/VoiceStep';
import { ConsentStep, CONSENT_COPY } from '../src/features/avatar/ConsentStep';
import { Creating } from '../src/features/avatar/Creating';
import { TestAndApprove } from '../src/features/avatar/TestAndApprove';
import { bindFlowAvatar, clearFlow, markFlowStart } from '../src/lib/flowHistory';
import { MyAvatar } from '../src/features/avatar/MyAvatar';
import { AvatarSetup } from '../src/features/avatar/AvatarSetup';
import { VOICES } from '@everthere/shared';
import { SessionProvider } from '../src/shell/SessionContext';
import { setTokenGetter } from '../src/lib/api';
import { installCanvas, fakeBitmap } from './canvasMock';

const cam = vi.hoisted(() => ({
  getPhoto: vi.fn(async () => ({ webPath: 'blob:picked' })),
  pickImages: vi.fn(async () => ({ photos: [{ webPath: 'blob:gallery' }] })),
}));
vi.mock('@capacitor/camera', () => ({
  Camera: cam,
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Camera: 'CAMERA', Photos: 'PHOTOS' },
  CameraDirection: { Front: 'FRONT', Rear: 'REAR' },
}));

vi.mock('@clerk/react', () => ({ useClerk: () => ({ signOut: async () => {} }), useAuth: () => ({ getToken: async () => 't' }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const avatar = (over: Partial<AvatarView> = {}): AvatarView => ({
  id: 'av1', status: 'approved', voiceId: 'coral', photoKey: 'avatar/u/1.jpg', photoUrl: 'https://m/1.jpg', parentTitle: 'Mom',
  consentName: 'Sarah Lee', consentAt: 1, approvedAt: 2, createdAt: 1, hasAgent: true, ...over,
});
const me = (isDemo = false): MeResponse => ({
  user: { id: 'u1', name: 'Sarah Lee', email: 's@x.com', isDemo },
  roles: { parent: true, adminOrgs: [], teacherOrgs: [], homeCaregiverFamilies: [] },
});
const child = { id: 'c1', name: 'Mia', photoKey: null, birthday: '2022-01-01', timezone: 'America/New_York' };

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}
function Shell({ children, at = '/', state, isDemo = false }: { children: React.ReactNode; at?: string; state?: unknown; isDemo?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: at, state }]}>
        <SessionProvider me={me(isDemo)}>
          {children}
          <Where />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => setTokenGetter(null));
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- camera ------------------------------------------------------------------------------------------------------

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}
function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(getUserMedia) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
}

describe('PhotoStep camera', () => {
  it('stops every media track on unmount', async () => {
    const { stream, tracks } = fakeStream();
    stubCamera(async () => stream);
    const { unmount } = render(<PhotoStep onPhoto={() => {}} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Take photo' });
    unmount();
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('stops tracks that arrive after the screen was already left', async () => {
    const { stream, tracks } = fakeStream();
    let resolve!: (s: MediaStream) => void;
    stubCamera(() => new Promise<MediaStream>((r) => (resolve = r)));
    const { unmount } = render(<PhotoStep onPhoto={() => {}} />);
    unmount();
    await act(async () => resolve(stream));
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('releases the camera while the preview shows, and "Use this" hands the photo on', async () => {
    const { stream, tracks } = fakeStream();
    stubCamera(async () => stream);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));
    const onPhoto = vi.fn();
    const user = userEvent.setup();
    render(<PhotoStep onPhoto={onPhoto} />);
    await user.click(await screen.findByRole('button', { name: 'Take photo' }));
    await screen.findByRole('button', { name: 'Use this' });
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onPhoto).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('falls back to the system camera when getUserMedia throws', async () => {
    stubCamera(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));
    const user = userEvent.setup();
    render(<PhotoStep onPhoto={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Open the camera' }));
    expect(cam.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ source: 'CAMERA' }));
    await screen.findByRole('button', { name: 'Use this' });
  });

  it('picks from the gallery with the Capacitor camera plugin', async () => {
    const { stream } = fakeStream();
    stubCamera(async () => stream);
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));
    const user = userEvent.setup();
    render(<PhotoStep onPhoto={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Choose from your photos' }));
    expect(cam.pickImages).toHaveBeenCalled();
    await screen.findByRole('button', { name: 'Use this' });
    // A gallery photo is not 'retaken': the secondary button picks another one (device test M-7).
    expect(screen.queryByRole('button', { name: 'Retake' })).toBeNull();
    const before = cam.pickImages.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Choose another' }));
    expect(cam.pickImages).toHaveBeenCalledTimes(before + 1);
    await screen.findByRole('button', { name: 'Use this' });
  });

  it('shows a live lighting chip that updates every 500ms', async () => {
    const { stream } = fakeStream();
    stubCamera(async () => stream);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    let level = 20;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      getImageData: () => ({ data: Uint8ClampedArray.from([level, level, level, 255]) }),
    } as never);
    render(<PhotoStep onPhoto={() => {}} />);
    await screen.findByRole('button', { name: 'Take photo' });
    expect(await screen.findByText(/a bit dark/i, undefined, { timeout: 2000 })).toBeInTheDocument();
    level = 140;
    expect(await screen.findByText(/great light/i, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});

// ---- voices ------------------------------------------------------------------------------------------------------

describe('VoiceStep', () => {
  it('lists all ten voices with their descriptors, the test-call line and the coming-soon teaser', () => {
    render(<VoiceStep value={null} onChange={() => {}} onNext={() => {}} clips={{}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(VOICES.length);
    expect(screen.getByText('Warm & steady')).toBeInTheDocument();
    expect(screen.getByText('Deep & cozy')).toBeInTheDocument();
    expect(screen.getByText(/You'll hear it in your test call/)).toBeInTheDocument();
    expect(screen.getByText(/Record your real voice/)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('has no play buttons when no preview clip exists', () => {
    render(<VoiceStep value={null} onChange={() => {}} onNext={() => {}} clips={{}} />);
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull();
  });

  it('shows a play button only for the voices that have a clip', () => {
    render(<VoiceStep value={null} onChange={() => {}} onNext={() => {}} clips={{ coral: '/c.m4a', cedar: '/d.m4a' }} />);
    expect(screen.getAllByRole('button', { name: /^Play/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Play Coral' })).toBeInTheDocument();
  });

  it('keeps Continue off until a voice is picked', async () => {
    const onNext = vi.fn();
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<VoiceStep value={null} onChange={onChange} onNext={onNext} clips={{}} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Echo/ }));
    expect(onChange).toHaveBeenCalledWith('echo');
    rerender(<VoiceStep value="echo" onChange={onChange} onNext={onNext} clips={{}} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalled();
  });
});

// ---- consent -----------------------------------------------------------------------------------------------------

describe('ConsentStep', () => {
  it('uses the exact consent wording', () => {
    expect(CONSENT_COPY).toBe(
      'I confirm this avatar is an AI version of me, and I consent to my likeness and voice being used to comfort my child through EverThere. I can delete it anytime.',
    );
  });

  it('needs a non-empty trimmed name AND the checkbox before the button works', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ConsentStep onSubmit={onSubmit} />);
    const go = screen.getByRole('button', { name: /Create my avatar/ });
    expect(go).toBeDisabled();
    await user.type(screen.getByLabelText(/full legal name/i), '   ');
    await user.click(screen.getByRole('checkbox'));
    expect(go).toBeDisabled();
    await user.type(screen.getByLabelText(/full legal name/i), '  Sarah Lee  ');
    expect(go).toBeEnabled();
    await user.click(go);
    expect(onSubmit).toHaveBeenCalledWith({ consentName: 'Sarah Lee' });
  });
});

// ---- creating ----------------------------------------------------------------------------------------------------

describe('Creating', () => {
  const fetchSeq = (statuses: string[]) => {
    let i = 0;
    const f = vi.fn(async () => json(avatar({ status: statuses[Math.min(i++, statuses.length - 1)]! })));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('polls every 4s, then hands over when ready', async () => {
    vi.useFakeTimers();
    const f = fetchSeq(['creating', 'creating', 'ready']);
    const onReady = vi.fn();
    render(<Creating avatarId="av1" onReady={onReady} onRetake={() => {}} />);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(f).toHaveBeenCalledTimes(2);
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(f).toHaveBeenCalledTimes(3);
    expect(onReady).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers();
    const f = fetchSeq(['creating']);
    const { unmount } = render(<Creating avatarId="av1" onReady={() => {}} onRetake={() => {}} />);
    await act(async () => vi.advanceTimersByTimeAsync(4100));
    const calls = f.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(f).toHaveBeenCalledTimes(calls);
  });

  it('rotates playful lines every 3 seconds', async () => {
    vi.useFakeTimers();
    fetchSeq(['creating']);
    render(<Creating avatarId="av1" onReady={() => {}} onRetake={() => {}} />);
    const first = screen.getByTestId('creating-line').textContent;
    await act(async () => vi.advanceTimersByTimeAsync(3100));
    expect(screen.getByTestId('creating-line').textContent).not.toBe(first);
  });

  it('on failure shows a friendly retry that offers a new photo', async () => {
    fetchSeq(['failed']);
    const onRetake = vi.fn();
    const user = userEvent.setup();
    render(<Creating avatarId="av1" onReady={() => {}} onRetake={onRetake} />);
    await user.click(await screen.findByRole('button', { name: /Retake my photo/ }));
    expect(onRetake).toHaveBeenCalled();
  });
});

// ---- test & approve ----------------------------------------------------------------------------------------------

describe('TestAndApprove', () => {
  it('after the test call asks how it felt, and Approve calls the API', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (String(url).endsWith('/approve')) return json(avatar({ status: 'approved' }));
        return json(avatar({ status: 'ready' }));
      }),
    );
    const user = userEvent.setup();
    render(
      <Shell at="/t" state={{ endedSessionId: 's1' }}>
        <Routes>
          <Route path="/t" element={<TestAndApprove avatarId="av1" />} />
        </Routes>
      </Shell>,
    );
    expect(await screen.findByText('How did that feel?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve my avatar/ }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/avatars/av1/approve'))).toBe(true));
    expect(await screen.findByText(/approved/i)).toBeInTheDocument();
  });

  it('after approving, Back home rewinds the set-up flow out of the history (device test M-8)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json(avatar({ status: String(url).endsWith('/approve') ? 'approved' : 'ready' }))),
    );
    let idx = 4;
    vi.spyOn(window.history, 'state', 'get').mockImplementation(() => ({ idx }));
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    markFlowStart(); // setup/photo at idx 4
    bindFlowAvatar('av1');
    idx = 7;
    try {
      const user = userEvent.setup();
      render(
        <Shell at="/t" state={{ endedSessionId: 's1' }}>
          <Routes>
            <Route path="/t" element={<TestAndApprove avatarId="av1" />} />
          </Routes>
        </Shell>,
      );
      await user.click(await screen.findByRole('button', { name: /Approve my avatar/ }));
      await user.click(await screen.findByRole('button', { name: 'Back home' }));
      expect(go).toHaveBeenCalledWith(-4);
    } finally {
      vi.restoreAllMocks();
      clearFlow();
    }
  });

  it('before the call, offers to start one (navigating to the live test route with the avatar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(avatar({ status: 'ready' }))));
    const user = userEvent.setup();
    function Live() {
      const l = useLocation();
      return <output data-testid="live">{JSON.stringify(l.state)}</output>;
    }
    render(
      <Shell at="/t">
        <Routes>
          <Route path="/t" element={<TestAndApprove avatarId="av1" />} />
          <Route path="/live/test" element={<Live />} />
        </Routes>
      </Shell>,
    );
    await user.click(await screen.findByRole('button', { name: /Start test call/ }));
    const st = JSON.parse((await screen.findByTestId('live')).textContent!);
    expect(st).toMatchObject({ avatarId: 'av1', parentTitle: 'Mom', returnTo: '/t' });
  });
});

// ---- my avatar + edits -------------------------------------------------------------------------------------------

describe('MyAvatar', () => {
  const stubApi = (a: AvatarView[]) => vi.stubGlobal('fetch', vi.fn(async () => json(a)));

  it('shows status, photo, voice and warns before an edit', async () => {
    stubApi([avatar()]);
    const user = userEvent.setup();
    render(
      <Shell at="/parent/avatar">
        <Routes>
          <Route path="/parent/avatar" element={<MyAvatar />} />
          <Route path="/parent/avatar/retake/*" element={<span>retake flow</span>} />
        </Routes>
      </Shell>,
    );
    expect(await screen.findByText(/Coral/)).toBeInTheDocument();
    expect(screen.getByText('Bright & cheerful')).toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Change photo/ }));
    expect(screen.getByText(/Changing this means you'll test and approve again\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('retake flow')).toBeInTheDocument();
  });

  it("labels a digital twin's own cloned voice instead of showing its raw id", async () => {
    stubApi([avatar({ voiceId: 'custom:5edcdc24-1ebc-487c-b631-4ac6275aebf1', consentName: 'Vamshi Krishna (self: ...)' })]);
    render(
      <Shell at="/parent/avatar" isDemo>
        <Routes>
          <Route path="/parent/avatar" element={<MyAvatar />} />
        </Routes>
      </Shell>,
    );
    expect(await screen.findByText('Your own voice ✨')).toBeInTheDocument();
    expect(screen.getByText('Cloned from your own recording')).toBeInTheDocument();
    expect(screen.queryByText(/custom:/)).toBeNull();
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('hides the edit actions for a demo account', async () => {
    stubApi([avatar()]);
    render(
      <Shell at="/parent/avatar" isDemo>
        <Routes>
          <Route path="/parent/avatar" element={<MyAvatar />} />
        </Routes>
      </Shell>,
    );
    await screen.findByText(/Coral/);
    expect(await screen.findByText(/demo account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change photo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change voice/ })).toBeNull();
  });

  it('invites the parent to create an avatar when there is none', async () => {
    stubApi([]);
    render(
      <Shell at="/parent/avatar">
        <Routes>
          <Route path="/parent/avatar" element={<MyAvatar />} />
        </Routes>
      </Shell>,
    );
    expect(await screen.findByRole('button', { name: /Create your avatar/ })).toBeInTheDocument();
  });
});

describe('AvatarSetup', () => {
  /** A fetch that records requests; bodies of multipart uploads are summarised as FormData. */
  function stubFlow(patchResult: AvatarView | Response, status = 200) {
    const reqs: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(3024, 4032)));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
        reqs.push({ method: init?.method ?? 'GET', url: String(url), body });
        if (String(url) === 'blob:gallery') return ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
        if (String(url).includes('/media')) return json({ key: 'avatar/u1/new.jpg', url: 'https://m/new.jpg' });
        if (String(url).includes('/children')) return json({ children: [child] });
        if (String(url).includes('/avatars/mine')) return json([avatar({ status: 'approved' })]);
        if (patchResult instanceof Response) return patchResult;
        return json(patchResult, status);
      }),
    );
    return reqs;
  }

  async function reachConsent(user: ReturnType<typeof userEvent.setup>) {
    // Stub the photo through the gallery picker (the camera is unavailable in jsdom).
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));
    await screen.findByRole('button', { name: 'Open the camera' }); // jsdom has no camera: wait for the fallback layout
    await user.click(screen.getByRole('button', { name: 'Choose from your photos' }));
    await user.click(await screen.findByRole('button', { name: 'Use this' }));
  }

  it('a photo change sends the new key together with consentName and consentAccepted', async () => {
    const rig = installCanvas();
    const reqs = stubFlow(avatar({ status: 'creating' }));
    const user = userEvent.setup();
    render(
      <Shell at="/parent/avatar/retake">
        <Routes>
          <Route path="/parent/avatar/retake/*" element={<AvatarSetup intent="photo" />} />
          <Route path="/parent/avatar/creating/:id" element={<span>creating screen</span>} />
        </Routes>
      </Shell>,
    );
    await reachConsent(user);
    await user.type(await screen.findByLabelText(/full legal name/i), 'Sarah Lee');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Create my avatar|Save my new photo/ }));
    await screen.findByText('creating screen');
    const patch = reqs.find((r) => r.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/avatars\/av1$/);
    expect(patch.body).toEqual({ photoKey: 'avatar/u1/new.jpg', consentName: 'Sarah Lee', consentAccepted: true });
    const up = reqs.find((r) => r.url.includes('/media'))!;
    expect((up.body as FormData).get('purpose')).toBe('avatar');
    rig.restore();
  });

  it('shows the friendly DEMO_READ_ONLY copy when the server refuses', async () => {
    const rig = installCanvas();
    const reqs = stubFlow(json({ error: { code: 'DEMO_READ_ONLY', message: 'x' } }, 403));
    void reqs;
    const user = userEvent.setup();
    render(
      <Shell at="/parent/avatar/retake">
        <Routes>
          <Route path="/parent/avatar/retake/*" element={<AvatarSetup intent="photo" />} />
        </Routes>
      </Shell>,
    );
    await reachConsent(user);
    await user.type(await screen.findByLabelText(/full legal name/i), 'Sarah Lee');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Create my avatar|Save my new photo/ }));
    expect(await screen.findByText(/demo account, so changes are switched off/)).toBeInTheDocument();
    rig.restore();
  });

  it('blocks the setup screens for a demo account up front', async () => {
    stubFlow(avatar());
    render(
      <Shell at="/parent/avatar/setup" isDemo>
        <Routes>
          <Route path="/parent/avatar/setup/*" element={<AvatarSetup intent="new" />} />
        </Routes>
      </Shell>,
    );
    expect(await screen.findByText(/demo account, so changes are switched off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose from your photos' })).toBeNull();
  });
});

void fireEvent;

// ---- backgrounding -----------------------------------------------------------------------------------------------

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('backgrounding', () => {
  afterEach(() => setVisibility('visible'));

  it('the camera lets go when the app is backgrounded and comes back on resume', async () => {
    const first = fakeStream();
    const second = fakeStream();
    const streams = [first, second];
    stubCamera(async () => streams.shift()!.stream);
    render(<PhotoStep onPhoto={() => {}} />);
    await screen.findByRole('button', { name: 'Take photo' });
    act(() => setVisibility('hidden'));
    for (const t of first.tracks) expect(t.stop).toHaveBeenCalled();
    act(() => setVisibility('visible'));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
  });

  it('does not restart the camera on resume while the preview is showing', async () => {
    const { stream } = fakeStream();
    stubCamera(async () => stream);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));
    const user = userEvent.setup();
    render(<PhotoStep onPhoto={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Take photo' }));
    await screen.findByRole('button', { name: 'Use this' });
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('the creating poll pauses in the background and resumes with an immediate check', async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => json(avatar({ status: 'creating' })));
    vi.stubGlobal('fetch', f);
    render(<Creating avatarId="av1" onReady={() => {}} onRetake={() => {}} />);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(f).toHaveBeenCalledTimes(1);
    act(() => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(f).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('Creating ceiling', () => {
  it('after 35 minutes of "creating" shows the friendly retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => json(avatar({ status: 'creating' }))));
    render(<Creating avatarId="av1" onReady={() => {}} onRetake={() => {}} />);
    await act(async () => vi.advanceTimersByTimeAsync(34 * 60_000));
    expect(screen.queryByRole('button', { name: /Retake my photo/ })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(screen.getByRole('button', { name: /Retake my photo/ })).toBeInTheDocument();
  });
});
