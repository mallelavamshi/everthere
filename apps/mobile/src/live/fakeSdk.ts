import { ApiError, friendlyMessage, type ApiCode } from '../lib/api';
import { colors } from '../theme/tokens';
import type { LiveEvent } from './events';
import type { MicCheck } from './micPreflight';
import type { LiveCallbacks, LiveCommand, LiveInstance, LiveSdk } from './sdk';
import type { LiveRequest, StartResult } from './useNapsterSession';

// DEV ONLY. Loaded through `import.meta.env.DEV ? () => import('./fakeSdk') : null` with `?fake=1`, so production
// builds never contain it. It replays the real frame shapes from docs/notes/napster-events.md so the live screen
// can be screenshotted and tested without spending Napster minutes.

export type FakeScenario = 'connecting' | 'captions' | 'long' | 'flag' | 'wobbly' | 'credits' | 'mic' | 'micPending' | 'busy' | 'resting' | 'active' | 'network';

const START_ERRORS: Partial<Record<FakeScenario, ApiCode>> = { busy: 'AVATARS_BUSY', resting: 'RESTING', active: 'SESSION_ACTIVE', network: 'NETWORK' };

export const FAKE_MARKER = 'everthere-fake-napster';

export interface FakeKit {
  sdk: LiveSdk;
  start: () => Promise<StartResult>;
  request: LiveRequest;
  /** The mic pre-flight: never prompts (the mic scenarios simulate the SDK's own permission statuses). */
  micCheck: () => Promise<MicCheck>;
  /** Every command the screen sent, for inspection in the console (`window.__fakeLive`). */
  sent: LiveCommand[];
}

const ts = () => new Date().toISOString();
const msg = (message: Record<string, unknown>): LiveEvent => ({ event: 'message_received', data: { message: { is_forced: false, timestamp: ts(), ...message } } });

/** The assistant frames for one spoken line: response created, item created, word deltas, item completed, response completed. */
function assistantLine(text: string, n: number, t0: number, step = 140): Array<[number, LiveEvent]> {
  const response_id = `resp_fake${n}`;
  const item_id = `item_fakeA${n}`;
  const out: Array<[number, LiveEvent]> = [
    [t0, msg({ action: 'created', role: 'assistant', response_id })],
    [t0 + 10, msg({ action: 'created', type: 'message', role: 'assistant', response_id, item_id })],
    [t0 + 20, { event: 'talk_state_changed', data: { talk_id: item_id, state: 'preparing' } }],
  ];
  const words = text.split(/(?<= )/);
  words.forEach((w, i) => out.push([t0 + 60 + i * step, msg({ action: 'delta', type: 'message', role: 'assistant', response_id, item_id, content: w, content_index: 0, emotion: 'neutral' })]));
  const done = t0 + 80 + words.length * step;
  out.push([t0 + 70, { event: 'talk_state_changed', data: { talk_id: item_id, state: 'started', sentence_index: null, is_forced: false } }]);
  out.push([done, msg({ action: 'completed', type: 'message', role: 'assistant', response_id, item_id, content: text, emotion: 'neutral' })]);
  out.push([done + 10, msg({ action: 'completed', role: 'assistant', response_id, usage: { input_tokens: 1422, output_tokens: 76, total_tokens: 1498 } })]);
  out.push([done + 300, { event: 'talk_state_changed', data: { talk_id: item_id, state: 'ended', sentence_index: null } }]);
  return out;
}

function userLine(text: string, n: number, t0: number): Array<[number, LiveEvent]> {
  const item_id = `item_fakeU${n}`;
  return [
    [t0, msg({ action: 'created', type: 'message', role: 'user', item_id, content: text, previous_item_id: 'item_prev' })],
    [t0 + 20, msg({ action: 'completed', type: 'message', role: 'user', item_id, content: text, previous_item_id: 'item_prev' })],
  ];
}

