import { act, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })), exitApp: vi.fn() },
}));

import { LiveSession, type LiveSessionProps } from '../src/live/LiveSession';
import { Captions } from '../src/live/parts/Captions';
import type { LiveCallbacks, LiveSdk } from '../src/live/sdk';
import { __resetLiveChainForTests } from '../src/live/useNapsterSession';
import { TRANSPARENT_POSTER, videoFrame } from '../src/live/videoFrame';

// Device test P-3 (as re-specified): the avatar frame takes the VIDEO's own aspect ratio (16:9 until the SDK's
// <video> reports its size), tight around it, never wider than the video's intrinsic width. P-6: captions never
// overlap the controls. P-5: no empty bubble. P-7: the call length handed back is the live time, or the server's.

function harness(endBody: unknown = {}) {
  const h = { cb: null as (LiveCallbacks & { mountContainer: HTMLElement }) | null, getToken: null as null | (() => Promise<string>) };
  const inst = { destroy: vi.fn(() => h.cb?.onDestroy?.()), sendCommand: vi.fn(), muteMic: vi.fn(), unmuteMic: vi.fn(), setAudioVolume: vi.fn() };
  const sdk: LiveSdk = {
    init: vi.fn(async (gt, opts) => {
      h.getToken = gt;
      h.cb = opts;
      return inst;
    }),
  };
  const request = vi.fn(async (path: string) => (path.endsWith('/context') ? { systemMessage: 'CTX' } : path.endsWith('/end') ? endBody : {}));
  return { h, inst, sdk, request };
}

async function mount(over: Partial<LiveSessionProps> = {}, endBody?: unknown) {
  const t = harness(endBody);
  const onDone = vi.fn();
  render(
    <LiveSession
      mode="child"
      avatarId="a1"
      childId="c1"
      reason="missing_parent"
      childName="Mia"
      caregiverName="Ms. Jess"
      parentTitle="Mom"
      onDone={onDone}
      sdk={t.sdk}
      request={t.request}
      start={vi.fn(async () => ({ sessionId: 's1', token: 't1' }))}
      {...over}
    />,
  );
  await act(async () => {});
  return { ...t, onDone };
}

const goLive = async (h: ReturnType<typeof harness>['h']) => {
  await act(async () => {
    await h.getToken!();
  });
  await act(async () => {
    h.cb!.onAvatarReady?.(true);
  });
};

/** What the SDK appends: its wrappers and a <video class="np_companion-avatar-video"> (2.0.0 bundle). */
function sdkVideo(container: HTMLElement): HTMLVideoElement {
  const media = document.createElement('div');
  media.className = 'np_companion-avatar-media';
  const v = document.createElement('video');
  v.className = 'np_companion-avatar-video';
  media.appendChild(v);
  container.appendChild(media);
  return v;
}
const reportSize = (v: HTMLVideoElement, w: number, h: number) => {
  Object.defineProperty(v, 'videoWidth', { configurable: true, get: () => w });
  Object.defineProperty(v, 'videoHeight', { configurable: true, get: () => h });
  v.dispatchEvent(new Event('loadedmetadata'));
};

