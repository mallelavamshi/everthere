import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })), exitApp: vi.fn() },
}));

import { LiveSession } from '../src/live/LiveSession';
import { PHONE_FRAME, cropAspect } from '../src/live/frameMode';
import type { LiveCallbacks, LiveSdk } from '../src/live/sdk';
import { __resetLiveChainForTests } from '../src/live/useNapsterSession';
import { toast } from '../src/ui';

// Task 28/31: on a portrait phone the avatar frame is 4:5, taller than the 16:9 stream. The video COVERS the frame,
// which crops only its left and right sides (never zooms past the full height). The user tried 16:9, 1:1, 4:5 and 3:4
// on their phone and kept 4:5, so the long-press switcher is gone. Landscape and tablets keep the 16:9 contain frame.

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

describe('the phone frame is 4:5', () => {
  it('cropAspect: 4:5 on a portrait phone, else the contain frame', () => {
    expect(PHONE_FRAME).toBe('4:5');
    expect(cropAspect(true)).toBe(0.8);
    expect(cropAspect(false)).toBeNull();
  });

  it('a portrait phone gets the 4:5 cropped frame with no intrinsic-width cap, whatever an old build stored', async () => {
    localStorage.setItem('everthere.liveFrameMode', '16:9');
    await mount();
    expect(hero()).toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe('0.8');
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('');
  });
});

describe('portrait phones only', () => {
  it('landscape keeps the 16:9 contain frame', async () => {
    mockMedia((q) => q.includes('landscape'));
    await mount();
    expect(hero()).not.toHaveClass('is-crop');
    expect(hero()).toHaveAttribute('data-frame-mode', '16:9');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('1280px');
  });

  it('a tablet (min-width 700px) in portrait keeps the 16:9 contain frame', async () => {
    mockMedia((q) => q.includes('min-width: 700px'));
    await mount();
    expect(hero()).not.toHaveClass('is-crop');
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
  });
});

describe('no hidden frame switcher', () => {
  it('a long press on the frame changes nothing and shows no toast', async () => {
    await mount();
    const info = vi.spyOn(toast, 'info');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(frame(), { clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.pointerUp(frame());
    expect(hero()).toHaveAttribute('data-frame-mode', '4:5');
    expect(info).not.toHaveBeenCalled();
  });

  it('CSS: the frame is not selectable, has no touch callout, and does not block touches', () => {
    const f = rule('.live-frame');
    expect(f).toMatch(/user-select:\s*none/);
    expect(f).toMatch(/-webkit-touch-callout:\s*none/);
    expect(f).not.toMatch(/touch-action/);
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
  it('while the SDK asks for the mic the hero is not cropped; the crop returns after', async () => {
    const { h } = await mount();
    expect(hero()).toHaveClass('is-crop');
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
    });
    expect(screen.getByTestId('live-stage')).toHaveClass('is-permission');
    expect(hero()).not.toHaveClass('is-crop');
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
