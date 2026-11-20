import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@everthere/shared';

const appHandlers: Record<string, (e?: unknown) => void> = {};
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (e?: unknown) => void) => {
      appHandlers[name] = cb;
      return { remove: async () => { delete appHandlers[name]; } };
    }),
    exitApp: vi.fn(),
  },
}));

import { ApiError } from '../src/lib/api';
import type { LiveCallbacks, LiveInstance, LiveSdk } from '../src/live/sdk';
import { __resetLiveChainForTests, useNapsterSession, type UseNapsterSessionOptions } from '../src/live/useNapsterSession';
import { toast } from '../src/ui/toast';

type Cb = LiveCallbacks & { mountContainer: HTMLElement };
type MockInst = Record<'destroy' | 'sendCommand' | 'muteMic' | 'unmuteMic' | 'setAudioVolume' | 'keepAlive', ReturnType<typeof vi.fn>>;

function makeSdk() {
  const h = {
    cb: null as Cb | null,
    getToken: null as null | (() => Promise<string>),
    inst: null as unknown as MockInst,
  };
  h.inst = {
    destroy: vi.fn(() => {
      h.cb?.onAvatarReady?.(false);
      h.cb?.onDestroy?.();
    }),
    sendCommand: vi.fn(),
    muteMic: vi.fn(),
    unmuteMic: vi.fn(),
    setAudioVolume: vi.fn(),
    keepAlive: vi.fn(),
  };
  const sdk: LiveSdk = {
    init: vi.fn(async (getToken: () => Promise<string>, opts: Cb) => {
      h.getToken = getToken;
      h.cb = opts;
      return h.inst as unknown as LiveInstance;
    }),
  };
  return { h, sdk };
}

function makeRequest(over: Partial<Record<'flags' | 'end' | 'context', () => Promise<unknown>>> = {}) {
  return vi.fn(async (path: string, _init?: unknown) => {
    if (path.endsWith('/context')) return over.context ? over.context() : { systemMessage: 'CTX' };
    if (path.endsWith('/flags')) return over.flags ? over.flags() : { id: 'f1' };
    if (path.endsWith('/end')) return over.end ? over.end() : {};
    throw new Error(`unexpected ${path}`);
  });
}

async function setup(opts: Partial<UseNapsterSessionOptions> = {}) {
  const { h, sdk } = makeSdk();
  const request = (opts.request as ReturnType<typeof makeRequest>) ?? makeRequest();
  let n = 0;
  const start = opts.start ?? vi.fn(async () => ({ sessionId: `s${++n}`, token: `tok${n}` }));
  const onEnded = vi.fn();
  const r = renderHook(() => useNapsterSession({ start, onEnded, sdk, request, ...opts }));
  r.result.current.containerRef.current = document.createElement('div');
  await act(async () => {
    r.result.current.begin();
  });
  return { r, h, sdk, request, start: start as ReturnType<typeof vi.fn>, onEnded };
}

const ready = async (h: ReturnType<typeof makeSdk>['h']) => {
  await act(async () => {
    await h.getToken!();
  });
  await act(async () => {
    h.cb!.onSessionStatusChange?.('readyVideo');
    h.cb!.onAvatarReady?.(true);
  });
};