const hero = () => screen.getByTestId('live-hero');
const css = readFileSync(resolve(__dirname, '../src/theme/global.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  expect(i, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
};

const realMatchMedia = window.matchMedia;
beforeEach(() => {
  __resetLiveChainForTests();
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

describe('videoFrame', () => {
  it('defaults to 16:9 and 1280 px; follows a reported size; ignores a zero size', () => {
    expect(videoFrame()).toEqual({ aspect: 16 / 9, maxWidth: 1280 });
    expect(videoFrame(960, 720)).toEqual({ aspect: 4 / 3, maxWidth: 960 });
    expect(videoFrame(0, 0)).toEqual({ aspect: 16 / 9, maxWidth: 1280 });
  });
});

// A portrait phone gets the 4:5 crop frame (liveFrameMode.test.tsx); on a tablet these cover the 16:9 contain frame.
describe('live avatar frame (P-3)', () => {
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ ...realMatchMedia(q), media: q, matches: q.includes('min-width: 700px') })) as typeof window.matchMedia;
  });

  it('is 16:9 until the video reports its size, then takes the real aspect and caps at its intrinsic width', async () => {
    const { h } = await mount();
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('1280px');
    await goLive(h);
    const v = sdkVideo(h.cb!.mountContainer);
    await act(async () => {
      reportSize(v, 960, 720);
    });
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(4 / 3));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('960px');
  });

  it('a video that already has metadata when it appears is read at once', async () => {
    const { h } = await mount();
    await goLive(h);
    const v = document.createElement('video');
    v.className = 'np_companion-avatar-video';
    Object.defineProperty(v, 'videoWidth', { get: () => 1280 });
    Object.defineProperty(v, 'videoHeight', { get: () => 720 });
    await act(async () => {
      h.cb!.mountContainer.appendChild(v);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hero().style.getPropertyValue('--live-aspect')).toBe(String(16 / 9));
    expect(hero().style.getPropertyValue('--live-video-w')).toBe('1280px');
  });

  it('CSS: the hero is sized from the stage (container units) at the video aspect; the video is contained, cropped only in a crop mode', () => {
    const h = rule('.live-hero');
    expect(h).toMatch(/aspect-ratio:\s*var\(--live-aspect/);
    expect(h).toMatch(/width:\s*min\(100cqw,\s*calc\(100cqh \* var\(--live-aspect/);
    expect(h).toMatch(/var\(--live-video-w/);
    expect(rule('.live-stage')).toMatch(/container-type:\s*size/);
    const video = rule('.et-avatar-host video.np_companion-avatar-video,\n.et-avatar-host canvas.np_companion-avatar-canvas');
    expect(video).toMatch(/object-fit:\s*contain/);
    expect(video).toMatch(/width:\s*100%/);
    expect(video).toMatch(/height:\s*100%/);
    // No cover on the call screen except in a task 28 crop mode (the Welcome hero, task 26c, may crop its own margins).
    const liveRules = css.match(/[^{}]*(et-avatar-host|\.live-)[^{}]*\{[^}]*\}/g) ?? [];
    expect(liveRules.length).toBeGreaterThan(5);
    for (const r of liveRules.filter((r) => !r.includes('.live-hero.is-crop'))) expect(r).not.toMatch(/object-fit:\s*cover/);
    // The SDK's wrappers fill the host, and its unstyled loading chrome (photo bubble, placeholder) is hidden.
    expect(css).toMatch(/\.et-avatar-host \.np_companion-live-container,[\s\S]*?\.et-avatar-host \.np_companion-avatar-media \{[^}]*inset:\s*0/);
    expect(css).toMatch(/\.et-avatar-host \.np_companion-loading-photo-bubble[^{]*\{[^}]*display:\s*none/);
  });
});

describe('captions and controls (P-6)', () => {
  it('portrait: captions sit in their own reserved area below the stage, outside the frame', async () => {
    await mount();
    const caps = screen.getByTestId('live-captions');
    expect(caps).toHaveClass('live-captions-below');
    expect(hero().contains(caps)).toBe(false);
    expect(screen.getByTestId('live-stage').contains(caps)).toBe(false);
    // Fix round 1: the band never clips the latest caption. It reserves a MINIMUM in em (so it scales with the
    // system font size, e.g. 1.3x), grows past it when it must, and the stage (flex 1 1 0, min-height 0) gives way.
    const below = rule('.live-captions-below');
    expect(below).toMatch(/min-height:\s*var\(--live-captions-h\)/);
    expect(below).not.toMatch(/overflow:\s*hidden/);
    expect(below).not.toMatch(/(^|[^-])height:\s*var/);
    expect(css).toMatch(/--live-captions-h:\s*[\d.]+em/);
    expect(rule('.live-stage')).toMatch(/flex:\s*1 1 0/);
    expect(rule('.live-stage')).toMatch(/min-height:\s*0/);
  });

  it('"Still there?" has its own slot on the stage, never inside the captions band (fix round 1)', async () => {
    const { h } = await mount();
    await goLive(h);
    await act(async () => {
      h.cb!.onInactivityStatusChange?.(true);
    });
    const btn = screen.getByRole('button', { name: /Still there\?/ });
    expect(screen.getByTestId('live-captions').contains(btn)).toBe(false);
    expect(screen.getByTestId('live-stage').contains(btn)).toBe(true);
    expect(btn.closest('[data-testid=live-still-there]')).not.toBeNull();
    expect(rule('.live-still-there')).toMatch(/position:\s*absolute/);
  });

  it('landscape: captions overlay the bottom of the frame, inside the stage', async () => {
    window.matchMedia = ((q: string) => ({ ...realMatchMedia(q), matches: q.includes('landscape') })) as typeof window.matchMedia;
    await mount();
    const caps = screen.getByTestId('live-captions');
    expect(caps).toHaveClass('live-captions-overlay');
    expect(hero().contains(caps)).toBe(true);
  });
});

describe('no empty caption bubble (P-5)', () => {
  it('Captions never draws a bubble for empty or whitespace-only text', () => {
    render(
      <Captions
        captions={[
          { id: 'a', role: 'avatar', text: 'Hello' },
          { id: 'b', role: 'child', text: ' \n ' },
          { id: 'c', role: 'child', text: '' },
        ]}
      />,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getAllByTestId('caption')).toHaveLength(1);
  });
});

describe('call length handed back (P-7)', () => {
  it("uses the server's durationS from POST /end when it has one", async () => {
    const { h, onDone } = await mount({}, { durationS: 118 });
    await goLive(h);
    await act(async () => {
      screen.getByRole('button', { name: 'End call' }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: /continue/i }).click();
    });
    expect(onDone).toHaveBeenCalledWith('s1', 118);
  });

  it('otherwise counts from when the call went live (not from tap or connect) to the end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const { h, onDone } = await mount({}, {});
    await act(async () => {
      await h.getToken!();
    });
    vi.setSystemTime(1_040_000); // 40 s on the mic prompt and connecting: not counted
    await act(async () => {
      h.cb!.onAvatarReady?.(true);
    });
    vi.setSystemTime(1_040_000 + 118_000);
    await act(async () => {
      screen.getByRole('button', { name: 'End call' }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: /continue/i }).click();
    });
    expect(onDone).toHaveBeenCalledWith('s1', 118);
  });
});

// Fix round 1, item 2. In the 2.0.0 bundle the mic-permission card is appended to #np_companion-sdk-root itself
// (a sibling of .np_companion-live-container): div.np_companion-mic-permission[role=dialog][data-state] >
// .np_companion-mic-permission-wrap > .np_companion-mic-permission-card > h2 heading, p subheading,
// div.actions > button.primary, div.live. Inside our small 16:9 frame it would be squeezed, so while the SDK asks for
// the mic the host is lifted out of the frame and the card is shown over the whole stage.
describe('SDK mic-permission card (fix round 1)', () => {
  it('while the SDK waits for the mic, the stage is in permission mode (card over the whole stage)', async () => {
    const { h } = await mount();
    expect(screen.getByTestId('live-stage')).not.toHaveClass('is-permission');
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
    });
    expect(screen.getByTestId('live-stage')).toHaveClass('is-permission');
    await act(async () => {
      h.cb!.onSessionStatusChange?.('loading');
    });
    expect(screen.getByTestId('live-stage')).not.toHaveClass('is-permission');
  });

  it('CSS: fill rules cover only the video wrappers; the root is not clipped; permission mode lifts the host to the stage', () => {
    const fill = css.match(/([^{}]*)\{[^}]*inset:\s*0;[^}]*overflow:\s*hidden;[^}]*\}/g)!.find((r) => r.includes('np_companion-avatar-media'))!;
    expect(fill).toBeDefined();
    expect(fill).not.toMatch(/np_companion-sdk-root/);
    expect(rule('.et-avatar-host #np_companion-sdk-root')).not.toMatch(/overflow/);
    expect(rule('.live-stage.is-permission .live-hero')).toMatch(/position:\s*static/);
    expect(rule('.live-stage.is-permission .live-frame')).toMatch(/position:\s*static/);
    const card = rule('.et-avatar-host .np_companion-mic-permission');
    expect(card).toMatch(/position:\s*absolute/);
    expect(card).toMatch(/inset:\s*0/);
    expect(rule('.et-avatar-host .np_companion-mic-permission-wrap')).toMatch(/max-width:\s*\d+px/);
  });

  it('the DEV fake ("micPending") renders the SDK card DOM in the root, pending, and keeps it up', async () => {
    vi.useFakeTimers();
    const { createFakeKit } = await import('../src/live/fakeSdk');
    const kit = createFakeKit('micPending');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const statuses: string[] = [];
    await kit.sdk.init(async () => 't', { mountContainer: host, onSessionStatusChange: (s) => statuses.push(s) });
    await vi.advanceTimersByTimeAsync(3000);
    const card = host.querySelector('#np_companion-sdk-root > .np_companion-mic-permission[role=dialog]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('data-state')).toBe('pending');
    expect(card!.querySelector('.np_companion-mic-permission-wrap > .np_companion-mic-permission-card > h2')!.textContent).toBe('Allow microphone access');
    expect(statuses).toEqual(['loading', 'permissionPending']);
    host.remove();
  });
});