/** A 16:9 "video frame" like Napster's landscape stream: a seated parent, face in the upper third, room behind. */
function fakeFrame(): HTMLCanvasElement | undefined {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = c.getContext('2d');
  } catch {
    return undefined; // jsdom
  }
  if (!g) return undefined;
  const bg = g.createLinearGradient(0, 0, 0, 720);
  bg.addColorStop(0, colors.sunsetGlow);
  bg.addColorStop(1, colors.sunsetPeach);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1280, 720);
  g.fillStyle = colors.lilac; // a sofa / wall band
  g.fillRect(0, 430, 1280, 290);
  g.fillStyle = colors.sun; // shoulders
  g.beginPath();
  g.ellipse(640, 760, 300, 260, 0, Math.PI, 0);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '300px serif';
  g.fillText('👩🏽', 640, 300);
  return c;
}

/** The SDK's mic-permission card (2.0.0 bundle, function `Ae`), appended to the root like the SDK does. */
function fakeMicCard(root: HTMLElement, state: 'pending' | 'blocked') {
  const copy = {
    pending: { heading: 'Allow microphone access', subheading: 'In the browser pop-up, click the Allow button.' },
    blocked: { heading: 'Microphone access is blocked', subheading: 'Enable microphone access in your browser’s site settings.', primary: 'Check again' },
  } as const;
  const c = document.createElement('div');
  c.setAttribute('role', 'dialog');
  c.tabIndex = -1;
  c.className = 'np_companion-mic-permission np_companion-view-rectangle';
  const card = document.createElement('div');
  card.className = 'np_companion-mic-permission-card';
  const h = document.createElement('h2');
  h.className = 'np_companion-mic-permission-heading';
  h.id = 'np_companion-mic-permission-heading';
  c.setAttribute('aria-labelledby', h.id);
  const p = document.createElement('p');
  p.className = 'np_companion-mic-permission-subheading';
  const actions = document.createElement('div');
  actions.className = 'np_companion-mic-permission-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'np_companion-mic-permission-primary';
  actions.appendChild(btn);
  const live = document.createElement('div');
  live.className = 'np_companion-mic-permission-live';
  card.append(h, p, actions, live);
  const wrap = document.createElement('div');
  wrap.className = 'np_companion-mic-permission-wrap';
  wrap.appendChild(card);
  c.appendChild(wrap);
  root.appendChild(c);
  const setState = (s: 'pending' | 'blocked') => {
    const t = copy[s];
    h.textContent = t.heading;
    p.textContent = t.subheading;
    actions.hidden = !('primary' in t);
    btn.textContent = 'primary' in t ? t.primary : '';
    c.dataset.state = s;
    live.textContent = `${t.heading}. ${t.subheading}`;
  };
  setState(state);
  return { setState };
}

/** The SDK's DOM for an inline rectangle view (2.0.0 bundle), with the fake frame as the video's poster. */
function fakeSdkDom(): HTMLElement {
  const el = (tag: string, cls: string, id?: string) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (id) n.id = id;
    return n;
  };
  const root = el('div', 'np_companion-align-middle np_companion-container-inline np_companion-view-rectangle', 'np_companion-sdk-root');
  root.setAttribute('aria-label', 'Avatar preview (fake)');
  const live = el('div', 'np_companion-live-container np_companion-fade-in');
  const avatar = el('div', 'np_companion-avatar');
  const wrap = el('div', 'np_companion-avatar-wrap np_companion-view-rectangle');
  const box = el('div', 'np_companion-avatar-container np_companion-view-rectangle np_companion-status-ready-video', 'np_companion-avatar-container');
  const loader = el('div', 'loader-container');
  loader.appendChild(el('div', 'loader'));
  const media = el('div', 'np_companion-avatar-media');
  const video = el('video', 'np_companion-avatar-video') as HTMLVideoElement;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // A real 1280x720 stream (canvas.captureStream), so the <video> reports videoWidth/videoHeight like Napster's.
  const frame = fakeFrame();
  if (frame) {
    try {
      video.poster = frame.toDataURL('image/png');
      const stream = frame.captureStream?.(1);
      if (stream) {
        video.srcObject = stream;
        // Repaint so the captured track always has a frame (a static canvas may otherwise emit none).
        const g = frame.getContext('2d');
        const t = setInterval(() => (video.isConnected ? g?.fillRect(0, 0, 1, 1) : clearInterval(t)), 500);
        void video.play().catch(() => {});
      }
    } catch {
      /* poster only */
    }
  }
  media.append(video, el('canvas', 'np_companion-avatar-canvas np_companion__d-none'));
  const bubble = el('div', 'np_companion-photo-bubble np_companion-loading-photo-bubble');
  bubble.appendChild(el('div', 'np_companion-photo-bubble-inner'));
  box.append(loader, media, el('audio', 'np_companion-avatar-audio'), el('div', 'np_companion-placeholder-bg'), bubble);
  wrap.appendChild(box);
  avatar.appendChild(wrap);
  live.appendChild(avatar);
  root.appendChild(live);
  return root;
}

