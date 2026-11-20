import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion as fm } from 'framer-motion';
import clsx from 'clsx';
import type { Reason } from '@everthere/shared';
import { api } from '../lib/api';
import { haptics, useStatusBar } from '../lib/native';
import { gradients } from '../theme/tokens';
import { Button, Spinner, toast } from '../ui';
import { Captions } from './parts/Captions';
import { Control, Pill } from './parts/Controls';
import { EndCard, FullScreen, LiveError } from './parts/FullScreens';
import { FlagSheet, VolumeSheet } from './parts/Sheets';
import type { LiveSdk } from './sdk';
import { useNapsterSession, type LiveRequest, type StartResult, type UseNapsterSessionOptions } from './useNapsterSession';
import { cropAspect, useFrameMode, useLongPress, usePortraitPhone } from './frameMode';
import { useLandscape, useVideoFrame } from './videoFrame';

export { FLAG_LABELS } from './parts/Sheets';
export { captionTail } from './parts/Captions';

export interface LiveSessionProps {
  mode: 'test' | 'child';
  avatarId: string;
  /** Child sessions only. */
  childId?: string;
  reason?: Reason;
  childName?: string;
  caregiverName?: string;
  /** What the child calls the parent ("Mom", "Papa"). */
  parentTitle: string;
  /**
   * "Our song" for the DEV fake. Real calls get the song from the server's session context (GET /context), which
   * wins over these; the button shows only when one of them has a title.
   */
  songTitle?: string;
  songLyrics?: string;
  /**
   * Leave the live screen; called at most once per mount. `sessionId` is set only when the call actually went
   * live and has ended (so a check-in can follow); failures and calls that never connected pass undefined.
   * `durationS` comes with a sessionId: the server's length of the call, else the time it was live (P-7).
   */
  onDone: (sessionId?: string, durationS?: number) => void;
  /** Overrides for the DEV fake and tests. */
  start?: () => Promise<StartResult>;
  sdk?: LiveSdk;
  request?: LiveRequest;
  limits?: { warnMs: number; maxMs: number };
  /** The mic pre-flight; the DEV fake passes one that never prompts. */
  micCheck?: UseNapsterSessionOptions['micCheck'];
}

export const END_CARD_MS = 4_000;
export const WARN_COPY = "Let's start saying bye-bye soon 💛";
export const STILL_THERE_COPY = 'Still there? Tap to keep chatting 💛';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function useNow(on: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [on, every]);
  return now;
}

/**
 * The live comfort call (mockup 7, without the child self-view: the child camera is never sent).
 * Shared by parent test calls and caregiver sessions; mount it at /live/:mode or embed it.
 */