describe('large system text: the controls dock (task 26c)', () => {
  it('circles are px-sized, every control shares the dock, and "Our song" reads "Song" on screen', async () => {
    await mount({ songTitle: 'You Are My Sunshine' });
    const dock = screen.getByRole('navigation', { name: 'Call controls' }).firstElementChild!;
    expect(dock).toHaveClass('live-dock');
    const buttons = [...dock.querySelectorAll('button')];
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      expect(b).toHaveClass('live-control');
      const [circle, label] = [...b.children] as [HTMLElement, HTMLElement];
      expect(circle.className).toMatch(/h-\[52px\] w-\[52px\]/);
      expect(circle.className).not.toMatch(/\bh-14\b|\bw-14\b/);
      expect(label).toHaveClass('live-control-label');
      // A truncated label is still discoverable: the full name is the button's title.
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    }
    const song = screen.getByRole('button', { name: 'Our song' });
    expect(song).toHaveTextContent('Song');
    expect(song).not.toHaveTextContent('Our song');
    expect(song).toHaveAttribute('title', 'Our song');
  });

  it('CSS: the dock is laid out in px only; labels stay on one line and end in an ellipsis', () => {
    const dock = rule('.live-dock');
    expect(dock).not.toMatch(/\d(rem|em)\b/);
    expect(dock).toMatch(/max-width:\s*\d+px/);
    const control = rule('.live-control');
    expect(control).toMatch(/flex:\s*1 1 0/);
    expect(control).toMatch(/min-width:\s*0/);
    const label = rule('.live-control-label');
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/overflow:\s*hidden/);
    expect(label).toMatch(/font-size:\s*13px/);
  });
});