export function createFakeKit(scenario: FakeScenario = 'flag'): FakeKit {
  const sent: LiveCommand[] = [];
  let seq = 0;

  const start = async (): Promise<StartResult> => {
    await new Promise((r) => setTimeout(r, 350));
    const code = START_ERRORS[scenario];
    if (code) throw new ApiError(code, friendlyMessage(code), code === 'SESSION_ACTIVE' ? 409 : code === 'NETWORK' ? 0 : 503);
    seq += 1;
    return { sessionId: `fake_session_${seq}`, token: `fake_token_${seq}` };
  };

  const request: LiveRequest = async (path) => {
    await new Promise((r) => setTimeout(r, 120));
    if (path.endsWith('/context')) return { systemMessage: '(fake) You are a loving parent comforting your child at daycare.' };
    if (path.endsWith('/flags')) return { id: 'fake_flag' };
    return {};
  };

  const sdk: LiveSdk = {
    async init(getToken, opts) {
      const cb: LiveCallbacks = opts;
      const timers: ReturnType<typeof setTimeout>[] = [];
      let destroyed = false;
      const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => !destroyed && fn(), ms));
      const play = (frames: Array<[number, LiveEvent]>, offset = 0) => frames.forEach(([ms, f]) => at(offset + ms, () => cb.onData?.(f)));

      // The "avatar": the SDK's own DOM shape (2.0.0 bundle) inside the real mount container, with a 16:9 picture as
      // the video, so the hero's CSS (global.css, `.et-avatar-host`) is exercised exactly as on a device (P-3).
      const view = fakeSdkDom();
      view.dataset.fake = FAKE_MARKER;
      // The video fades in when ready; the root itself stays visible (the SDK's permission card lives in it).
      const liveBox = view.querySelector<HTMLElement>('.np_companion-live-container')!;
      Object.assign(liveBox.style, { opacity: '0', transition: 'opacity 600ms ease' });
      opts.mountContainer.appendChild(view);

      let replyAfterFlag: (() => void) | null = null;
      const instance: LiveInstance = {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          timers.forEach(clearTimeout);
          view.remove();
          cb.onSessionStatusChange?.('entry');
          cb.onAvatarReady?.(false);
          cb.onDestroy?.();
        },
        sendCommand(cmd) {
          sent.push(cmd);
          console.debug('[fake napster] sendCommand', cmd);
          if (cmd.type === 'send_function_output') {
            play([[0, msg({ action: 'created', type: 'function_call_output', item_id: 'item_fakeOut', content: JSON.stringify(cmd.data.output), call_id: cmd.data.call_id })]]);
            replyAfterFlag?.();
            replyAfterFlag = null;
          }
          if (cmd.type === 'send_message' && cmd.data.trigger_response) play(assistantLine('You are my sunshine, my only sunshine… 🎵', ++seq, 300));
        },
        muteMic: () => console.debug('[fake napster] muteMic'),
        unmuteMic: () => console.debug('[fake napster] unmuteMic'),
        setAudioVolume: (v) => console.debug('[fake napster] volume', v),
        keepAlive: () => console.debug('[fake napster] keepAlive'),
      };

      // Lifecycle order observed on device (notes section 3).
      at(50, () => cb.onSessionStatusChange?.('loading'));
      if (scenario === 'mic' || scenario === 'micPending') {
        // As the SDK does: after 500 ms without an answer it shows its card in the root and reports permissionPending.
        let card: ReturnType<typeof fakeMicCard> | null = null;
        at(500, () => {
          card = fakeMicCard(view, 'pending');
          cb.onSessionStatusChange?.('permissionPending');
        });
        // "mic": the child's grown-up said no. "micPending": the system dialog stays up (screenshots).
        if (scenario === 'mic')
          at(1200, () => {
            card?.setState('blocked');
            cb.onSessionStatusChange?.('permissionBlocked');
          });
        return instance;
      }
      at(250, () => {
        getToken().then(
          () => {
            if (scenario === 'connecting') {
              play([[100, { event: 'avatar_state_changed', data: { state: 'preparing', timestamp: ts(), details: { stage: 'downloading', progress: 42 } } }]]);
              return;
            }
            play([
              [100, { event: 'avatar_state_changed', data: { state: 'preparing', timestamp: ts() } }],
              [400, { event: 'avatar_state_changed', data: { state: 'preparing', timestamp: ts(), details: { stage: 'initializing' } } }],
              [900, { event: 'avatar_state_changed', data: { state: 'ready', timestamp: ts(), details: { mode: 'audio_video', video_type: 'hd' } } }],
            ]);
            at(1000, () => {
              liveBox.style.opacity = '1';
              cb.onSessionStatusChange?.('readyVideo');
              cb.onAvatarReady?.(true);
              play([[0, msg({ action: 'created', type: 'session', session: { id: 'sess_fake' } })]]);
              play(assistantLine('Hey Sunshine! Is Bunny sleepy too? 🐰', 1, 300));
              if (scenario === 'wobbly') at(2500, () => cb.onData?.({ event: 'avatar_connection_warning', data: { disconnect_after: 30 } }));
              if (scenario === 'credits') at(2500, () => cb.onData?.({ event: 'no_credits_left', data: null }));
              if (scenario === 'flag' || scenario === 'captions' || scenario === 'long') {
                play(userLine('I fell and hurt my knee', 1, 2400));
                if (scenario === 'flag') {
                  play(
                    [
                      [0, msg({ action: 'created', type: 'function_call', response_id: 'resp_fakeF', item_id: 'item_fakeF', call_id: 'call_fake1' })],
                      [
                        40,
                        msg({
                          action: 'completed', type: 'function_call', response_id: 'resp_fakeF', item_id: 'item_fakeF', call_id: 'call_fake1', tool: 'flag_concern',
                          content: '{  \n  "category": "injury", \n  "quote": "I fell and hurt my knee",  \n  "severity": "low" \n} \n',
                        }),
                      ],
                      [
                        60,
                        {
                          event: 'function_implicitly_called',
                          data: {
                            item_id: 'item_fakeF', call_id: 'call_fake1', name: 'flag_concern',
                            arguments: { category: 'injury', quote: 'I fell and hurt my knee', severity: 'low' },
                            metadata: { tags: null, external_client_id: 'fake', external_client_profile: null },
                          },
                        },
                      ],
                    ],
                    2700,
                  );
                  replyAfterFlag = () => play(assistantLine("Oh no, I'm sorry your knee hurts. Let's ask Ms. Jess for a big cuddle 💛", 2, 300));
                } else if (scenario === 'long') {
                  play(assistantLine("Oh no, sweetheart, I'm so sorry your knee hurts. You were so brave. Let's ask Ms. Jess for a big cuddle and a cold cloth, and then maybe Bunny can sit with you while it feels better 💛", 2, 2800, 70));
                } else {
                  play(assistantLine("Oh no, I'm sorry your knee hurts. Let's ask Ms. Jess for a big cuddle 💛", 2, 2800));
                }
              }
            });
          },
          // The real SDK tears itself down when getToken fails (failToMintToken), then reports onError.
          (e) => {
            instance.destroy();
            cb.onError?.(Object.assign(new Error(String(e?.message ?? e)), { code: 'TOKEN_ERROR' }));
          },
        );
      });
      return instance;
    },
  };

  const kit: FakeKit = { sdk, start, request, sent, micCheck: async () => 'granted' };
  if (typeof window !== 'undefined') (window as unknown as { __fakeLive?: FakeKit }).__fakeLive = kit;
  return kit;
}