const flagFrame = (callId = 'call_1') => ({
  event: 'function_implicitly_called',
  data: { item_id: 'item_F', call_id: callId, name: 'flag_concern', arguments: { category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' } },
});

const calls = (request: ReturnType<typeof makeRequest>, suffix: string) => request.mock.calls.filter(([p]) => p.endsWith(suffix));
const commands = (h: ReturnType<typeof makeSdk>['h']) => h.inst.sendCommand.mock.calls.map(([c]) => c as { type: string });

beforeEach(() => {
  toast.clear();
  __resetLiveChainForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getToken single-start guard', () => {
  it('begin() inits the SDK inline in the container and getToken calls start() once', async () => {
    const { r, h, sdk, start } = await setup();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(h.cb!.mountContainer).toBe(r.result.current.containerRef.current);
    expect(r.result.current.state).toBe('connecting');
    await act(async () => {
      expect(await h.getToken!()).toBe('tok1');
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(r.result.current.ctx.sessionId).toBe('s1');
  });

  it('a second getToken after the session is live rejects without calling start()', async () => {
    const { h, start } = await setup();
    await ready(h);
    await expect(h.getToken!()).rejects.toThrow();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a second getToken while still connecting ends the unused session first, then starts again', async () => {
    const { r, h, start, request } = await setup();
    await act(async () => {
      await h.getToken!();
    });
    await act(async () => {
      expect(await h.getToken!()).toBe('tok2');
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    expect(r.result.current.ctx.sessionId).toBe('s2');
  });

  it('getToken after end() was requested rejects without creating a session', async () => {
    const { r, h, start } = await setup();
    let ending!: Promise<void>;
    act(() => {
      ending = r.result.current.end();
    });
    await expect(h.getToken!()).rejects.toThrow();
    await act(async () => {
      await ending;
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('begin() while connecting does nothing', async () => {
    const { r, sdk } = await setup();
    await act(async () => {
      r.result.current.begin();
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
});

describe('ready', () => {
  it('fetches the session context and sends it as a silent system message', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    expect(r.result.current.state).toBe('live');
    expect(calls(request, '/sessions/s1/context')).toHaveLength(1);
    expect(commands(h)).toContainEqual({ type: 'send_message', data: { role: 'system', trigger_response: false, text: 'CTX' } });
  });

  it('retries a failed context fetch once', async () => {
    vi.useFakeTimers();
    let n = 0;
    const request = makeRequest({ context: async () => { if (++n === 1) throw new ApiError('NETWORK', 'x'); return { systemMessage: 'CTX2' }; } });
    const { h } = await setup({ request });
    await ready(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(n).toBe(2);
    expect(commands(h)).toContainEqual({ type: 'send_message', data: { role: 'system', trigger_response: false, text: 'CTX2' } });
  });

  it("exposes the server's song from the context (title and lyrics); none when the context has none", async () => {
    const request = makeRequest({ context: async () => ({ systemMessage: 'CTX', song: { title: 'Twinkle', lyrics: 'Little star' } }) });
    const { r, h } = await setup({ request });
    expect(r.result.current.song).toBeUndefined();
    await ready(h);
    expect(r.result.current.song).toEqual({ title: 'Twinkle', lyrics: 'Little star' });

    const plain = await setup();
    await ready(plain.h);
    expect(plain.r.result.current.song).toBeUndefined();
  });

  it('ignores a malformed song in the context', async () => {
    const request = makeRequest({ context: async () => ({ systemMessage: 'CTX', song: { title: '  ', lyrics: 3 } }) });
    const { r, h } = await setup({ request });
    await ready(h);
    expect(r.result.current.song).toBeUndefined();
  });

  it('never asks for video', async () => {
    const { r, h } = await setup();
    await ready(h);
    await act(async () => {
      r.result.current.sayOurSong('You Are My Sunshine', 'You are my sunshine');
    });
    expect(commands(h).some((c: { type: string }) => /video/i.test(c.type))).toBe(false);
  });
});

describe('flag handling', () => {
  it('POSTs a live flag, sends {ok:true} with the exact command shape, and records the flag', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    await act(async () => {
      h.cb!.onData?.(flagFrame());
    });
    const posts = calls(request, '/sessions/s1/flags');
    expect(posts).toHaveLength(1);
    expect(posts[0]![1]).toEqual({ method: 'POST', json: { category: 'injury', quote: 'I fell and hurt my knee', severity: 'low', source: 'live' } });
    expect(commands(h)).toContainEqual({ type: 'send_function_output', data: { call_id: 'call_1', output: { ok: true }, delay: false } });
    expect(r.result.current.ctx.flags).toHaveLength(1);
    expect(r.result.current.ctx.bannerUntil).toBeGreaterThan(Date.now());
  });

  it('still answers the call with {ok:false} when the POST fails', async () => {
    const request = makeRequest({ flags: async () => { throw new ApiError('NETWORK', 'x'); } });
    const { r, h } = await setup({ request });
    await ready(h);
    await act(async () => {
      h.cb!.onData?.(flagFrame());
    });
    expect(commands(h)).toContainEqual({ type: 'send_function_output', data: { call_id: 'call_1', output: { ok: false }, delay: false } });
    // The caregiver still sees the banner: the avatar did flag it.
    expect(r.result.current.ctx.flags).toHaveLength(1);
  });

  it('a slow flag POST: {ok:false} goes out at the 3.5 s deadline and the POST still completes in the background', async () => {
    vi.useFakeTimers();
    let posted = false;
    const request = makeRequest({ flags: () => new Promise((res) => setTimeout(() => { posted = true; res({ id: 'f1' }); }, 8_000)) });
    const { r, h } = await setup({ request });
    await ready(h);
    await act(async () => {
      h.cb!.onData?.(flagFrame());
      await vi.advanceTimersByTimeAsync(3_400);
    });
    expect(commands(h).filter((c) => c.type === 'send_function_output')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(commands(h)).toContainEqual({ type: 'send_function_output', data: { call_id: 'call_1', output: { ok: false }, delay: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(posted).toBe(true);
    expect(commands(h).filter((c) => c.type === 'send_function_output')).toHaveLength(1);
    expect(r.result.current.ctx.flags).toHaveLength(1);
  });

  it('handles each call_id once', async () => {
    const { h, request } = await setup();
    await ready(h);
    await act(async () => {
      h.cb!.onData?.(flagFrame('dup'));
      h.cb!.onData?.(flagFrame('dup'));
    });
    expect(calls(request, '/flags')).toHaveLength(1);
  });
});

describe('captions from onData', () => {
  it('merges deltas by item_id into a single avatar bubble', async () => {
    const { r, h } = await setup();
    await ready(h);
    const m = (action: string, content?: string) => ({ event: 'message_received', data: { message: { action, type: 'message', role: 'assistant', item_id: 'i1', response_id: 'r1', content } } });
    await act(async () => {
      h.cb!.onData?.(m('created'));
      h.cb!.onData?.(m('delta', 'Hey '));
      h.cb!.onData?.(m('delta', 'Sunshine!'));
    });
    expect(r.result.current.ctx.captions).toEqual([{ id: 'i1', role: 'avatar', text: 'Hey Sunshine!' }]);
  });
});

describe('timers', () => {
  it('warns at sessionWarnMs and ends at sessionMaxMs', async () => {
    vi.useFakeTimers();
    const { r, h, request, onEnded } = await setup();
    await ready(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIMITS.sessionWarnMs - 10);
    });
    expect(r.result.current.ctx.warnShown).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(r.result.current.ctx.warnShown).toBe(true);
    expect(r.result.current.state).toBe('live');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIMITS.sessionMaxMs - LIMITS.sessionWarnMs);
    });
    expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    expect(r.result.current.state).toBe('ended');
    expect(r.result.current.ctx.endReason).toBe('max');
    expect(onEnded).toHaveBeenCalledWith('s1');
  });
});

describe('ending', () => {
  it('the Android pause event (e.g. the RECORD_AUDIO permission dialog) does NOT end the call', async () => {
    const { r, h, request } = await setup();
    await act(async () => {
      appHandlers.pause?.();
    });
    expect(r.result.current.state).toBe('connecting');
    await ready(h);
    await act(async () => {
      appHandlers.pause?.();
    });
    expect(r.result.current.state).toBe('live');
    expect(h.inst.destroy).not.toHaveBeenCalled();
    expect(calls(request, '/end')).toHaveLength(0);
  });

  it('backgrounding while the mic permission prompt is up does NOT end the call', async () => {
    const { r, h } = await setup();
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
      appHandlers.appStateChange!({ isActive: false });
    });
    expect(r.result.current.state).toBe('connecting');
    expect(h.inst.destroy).not.toHaveBeenCalled();
  });

  it('real backgrounding (appStateChange isActive:false) ends the session (destroy + POST /end)', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    await act(async () => {
      appHandlers.appStateChange!({ isActive: true });
    });
    expect(r.result.current.state).toBe('live');
    await act(async () => {
      appHandlers.appStateChange!({ isActive: false });
    });
    expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    expect(r.result.current.state).toBe('ended');
    expect(r.result.current.ctx.endReason).toBe('pause');
  });

  it('the page becoming hidden (visibilitychange fallback) ends the session', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
    expect(r.result.current.state).toBe('ended');
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
  });

  it('SDK-initiated teardown (onDestroy) moves to ended and POSTs /end', async () => {
    const { r, h, request, onEnded } = await setup();
    await ready(h);
    await act(async () => {
      h.cb!.onAvatarReady?.(false);
      h.cb!.onDestroy?.();
    });
    expect(r.result.current.state).toBe('ended');
    expect(r.result.current.ctx.endReason).toBe('remote');
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    expect(onEnded).toHaveBeenCalledWith('s1');
  });

  it('session_expired data event ends the session', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    await act(async () => {
      h.cb!.onData?.({ event: 'session_expired', data: undefined });
    });
    expect(r.result.current.state).toBe('ended');
    expect(calls(request, '/end')).toHaveLength(1);
  });

  it('end() is idempotent: one destroy, one POST /end, even when /end fails', async () => {
    const request = makeRequest({ end: async () => { throw new ApiError('NETWORK', 'x'); } });
    const { r, h } = await setup({ request });
    await ready(h);
    await act(async () => {
      void r.result.current.end();
      await r.result.current.end();
    });
    expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    expect(calls(request, '/end')).toHaveLength(1);
    expect(r.result.current.state).toBe('ended');
  });

  it('unmount destroys the SDK and POSTs /end', async () => {
    const { r, h, request } = await setup();
    await ready(h);
    await act(async () => {
      r.unmount();
    });
    expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
  });
});

describe('errors', () => {
  it('a start() failure (AVATARS_BUSY) -> failed with the code, and a later SDK onError does not change it', async () => {
    const start = vi.fn(async () => { throw new ApiError('AVATARS_BUSY', 'busy', 503); });
    const { r, h } = await setup({ start });
    await act(async () => {
      await h.getToken!().catch(() => {});
      h.cb!.onError?.(Object.assign(new Error('mint failed'), { code: 'TOKEN_ERROR' }));
    });
    expect(r.result.current.state).toBe('failed');
    expect(r.result.current.ctx.error).toBe('AVATARS_BUSY');
  });

  it('a blocked microphone -> failed MIC_BLOCKED and the SDK is torn down', async () => {
    const { r, h, request } = await setup();
    await act(async () => {
      await h.getToken!();
    });
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionBlocked');
    });
    expect(r.result.current.state).toBe('failed');
    expect(r.result.current.ctx.error).toBe('MIC_BLOCKED');
    expect(h.inst.destroy).toHaveBeenCalled();
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
  });

  it('no_credits_left -> failed NO_CREDITS', async () => {
    const { r, h } = await setup();
    await ready(h);
    await act(async () => {
      h.cb!.onData?.({ event: 'no_credits_left', data: undefined });
    });
    expect(r.result.current.state).toBe('failed');
    expect(r.result.current.ctx.error).toBe('NO_CREDITS');
  });

  it('begin() after a failure starts a fresh attempt', async () => {
    const start = vi.fn().mockRejectedValueOnce(new ApiError('AVATARS_BUSY', 'busy', 503)).mockResolvedValue({ sessionId: 's9', token: 't9' });
    const { r, h, sdk } = await setup({ start });
    await act(async () => {
      await h.getToken!().catch(() => {});
    });
    expect(r.result.current.state).toBe('failed');
    await act(async () => {
      r.result.current.begin();
    });
    expect(sdk.init).toHaveBeenCalledTimes(2);
    await act(async () => {
      expect(await h.getToken!()).toBe('t9');
    });
    expect(r.result.current.state).toBe('connecting');
  });
});

describe('wobbly connection toast', () => {
  it('shows at most once per 20 s', async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(toast, 'info');
    const { h } = await setup();
    await ready(h);
    const warn = { event: 'avatar_connection_warning', data: { disconnect_after: 30 } };
    await act(async () => {
      h.cb!.onData?.(warn);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      h.cb!.onData?.(warn);
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("Connection's a bit wobbly…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
      h.cb!.onData?.(warn);
    });
    expect(info).toHaveBeenCalledTimes(2);
  });
});

describe('controls', () => {
  it('sayOurSong sends the song as a system message that triggers a response', async () => {
    const { r, h } = await setup();
    await ready(h);
    await act(async () => {
      r.result.current.sayOurSong('You Are My Sunshine', 'You are my sunshine, my only sunshine');
    });
    expect(commands(h)).toContainEqual({
      type: 'send_message',
      data: { role: 'system', trigger_response: true, text: "Now gently sing our song 'You Are My Sunshine' using these words: You are my sunshine, my only sunshine" },
    });
  });

  it('mute/unmute drive the microphone and setVolume the avatar volume', async () => {
    const { r, h } = await setup();
    await ready(h);
    await act(async () => {
      r.result.current.mute();
    });
    expect(h.inst.muteMic).toHaveBeenCalled();
    expect(r.result.current.muted).toBe(true);
    await act(async () => {
      r.result.current.unmute();
      r.result.current.setVolume(0.4);
    });
    expect(h.inst.unmuteMic).toHaveBeenCalled();
    expect(h.inst.setAudioVolume).toHaveBeenCalledWith(0.4);
    expect(r.result.current.volume).toBe(0.4);
  });
});

describe('bounded teardown and start/end races', () => {
  it('a hung init followed by end still POSTs /end and reaches ended within the bound', async () => {
    vi.useFakeTimers();
    const h = { getToken: null as null | (() => Promise<string>) };
    const sdk: LiveSdk = {
      init: vi.fn((gt: () => Promise<string>) => {
        h.getToken = gt;
        return new Promise<LiveInstance>(() => {});
      }),
    };
    const request = makeRequest();
    const r = renderHook(() => useNapsterSession({ start: async () => ({ sessionId: 's1', token: 't' }), sdk, request }));
    r.result.current.containerRef.current = document.createElement('div');
    await act(async () => {
      r.result.current.begin();
    });
    await act(async () => {
      await h.getToken!();
    });
    await act(async () => {
      void r.result.current.end();
    });
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    expect(r.result.current.state).toBe('ending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(r.result.current.state).toBe('ended');
  });

  for (const how of ['unmount', 'end'] as const) {
    it(how + ' while start() is pending: when start resolves its session is ended, and destroy runs once', async () => {
      let resolveStart!: (v: { sessionId: string; token: string }) => void;
      const start = vi.fn(() => new Promise<{ sessionId: string; token: string }>((res) => (resolveStart = res)));
      const { r, h, request } = await setup({ start });
      let tokenP!: Promise<string>;
      act(() => {
        tokenP = h.getToken!();
        tokenP.catch(() => {});
      });
      await act(async () => {
        if (how === 'unmount') r.unmount();
        else void r.result.current.end();
      });
      await act(async () => {
        resolveStart({ sessionId: 's7', token: 't7' });
        await expect(tokenP).rejects.toThrow();
      });
      expect(calls(request, '/sessions/s7/end')).toHaveLength(1);
      expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    });
  }

  it('Try again after a failure waits for the failed session to be freed (POST /end) before the next init', async () => {
    let releaseEnd!: () => void;
    const request = makeRequest({ end: () => new Promise((res) => (releaseEnd = () => res({}))) });
    const { r, h, sdk } = await setup({ request });
    await act(async () => {
      await h.getToken!();
    });
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionBlocked');
    });
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
    await act(async () => {
      r.result.current.begin();
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseEnd();
    });
    expect(sdk.init).toHaveBeenCalledTimes(2);
  });

  it('still connecting after 45 s -> friendly CONNECT_TIMEOUT failure, and the session is freed', async () => {
    vi.useFakeTimers();
    const { r, h, request } = await setup();
    await act(async () => {
      await h.getToken!();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_000);
    });
    expect(r.result.current.state).toBe('connecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(r.result.current.state).toBe('failed');
    expect(r.result.current.ctx.error).toBe('CONNECT_TIMEOUT');
    expect(h.inst.destroy).toHaveBeenCalledTimes(1);
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
  });

  it('the connecting timeout does not run while the mic permission prompt is up', async () => {
    vi.useFakeTimers();
    const { r, h } = await setup();
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(r.result.current.state).toBe('connecting');
  });
});

describe('mic pre-flight before connecting (task 26c round 2)', () => {
  type Mic = 'granted' | 'denied' | 'unavailable';
  const deferred = () => {
    let resolve!: (v: Mic) => void;
    const p = new Promise<Mic>((r) => (resolve = r));
    return { resolve, micCheck: vi.fn(() => p) };
  };

  it('runs before the SDK connects: no init and no session until the mic is settled', async () => {
    const d = deferred();
    const { r, sdk, start } = await setup({ micCheck: d.micCheck });
    expect(d.micCheck).toHaveBeenCalledTimes(1);
    expect(r.result.current.state).toBe('connecting');
    expect(sdk.init).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      d.resolve('granted');
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it('the connect timeout does not run while the system mic dialog is open; it starts once the mic is settled', async () => {
    vi.useFakeTimers();
    const d = deferred();
    const { r, sdk } = await setup({ micCheck: d.micCheck });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(r.result.current.state).toBe('connecting');
    expect(sdk.init).not.toHaveBeenCalled();
    await act(async () => {
      d.resolve('granted');
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_000);
    });
    expect(r.result.current.state).toBe('connecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(r.result.current.ctx.error).toBe('CONNECT_TIMEOUT');
  });

  it('denied -> our microphone (MIC_BLOCKED) state, never a connect error; nothing is started', async () => {
    const { r, sdk, start, request } = await setup({ micCheck: async () => 'denied' as const });
    expect(r.result.current.state).toBe('failed');
    expect(r.result.current.ctx.error).toBe('MIC_BLOCKED');
    expect(sdk.init).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(calls(request, '/end')).toHaveLength(0);
  });

  it('granted fast path: the SDK connects in the same turn, with no extra wait', async () => {
    vi.useFakeTimers();
    const { sdk } = await setup({ micCheck: async () => 'granted' as const });
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it('"unavailable" (no API, no device) still connects and lets the SDK report', async () => {
    const { sdk } = await setup({ micCheck: async () => 'unavailable' as const });
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it('the dialog does not count as backgrounding: appStateChange isActive:false while it is up keeps the call', async () => {
    const d = deferred();
    const { r, sdk } = await setup({ micCheck: d.micCheck });
    await act(async () => {
      appHandlers.appStateChange!({ isActive: false });
    });
    expect(r.result.current.state).toBe('connecting');
    await act(async () => {
      d.resolve('granted');
    });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(r.result.current.state).toBe('connecting');
  });

  it('real backgrounding after the mic is settled still ends the call', async () => {
    const { r, h, request } = await setup({ micCheck: async () => 'granted' as const });
    await ready(h);
    await act(async () => {
      appHandlers.appStateChange!({ isActive: false });
    });
    expect(r.result.current.state).toBe('ended');
    expect(calls(request, '/sessions/s1/end')).toHaveLength(1);
  });

  it('sayOurSong sends the lyrics with blank lines and whitespace runs collapsed', async () => {
    const { r, h } = await setup({ micCheck: async () => 'granted' as const });
    await ready(h);
    await act(async () => {
      r.result.current.sayOurSong('Twinkle', 'Twinkle, twinkle,\n\n  little star,\r\n\tHow I wonder');
    });
    expect(commands(h)).toContainEqual({
      type: 'send_message',
      data: { role: 'system', trigger_response: true, text: "Now gently sing our song 'Twinkle' using these words: Twinkle, twinkle, little star, How I wonder" },
    });
  });
});
