import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })), exitApp: vi.fn() },
}));

import { LiveSession } from '../src/live/LiveSession';
import {
  DEFAULT_FRAME_MODE,
  FRAME_MODES,
  FRAME_MODE_KEY,
  LONG_PRESS_MS,
  cropAspect,
  loadFrameMode,
  nextFrameMode,
  saveFrameMode,
} from '../src/live/frameMode';
import type { LiveCallbacks, LiveSdk } from '../src/live/sdk';
import { __resetLiveChainForTests } from '../src/live/useNapsterSession';
import { toast } from '../src/ui';

// Task 28 (experiment): on a portrait phone the avatar frame can be taller than the 16:9 stream. The video then
// COVERS the frame, which crops only its left and right sides (never zooms past the full height). Long-press the frame
// to cycle 16:9 -> 1:1 -> 4:5 -> 3:4; the choice persists. Landscape and tablets keep the 16:9 contain frame.

function harness() {
  const h = { cb: null as (LiveCallbacks & { mountContainer: HTMLElement }) | null };
  const inst = { destroy: vi.fn(() => h.cb?.onDestroy?.()), sendCommand: vi.fn(), muteMic: vi.fn(), unmuteMic: vi.fn(), setAudioVolume: vi.fn() };
  const sdk: LiveSdk = {
    init: vi.fn(async (_gt, opts) => {
      h.cb = opts;
      return inst;
    }),
  };
  const request = vi.fn(async (path: string) => (path.endsWith('/context') ? { systemMessage: 'CTX' } : {}));
  return { h, sdk, request };
}

async function mount() {
  const t = harness();
  render(
    <LiveSession
      mode="child"
      avatarId="a1"
      childId="c1"
      reason="missing_parent"
      childName="Mia"
      caregiverName="Ms. Jess"
      parentTitle="Mom"
      onDone={vi.fn()}
      sdk={t.sdk}
      request={t.request}
      start={vi.fn(async () => ({ sessionId: 's1', token: 't1' }))}
    />,
  );
  await act(async () => {});
  return t;
}

const hero = () => screen.getByTestId('live-hero');
const frame = () => hero().querySelector('.live-frame') as HTMLElement;
const css = readFileSync(resolve(__dirname, '../src/theme/global.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  expect(i, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
};

const realMatchMedia = window.matchMedia;
const mockMedia = (match: (q: string) => boolean) => {
  window.matchMedia = ((q: string) => ({ ...realMatchMedia(q), media: q, matches: match(q) })) as typeof window.matchMedia;
};

beforeEach(() => {
  __resetLiveChainForTests();
  localStorage.clear();
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  toast.clear();
});

describe('frame modes: cycle and persistence', () => {
  it('cycles 16:9 -> 1:1 -> 4:5 -> 3:4 -> 16:9; the experiment build defaults to 4:5', () => {
    expect(FRAME_MODES).toEqual(['16:9', '1:1', '4:5', '3:4']);
    expect(DEFAULT_FRAME_MODE).toBe('4:5');
    expect(nextFrameMode('16:9')).toBe('1:1');
    expect(nextFrameMode('1:1')).toBe('4:5');
    expect(nextFrameMode('4:5')).toBe('3:4');
    expect(nextFrameMode('3:4')).toBe('16:9');
    expect(LONG_PRESS_MS).toBe(600);
  });

  it('loads the default when nothing (or junk) is stored, and round-trips a saved mode', () => {
    expect(loadFrameMode()).toBe('4:5');
    localStorage.setItem(FRAME_MODE_KEY, '21:9');
    expect(loadFrameMode()).toBe('4:5');
    saveFrameMode('3:4');
    expect(localStorage.getItem(FRAME_MODE_KEY)).toBe('3:4');
    expect(loadFrameMode()).toBe('3:4');
  });

  it('storage that throws never breaks the call screen', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadFrameMode()).toBe('4:5');
    expect(() => saveFrameMode('1:1')).not.toThrow();
  });

  it('cropAspect: a mode aspect only on a portrait phone, never for 16:9', () => {
    expect(cropAspect('1:1', true)).toBe(1);
    expect(cropAspect('4:5', true)).toBe(0.8);
    expect(cropAspect('3:4', true)).toBe(0.75);
    expect(cropAspect('16:9', true)).toBeNull();
    expect(cropAspect('4:5', false)).toBeNull();
  });
});

describe('the live frame per mode (portrait phone)', () => {
  it('defaults to a 4:5 cropped frame with no intrinsic-width cap', async () => {
    await mount();
    expect(hero()).toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe('0.8');
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('');
  });

  it.each([
    ['1:1', '1'],
    ['4:5', '0.8'],
    ['3:4', '0.75'],
  ])('%s: crop class and aspect %s', async (mode, aspect) => {
    localStorage.setItem(FRAME_MODE_KEY, mode);
    await mount();
    expect(hero()).toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', mode);
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(aspect);
  });

  it('16:9 is the fitted contain frame: video aspect and the intrinsic-width cap', async () => {
    localStorage.setItem(FRAME_MODE_KEY, '16:9');
    await mount();
    expect(hero()).not.toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '16:9');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('1280px');
  });
});