export function LiveSession(props: LiveSessionProps) {
  const { mode, avatarId, childId, reason, childName, caregiverName, parentTitle, songTitle, songLyrics } = props;
  useStatusBar('sunset');

  const startRef = useRef<() => Promise<StartResult>>(() => Promise.reject(new Error('unset')));
  startRef.current =
    props.start ??
    (() =>
      mode === 'child'
        ? (api('/sessions', { method: 'POST', json: { childId, avatarId, reason } }) as Promise<StartResult>)
        : (api(`/avatars/${encodeURIComponent(avatarId)}/test-session`, { method: 'POST' }) as Promise<StartResult>));

  const s = useNapsterSession({ start: () => startRef.current(), sdk: props.sdk, request: props.request, limits: props.limits, micCheck: props.micCheck });
  const { state, ctx } = s;
  const song = s.song ?? (songTitle ? { title: songTitle, lyrics: songLyrics } : undefined);
  const [sheet, setSheet] = useState<'volume' | 'flag' | null>(null);

  // Begin on mount. begin() ignores a second call while connecting, so StrictMode's double effect is harmless.
  const beginRef = useRef(s.begin);
  beginRef.current = s.begin;
  useEffect(() => {
    beginRef.current();
  }, []);

  const active = state === 'connecting' || state === 'live';
  const now = useNow(active);
  const elapsed = state === 'live' && ctx.startedAt ? now - ctx.startedAt : 0;
  const bannerOn = ctx.bannerUntil !== undefined && now < ctx.bannerUntil;
  // Re-render exactly when the banner should go (the 1 s tick could be up to a second late).
  const [, force] = useState(0);
  useEffect(() => {
    if (ctx.bannerUntil === undefined) return;
    const left = ctx.bannerUntil - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => force((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [ctx.bannerUntil]);

  // onDone fires once per mount, whichever path gets there first (Continue, the end-card timer, Go back).
  const doneSessionId = ctx.startedAt ? ctx.sessionId : undefined;
  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;
  const doneFired = useRef(false);
  const finish = (sessionId?: string) => {
    if (doneFired.current) return;
    doneFired.current = true;
    if (sessionId) onDoneRef.current(sessionId, s.callSeconds());
    else onDoneRef.current(sessionId);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (state !== 'ended') return;
    const t = setTimeout(() => finishRef.current(doneSessionId), END_CARD_MS);
    return () => clearTimeout(t);
  }, [state, doneSessionId]);

  const who = mode === 'child' ? `${caregiverName?.trim() || 'A grown-up'} is with ${childName?.trim() || 'your little one'}` : null;
  const bannerCopy = mode === 'child' ? `⚑ Flagged for ${parentTitle} — we'll let them know` : '⚑ Flag noted — this is how you would hear about it';
  // The SDK shows its own mic-permission card in its root: give it the whole stage, not the small frame (global.css).
  const inPermission = state === 'connecting' && (s.sdkStatus === 'permissionPending' || s.sdkStatus === 'permissionBlocked');
  // Nothing of ours under the card: no "Calling…" while the mic is pending or blocked (26c).
  const showConnecting = state === 'connecting' && !inPermission;
  const announce = ctx.announce ? `${ctx.announce.role === 'avatar' ? parentTitle : childName?.trim() || 'Child'}: ${ctx.announce.text}` : '';

  const onEnd = () => {
    haptics.light();
    void s.end('user');
  };
  const onSong = () => {
    if (!song) return;
    haptics.light();
    s.sayOurSong(song.title, song.lyrics);
    toast.info(`Singing "${song.title}"`, { icon: '🎵' });
  };

  const rootStyle = { background: gradients.sunset, '--caption-scrim': gradients.captionScrim } as CSSProperties;
  // P-3: the frame takes the video's own aspect ratio and never grows past its intrinsic width.
  const frame = useVideoFrame(s.containerRef);
  // Task 28 (experiment): on a portrait phone a crop mode makes the frame taller and the video covers it, cutting only
  // its sides. Never while the SDK's mic card has the stage. Long-press the frame to cycle the modes (frameMode.ts).
  const portraitPhone = usePortraitPhone();
  const [frameMode, cycleFrameMode] = useFrameMode();
  const crop = inPermission ? null : cropAspect(frameMode, portraitPhone);
  const heroVars: Record<string, string> = crop
    ? { '--live-aspect': String(crop) }
    : { '--live-aspect': String(frame.aspect), '--live-video-w': `${frame.maxWidth}px` };
  const heroStyle = heroVars as CSSProperties;
  const framePress = useLongPress(() => {
    const next = cycleFrameMode();
    haptics.light();
    toast.info(`Frame ${next}`, { icon: '🖼️' });
  }, portraitPhone && !inPermission);
  // P-6: portrait captions get their own reserved band between the stage and the controls; landscape overlays them
  // on the bottom of the frame. Either way they can never reach the controls.
  const landscape = useLandscape();
  const captions = (
    <div
      data-testid="live-captions"
      className={clsx(
        'z-10 flex flex-col items-center gap-2',
        landscape ? 'live-captions-overlay' : 'live-captions-below',
        ctx.captions.some((c) => c.text.trim()) && 'has-captions',
      )}
    >
      <Captions captions={ctx.captions} />
    </div>
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden pl-safe pr-safe text-ink" style={rootStyle} data-testid="live-session" data-state={state}>
      <div className="pt-safe shrink-0" />

      {/* Top chips: always visible (banners sit below them). */}
      <header className="relative z-20 flex shrink-0 flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <Pill>
          <span aria-hidden="true" className="text-liveDot">●</span>
          {state === 'live' ? (
            <span>
              LIVE · <span className="tabular-nums">{mmss(elapsed)}</span>
            </span>
          ) : (
            <span>{state === 'ending' || state === 'ended' ? 'Ending…' : 'Connecting…'}</span>
          )}
        </Pill>
        <Pill className={mode === 'test' ? 'bg-lilac' : undefined}>
          {who ? (
            <>
              <span aria-hidden="true">👩🏽‍🏫</span>
              <span className="truncate">{who}</span>
            </>
          ) : (
            <span className="truncate">Test call · only you can see this</span>
          )}
        </Pill>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col px-4 pt-3">
        {/* Notices, overlaid below the chips so they never shift the avatar or hide LIVE / who-is-here. */}
        <div className="pointer-events-none absolute inset-x-0 top-1 z-30 flex flex-col items-center gap-2 px-4">
          <AnimatePresence>
            {bannerOn ? (
              <fm.div
                key="flag-banner"
                role="status"
                initial={{ y: -16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="w-full max-w-[560px] rounded-[18px] border-[2.5px] border-coral bg-flag px-4 py-3 text-[16px] font-semibold leading-snug text-ink shadow-toast"
              >
                {bannerCopy}
              </fm.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {ctx.warnShown && state === 'live' ? (
              <fm.div key="warn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">
                <Pill className="border-sunD bg-sun">{WARN_COPY}</Pill>
              </fm.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* The stage: what is left between the chips and the captions/controls. The frame is centred in it at the
            video's aspect ratio (P-3), on the screen's own soft gradient. */}
        <div className={clsx('live-stage', inPermission && 'is-permission')} data-testid="live-stage">
          <div className={clsx('live-hero', crop && 'is-crop')} style={heroStyle} data-testid="live-hero" data-frame-mode={crop ? frameMode : '16:9'}>
            <div className="live-frame absolute inset-0 overflow-hidden rounded-[24px] bg-white/20 ring-[3px] ring-white/80" {...framePress}>
              {/* The SDK owns this node's children: React never renders into it. */}
              <div ref={s.containerRef} className="et-avatar-host absolute inset-0" data-testid="avatar-container" />
              {showConnecting ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <span className="relative grid h-20 w-20 place-items-center">
                      <span aria-hidden="true" className="et-breathe absolute inset-0 rounded-full bg-white/60" />
                      <Spinner size={28} />
                    </span>
                    <p className="rounded-full bg-white/85 px-4 py-1.5 text-[17px] font-semibold text-ink">Calling {parentTitle}…</p>
                  </div>
                </div>
              ) : null}
              {state === 'ending' ? (
                <div className="absolute inset-0 grid place-items-center bg-white/40">
                  <p className="rounded-full bg-white px-4 py-1.5 text-[17px] font-semibold text-ink">Saying bye-bye… 👋</p>
                </div>
              ) : null}
            </div>
            {landscape ? captions : null}
          </div>
          {ctx.inactive && state === 'live' ? (
            <div className="live-still-there" data-testid="live-still-there">
              <Button variant="white" onClick={s.keepAlive}>
                {STILL_THERE_COPY}
              </Button>
            </div>
          ) : null}
        </div>
        {landscape ? null : captions}
      </main>

      {/* Screen readers hear each completed line once, never the word-by-word stream. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="caption-announcer">
        {announce}
      </div>

      {/* Controls dock */}
      {/* px, not rem: the dock fits a 360 px phone at 1.0x-1.5x system text (global.css .live-dock, task 26c). */}
      <nav aria-label="Call controls" className="relative z-10 flex shrink-0 justify-center px-2 pb-[max(var(--et-safe-bottom),12px)] pt-2">
        <div className="live-dock rounded-[28px] border-2 border-ink bg-cream/95">
          <Control icon={s.muted ? '🔇' : '🎙️'} label={s.muted ? 'Unmute' : 'Mute'} ariaLabel={s.muted ? 'Unmute microphone' : 'Mute microphone'} pressed={s.muted} disabled={!active} onClick={() => (s.muted ? s.unmute() : s.mute())} />
          <Control icon="🔊" label="Volume" onClick={() => setSheet('volume')} disabled={!active} />
          {song ? <Control icon="🎵" label="Song" ariaLabel="Our song" tone="sun" onClick={onSong} disabled={state !== 'live'} /> : null}
          <Control icon="👋" label="End" tone="coral" ariaLabel="End call" onClick={onEnd} disabled={!active} />
          <Control icon="⚑" label="Flag" ariaLabel="Flag a concern" onClick={() => setSheet('flag')} disabled={!active || !ctx.sessionId} />
        </div>
      </nav>

      <VolumeSheet open={sheet === 'volume'} onClose={() => setSheet(null)} volume={s.volume} onChange={s.setVolume} />
      <FlagSheet open={sheet === 'flag'} onClose={() => setSheet(null)} parentTitle={parentTitle} onSubmit={s.flagManually} />

      {state === 'failed' ? (
        <FullScreen>
          <LiveError code={ctx.error} mode={mode} childName={childName} parentTitle={parentTitle} onRetry={s.begin} onBack={() => finish(undefined)} />
        </FullScreen>
      ) : null}

      {state === 'ended' ? (
        <FullScreen>
          <EndCard reason={ctx.endReason} mode={mode} parentTitle={parentTitle} onContinue={() => finish(doneSessionId)} />
        </FullScreen>
      ) : null}
    </div>
  );
}
