import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })), exitApp: vi.fn() },
}));

import { ApiError } from '../src/lib/api';
import { LiveSession, type LiveSessionProps } from '../src/live/LiveSession';
import type { LiveCallbacks, LiveSdk } from '../src/live/sdk';
import { __resetLiveChainForTests } from '../src/live/useNapsterSession';
import { toastStore } from '../src/ui/toast';

function harness() {
  const h = { cb: null as (LiveCallbacks & { mountContainer: HTMLElement }) | null, getToken: null as null | (() => Promise<string>) };
  const inst = { destroy: vi.fn(() => h.cb?.onDestroy?.()), sendCommand: vi.fn(), muteMic: vi.fn(), unmuteMic: vi.fn(), setAudioVolume: vi.fn() };
  const sdk: LiveSdk = {
    init: vi.fn(async (gt, opts) => {
      h.getToken = gt;
      h.cb = opts;
      return inst;
    }),
  };
  const request = vi.fn(async (path: string) => (path.endsWith('/context') ? { systemMessage: 'CTX' } : {}));
  return { h, inst, sdk, request };
}

async function mount(over: Partial<LiveSessionProps> = {}, strict = false) {
  const t = harness();
  const onDone = vi.fn();
  const start = over.start ?? vi.fn(async () => ({ sessionId: 's1', token: 't1' }));
  const el = (
    <LiveSession mode="child" avatarId="a1" childId="c1" reason="missing_parent" childName="Mia" caregiverName="Ms. Jess" parentTitle="Mom" onDone={onDone} sdk={t.sdk} request={t.request} start={start} {...over} />
  );
  const r = render(strict ? <StrictMode>{el}</StrictMode> : el);
  await act(async () => {});
  return { ...t, onDone, r };
}

const goLive = async (h: ReturnType<typeof harness>['h']) => {
  await act(async () => {
    await h.getToken!();
  });
  await act(async () => {
    h.cb!.onAvatarReady?.(true);
  });
};

beforeEach(() => __resetLiveChainForTests());
afterEach(() => {
  vi.useRealTimers();
});