describe('mic-permission state is clean (task 26c)', () => {
  it.each(['permissionPending', 'permissionBlocked'] as const)('%s: no "Calling…" under the card', async (status) => {
    const { h } = await mount();
    expect(screen.getByText('Calling Mom…')).toBeInTheDocument();
    await act(async () => {
      h.cb!.onSessionStatusChange?.(status);
    });
    expect(screen.queryByText('Calling Mom…')).toBeNull();
  });

  it('CSS: in permission mode the empty frame has no ring and no tint behind the card', () => {
    const frame = rule('.live-stage.is-permission .live-frame');
    expect(frame).toMatch(/background:\s*transparent/);
    expect(frame).toMatch(/box-shadow:\s*none/);
  });
});

describe('no Napster SDK leftovers in the frame (task 26c round 2)', () => {
  it('CSS: the SDK entry point, its own controls, disclaimer, question bar, tooltip and idle dialog are hidden', () => {
    const hidden = css.match(/([^{}]*)\{\s*display:\s*none !important;\s*\}/g)!.find((r) => r.includes('np_companion-entry-point'));
    expect(hidden, 'a display:none rule for the SDK chrome').toBeDefined();
    for (const cls of [
      'np_companion-entry-point',
      'np_companion-avatar-control-wrap',
      'np_companion-ctl-btn',
      'np_companion-disclaimer',
      'np_companion-chat-question-bar-container',
      'np_companion-tooltip',
      'np_companion-inactive-overlay',
    ]) {
      expect(hidden).toMatch(new RegExp(`\\.et-avatar-host [^,{]*\\.${cls}\\b`));
    }
    // The video itself is never hidden.
    expect(hidden).not.toMatch(/np_companion-avatar-video|np_companion-avatar-media|np_companion-live-container/);
  });

  const appendSdkVideo = async () => {
    const host = screen.getByTestId('avatar-container');
    const v = document.createElement('video');
    v.className = 'np_companion-avatar-video';
    v.setAttribute('poster', 'data:image/svg+xml;base64,AAAA');
    await act(async () => {
      host.appendChild(v);
      await Promise.resolve();
    });
    return v;
  };

  it("the SDK video's dark poster is replaced by a transparent one (no poster at all makes Android WebView draw its grey ▶ placeholder)", async () => {
    await mount();
    const v = await appendSdkVideo();
    expect(v.getAttribute('poster')).toBe(TRANSPARENT_POSTER);
    expect(TRANSPARENT_POSTER).toMatch(/^data:image\/gif;base64,/);
    expect(v.isConnected).toBe(true);
  });

  it('the video stays invisible (never display:none) until it is playing, then shows', async () => {
    await mount();
    const v = await appendSdkVideo();
    expect(v).toHaveAttribute('data-et-waiting');
    const waiting = rule('.et-avatar-host video[data-et-waiting]');
    expect(waiting).toMatch(/opacity:\s*0/);
    expect(waiting).not.toMatch(/display|visibility/);
    await act(async () => {
      v.dispatchEvent(new Event('playing'));
    });
    expect(v).not.toHaveAttribute('data-et-waiting');
  });

  it('loadeddata also reveals the video, and a video that already has data is shown at once', async () => {
    await mount();
    const v = await appendSdkVideo();
    await act(async () => {
      v.dispatchEvent(new Event('loadeddata'));
    });
    expect(v).not.toHaveAttribute('data-et-waiting');
    const host = screen.getByTestId('avatar-container');
    const ready = document.createElement('video');
    ready.className = 'np_companion-avatar-video';
    Object.defineProperty(ready, 'readyState', { configurable: true, get: () => 2 });
    await act(async () => {
      v.remove();
      host.appendChild(ready);
      await Promise.resolve();
    });
    expect(ready).not.toHaveAttribute('data-et-waiting');
  });
});