describe('portrait phones only', () => {
  it('landscape keeps the 16:9 contain frame whatever the stored mode', async () => {
    localStorage.setItem(FRAME_MODE_KEY, '3:4');
    mockMedia((q) => q.includes('landscape'));
    await mount();
    expect(hero()).not.toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '16:9');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('1280px');
  });

  it('a tablet (min-width 700px) in portrait keeps the 16:9 contain frame', async () => {
    localStorage.setItem(FRAME_MODE_KEY, '1:1');
    mockMedia((q) => q.includes('min-width: 700px'));
    await mount();
    expect(hero()).not.toHaveClass('is-crop');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
  });

  it('long-press does nothing in landscape (no hidden mode change, no toast)', async () => {
    mockMedia((q) => q.includes('landscape'));
    await mount();
    const info = vi.spyOn(toast, 'info');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 100));
    expect(info).not.toHaveBeenCalled();
    expect(localStorage.getItem(FRAME_MODE_KEY)).toBeNull();
  });
});

describe('long-press the frame to switch modes', () => {
  it('about 600 ms cycles to the next mode, persists it and shows a toast', async () => {
    await mount();
    const info = vi.spyOn(toast, 'info');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    act(() => vi.advanceTimersByTime(1));
    expect(hero()).toHaveAttribute('data-frame-mode', '3:4');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe('0.75');
    expect(localStorage.getItem(FRAME_MODE_KEY)).toBe('3:4');
    expect(info).toHaveBeenCalledWith('Frame 3:4', expect.anything());
    fireEvent.pointerUp(frame());
    // Holding on does not keep cycling; the next long-press goes on to 16:9 (the contain frame).
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(hero()).toHaveAttribute('data-frame-mode', '16:9');
    expect(hero()).not.toHaveClass('is-crop');
    expect(info).toHaveBeenLastCalledWith('Frame 16:9', expect.anything());
  });

  it('a short tap does nothing', async () => {
    await mount();
    const info = vi.spyOn(toast, 'info');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(frame());
    act(() => vi.advanceTimersByTime(2000));
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    expect(info).not.toHaveBeenCalled();
  });

  it('moving the finger, or the pointer being cancelled, aborts the long-press', async () => {
    await mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(frame(), { clientX: 100, clientY: 130 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(frame());
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
  });

  it('a long-press on a dock button never switches the frame', async () => {
    await mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const mute = screen.getByRole('button', { name: /microphone/i });
    fireEvent.pointerDown(mute, { clientX: 10, clientY: 700 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
  });

  it("the frame suppresses the context menu (Android's long-press menu)", async () => {
    await mount();
    expect(fireEvent.contextMenu(frame())).toBe(false);
  });

  it('CSS: the frame is not selectable and has no touch callout', () => {
    const f = rule('.live-frame');
    expect(f).toMatch(/user-select:\s*none/);
    expect(f).toMatch(/-webkit-user-select:\s*none/);
    expect(f).toMatch(/-webkit-touch-callout:\s*none/);
  });
});

describe('crop CSS', () => {
  it('a crop frame fills the stage at its own aspect, without the intrinsic-width cap', () => {
    const r = rule('.live-hero.is-crop');
    expect(r).toMatch(/width:\s*min\(100cqw,\s*calc\(100cqh \* var\(--live-aspect/);
    expect(r).not.toMatch(/--live-video-w/);
  });

  it('only a crop frame covers: the video fills it, cropped left and right, face kept', () => {
    const r = rule('.live-hero.is-crop .et-avatar-host video.np_companion-avatar-video,\n.live-hero.is-crop .et-avatar-host canvas.np_companion-avatar-canvas');
    expect(r).toMatch(/object-fit:\s*cover/);
    expect(r).toMatch(/object-position:\s*50% 35%/);
    const covers = css.match(/[^{}]*\{[^}]*object-fit:\s*cover[^}]*\}/g) ?? [];
    for (const c of covers.filter((c) => /et-avatar-host|\.live-/.test(c))) expect(c).toMatch(/\.live-hero\.is-crop/);
  });
});

describe('the mic-permission stage is not affected', () => {
  it('while the SDK asks for the mic the hero is not cropped and long-press is off; the crop returns after', async () => {
    const { h } = await mount();
    expect(hero()).toHaveClass('is-crop');
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
    });
    expect(screen.getByTestId('live-stage')).toHaveClass('is-permission');
    expect(hero()).not.toHaveClass('is-crop');
    const info = vi.spyOn(toast, 'info');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(info).not.toHaveBeenCalled();
    vi.useRealTimers();
    await act(async () => {
      h.cb!.onSessionStatusChange?.('loading');
    });
    expect(screen.getByTestId('live-stage')).not.toHaveClass('is-permission');
    expect(hero()).toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
  });

  it('CSS: permission mode still lifts the hero and frame out (static), whatever the crop', () => {
    expect(rule('.live-stage.is-permission .live-hero')).toMatch(/position:\s*static/);
    expect(rule('.live-stage.is-permission .live-frame')).toMatch(/position:\s*static/);
  });
});