describe('<LiveSession>', () => {
  it('child session: shows who is with the child, the LIVE timer and the controls; no song without a title', async () => {
    const { h } = await mount();
    expect(screen.getByText('Ms. Jess is with Mia')).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    await goLive(h);
    expect(screen.getByText(/LIVE ·/)).toBeInTheDocument();
    for (const name of ['Mute microphone', 'Volume', 'End call', 'Flag a concern']) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Our song' })).toBeNull();
  });

  it('test call: says only you can see it, and shows Our song when a title is set', async () => {
    await mount({ mode: 'test', songTitle: 'You Are My Sunshine' });
    expect(screen.getByText('Test call · only you can see this')).toBeInTheDocument();
    expect(screen.queryByText(/is with/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Our song' })).toBeInTheDocument();
  });

  it("real call: Our song appears once the context brings the server's song, and sings its title and lyrics", async () => {
    const t = harness();
    t.request.mockImplementation(async (path: string) =>
      path.endsWith('/context') ? { systemMessage: 'CTX', song: { title: 'Twinkle Twinkle', lyrics: 'Little star' } } : {},
    );
    const start = vi.fn(async () => ({ sessionId: 's1', token: 't1' }));
    render(
      <LiveSession mode="child" avatarId="a1" childId="c1" reason="missing_parent" childName="Mia" caregiverName="Ms. Jess" parentTitle="Mom" onDone={vi.fn()} sdk={t.sdk} request={t.request} start={start} />,
    );
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Our song' })).toBeNull();
    await goLive(t.h);
    const song = screen.getByRole('button', { name: 'Our song' });
    expect(song).toBeEnabled();
    await act(async () => {
      song.click();
    });
    expect(t.inst.sendCommand).toHaveBeenCalledWith({
      type: 'send_message',
      data: { role: 'system', trigger_response: true, text: "Now gently sing our song 'Twinkle Twinkle' using these words: Little star" },
    });
    // One 🎵, as the toast's own icon: no 💡 info icon beside it (task 26c round 2).
    expect(toastStore.getSnapshot().at(-1)).toMatchObject({ kind: 'info', message: 'Singing "Twinkle Twinkle"', icon: '🎵' });
  });

  it('real call: no Our song when the context has no song', async () => {
    const { h, request } = await mount();
    await goLive(h);
    expect(request).toHaveBeenCalledWith('/sessions/s1/context', undefined);
    expect(screen.queryByRole('button', { name: 'Our song' })).toBeNull();
  });

  it('a song passed in (the DEV fake) shows disabled until live and sings the prop title', async () => {
    const { h, inst } = await mount({ mode: 'test', songTitle: 'You Are My Sunshine', songLyrics: 'You are my sunshine' });
    expect(screen.getByRole('button', { name: 'Our song' })).toBeDisabled();
    await goLive(h);
    await act(async () => {
      screen.getByRole('button', { name: 'Our song' }).click();
    });
    expect(inst.sendCommand).toHaveBeenCalledWith({
      type: 'send_message',
      data: { role: 'system', trigger_response: true, text: "Now gently sing our song 'You Are My Sunshine' using these words: You are my sunshine" },
    });
  });

  it('the SDK mounts into a container marked et-avatar-host (scopes the announcer-hiding CSS)', async () => {
    await mount();
    expect(screen.getByTestId('avatar-container')).toHaveClass('et-avatar-host');
  });

  it('never renders a child self-view or asks for the camera (the mic pre-flight asks for audio only)', async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [] }));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
    try {
      const { r, h } = await mount();
      await goLive(h);
      expect(r.container.querySelector('video')).toBeNull();
      for (const [constraints] of gum.mock.calls as unknown as [MediaStreamConstraints][]) expect(constraints).toEqual({ audio: true });
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    }
  });

  it('flag banner names the parent but never shows the quote', async () => {
    const { h } = await mount();
    await goLive(h);
    await act(async () => {
      h.cb!.onData?.({ event: 'function_implicitly_called', data: { call_id: 'c1', name: 'flag_concern', arguments: { category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' } } });
    });
    expect(screen.getByText("⚑ Flagged for Mom — we'll let them know")).toBeInTheDocument();
    expect(screen.queryByText(/hurt my knee/)).toBeNull();
  });

  it('captions: avatar and child bubbles, last two only', async () => {
    const { h } = await mount();
    await goLive(h);
    const m = (id: string, role: string, content: string) => ({ event: 'message_received', data: { message: { action: 'completed', type: 'message', role, item_id: id, content } } });
    await act(async () => {
      h.cb!.onData?.(m('1', 'assistant', 'Hey Sunshine!'));
      h.cb!.onData?.(m('2', 'user', 'I miss you'));
      h.cb!.onData?.(m('3', 'assistant', 'I miss you too, Bunny'));
    });
    expect(screen.queryByText('Hey Sunshine!')).toBeNull();
    expect(screen.getByText('I miss you')).toBeInTheDocument();
    expect(screen.getByText('I miss you too, Bunny')).toBeInTheDocument();
  });

  it('AVATARS_BUSY: friendly full-screen state with Try again', async () => {
    const start = vi.fn().mockRejectedValueOnce(new ApiError('AVATARS_BUSY', 'busy', 503)).mockResolvedValue({ sessionId: 's2', token: 't2' });
    const { h, sdk } = await mount({ start });
    await act(async () => {
      await h.getToken!().catch(() => {});
    });
    expect(screen.getByText('All our avatars are busy hugging…')).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(sdk.init).toHaveBeenCalledTimes(2);
  });

  it('SESSION_ACTIVE names the child and offers Go back', async () => {
    const start = vi.fn(async () => { throw new ApiError('SESSION_ACTIVE', 'x', 409); });
    const { h, onDone } = await mount({ start });
    await act(async () => {
      await h.getToken!().catch(() => {});
    });
    expect(screen.getByText('Mia already has a comfort call going')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Go back' }).click();
    expect(onDone).toHaveBeenCalledWith(undefined);
  });

  it('8-minute notice, then the 10-minute hug-break card and onDone(sessionId)', async () => {
    vi.useFakeTimers();
    const { h, inst, onDone } = await mount({ limits: { warnMs: 1000, maxMs: 2000 } });
    await goLive(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByText("Let's start saying bye-bye soon 💛")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(inst.destroy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Time for a hug break 💛')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(onDone).toHaveBeenCalledWith('s1', expect.any(Number)); // + the call length (P-7)
  });

  it('End ends the call', async () => {
    const { h, inst, request } = await mount();
    await goLive(h);
    await act(async () => {
      screen.getByRole('button', { name: 'End call' }).click();
    });
    expect(inst.destroy).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/sessions/s1/end', { method: 'POST' });
    expect(screen.getByText('Bye-bye for now 💛')).toBeInTheDocument();
  });
});

describe('no hard-coded palette hex in src/live', () => {
  it('uses tokens only (including live/parts)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const files = walk(resolve(__dirname, '../src/live'));
    expect(files.some((f) => f.includes('parts'))).toBe(true);
    const offenders = files.filter((f) => /#[0-9A-Fa-f]{3,8}\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('<LiveSession> fix round 1', () => {
  it('StrictMode double-mount: exactly one init and no stray POST /end', async () => {
    const { sdk, request } = await mount({}, true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([p]) => String(p).endsWith('/end'))).toHaveLength(0);
    expect(screen.getByTestId('live-session').dataset.state).toBe('connecting');
  });

  it('onDone fires once even when Continue is tapped and the end-card timer also runs out', async () => {
    vi.useFakeTimers();
    const { h, onDone } = await mount();
    await goLive(h);
    await act(async () => {
      screen.getByRole('button', { name: 'End call' }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Continue' }).click();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('s1', expect.any(Number)); // + the call length (P-7)
  });

  it('the screen-reader region announces completed lines only, not streaming deltas', async () => {
    const { h } = await mount();
    await goLive(h);
    const f = (action: string, content: string) => ({ event: 'message_received', data: { message: { action, type: 'message', role: 'assistant', item_id: 'i1', content } } });
    await act(async () => {
      h.cb!.onData?.(f('delta', 'Hey '));
      h.cb!.onData?.(f('delta', 'Sunshine'));
    });
    expect(screen.getByTestId('caption-announcer')).toHaveTextContent(/^$/);
    await act(async () => {
      h.cb!.onData?.(f('completed', 'Hey Sunshine!'));
    });
    expect(screen.getByTestId('caption-announcer')).toHaveTextContent('Mom: Hey Sunshine!');
  });

  it('the flag banner sits below the chips: LIVE and the caregiver chip stay visible', async () => {
    const { h } = await mount();
    await goLive(h);
    await act(async () => {
      h.cb!.onData?.({ event: 'function_implicitly_called', data: { call_id: 'c9', name: 'flag_concern', arguments: { category: 'injury', quote: 'x', severity: 'low' } } });
    });
    const banner = screen.getByText(/Flagged for Mom/);
    expect(banner.closest('header')).toBeNull();
    expect(banner.closest('main')).not.toBeNull();
    expect(screen.getByText(/LIVE ·/)).toBeVisible();
    expect(screen.getByText('Ms. Jess is with Mia')).toBeVisible();
  });
});