describe('caption whitespace (task 26c round 2)', () => {
  it('blank lines and whitespace runs in a caption collapse to single spaces', () => {
    render(<Captions captions={[{ id: 'a1', role: 'avatar', text: 'Here we go:\n\n  Twinkle, twinkle,\n little   star' }]} />);
    expect(screen.getByTestId('caption').textContent).toBe('Here we go: Twinkle, twinkle, little star');
  });
});

describe("dialing shows the parent's face (task 31)", () => {
  const PHOTO = 'https://media.example/m/avatar.png?sig=1';
  const face = () => screen.queryByTestId('live-dialing-face');
  const appendVideo = async () => {
    const v = document.createElement('video');
    v.className = 'np_companion-avatar-video';
    await act(async () => {
      screen.getByTestId('avatar-container').appendChild(v);
      await Promise.resolve();
    });
    return v;
  };

  it('while connecting, the frame shows the parent photo with "Calling Mom…"', async () => {
    await mount({ parentPhotoUrl: PHOTO });
    expect(face()).toHaveAttribute('src', PHOTO);
    expect(screen.getByText('Calling Mom…')).toBeInTheDocument();
  });

  it('the face stays after the avatar is ready, until the video is actually playing (no blank frame)', async () => {
    const { h } = await mount({ parentPhotoUrl: PHOTO });
    const v = await appendVideo();
    await goLive(h);
    expect(screen.getByTestId('live-session').dataset.state).toBe('live');
    expect(face()).not.toBeNull();
    await act(async () => {
      v.dispatchEvent(new Event('playing'));
    });
    // It fades out (framer exit), then is gone.
    await waitFor(() => expect(face()).toBeNull());
  });

  it('without a photo, or when it fails to load, the spinner shows instead', async () => {
    await mount();
    expect(face()).toBeNull();
    expect(screen.getByText('Calling Mom…')).toBeInTheDocument();
  });

  it('an image error falls back quietly to the spinner', async () => {
    await mount({ parentPhotoUrl: PHOTO });
    await act(async () => {
      face()!.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(face()).toBeNull());
    expect(screen.getByText('Calling Mom…')).toBeInTheDocument();
  });

  it('never under the SDK mic card', async () => {
    const { h } = await mount({ parentPhotoUrl: PHOTO });
    await act(async () => {
      h.cb!.onSessionStatusChange?.('permissionPending');
    });
    await waitFor(() => expect(face()).toBeNull());
  });
});
