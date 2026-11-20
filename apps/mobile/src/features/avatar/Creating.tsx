import { useEffect, useRef, useState } from 'react';
import { motion as fm, useReducedMotion } from 'framer-motion';
import type { AvatarView } from '@everthere/shared';
import { img, type AssetKey } from '../../assets/manifest';
import { alt } from '../../assets/alt';
import { Button, Screen } from '../../ui';
import { fetchAvatar } from './avatarApi';
import { useAppAway } from './useAppAway';

export const POLL_MS = 4000;
export const LINE_MS = 3000;
/** The server fails a stuck avatar at 30 minutes; if we are still seeing `creating` at 35, stop waiting. */
export const GIVE_UP_MS = 35 * 60_000;

const FRAMES: AssetKey[] = ['moment.creating.1', 'moment.creating.2', 'moment.creating.3', 'moment.creating.4', 'moment.creating.5', 'moment.creating.6'];

const LINES = [
  'Warming up the magic ✨',
  'Teaching your avatar your best smile 😊',
  'Tuning your voice 🎵',
  'Sprinkling in a little extra love 💛',
  'Asking the stars to help ⭐',
  'Almost there, hang tight 🌈',
];

export interface CreatingProps {
  avatarId: string;
  /** Fires once, when the avatar is ready (or already approved). */
  onReady: (a: AvatarView) => void;
  /** Failed: go back and take a new photo. */
  onRetake: () => void;
  onBack?: () => void;
}

/**
 * "Making your avatar". Polls GET /avatars/:id every 4 seconds while mounted (and only then). The six
 * moment.creating frames drift between each other, so they crossfade slowly instead of flipping like a flipbook.
 */
export function Creating({ avatarId, onReady, onRetake, onBack }: CreatingProps) {
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0);
  const [line, setLine] = useState(0);
  // Always call the latest handler without restarting the poll.
  const away = useAppAway();
  const startedAt = useRef(Date.now());
  const reduced = useReducedMotion();
  const ready = useRef(onReady);
  ready.current = onReady;

  // The poll runs only while mounted AND in the foreground; it restarts (with an immediate check) on resume.
  useEffect(() => {
    if (away) return;
    let live = true;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    setFailed(false);

    const tick = async () => {
      try {
        const a = await fetchAvatar(avatarId, ctrl.signal);
        if (!live) return;
        if (a.status === 'ready' || a.status === 'approved') {
          done = true;
          ready.current(a);
          return;
        }
        if (a.status === 'failed' || Date.now() - startedAt.current > GIVE_UP_MS) {
          done = true;
          setFailed(true);
          return;
        }
      } catch {
        // A blip in the network must not end the wait: just ask again on the next beat.
        if (!live) return;
      }
      if (live && !done) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [avatarId, ready, away]);

  useEffect(() => {
    if (failed) return;
    const lines = setInterval(() => setLine((n) => (n + 1) % LINES.length), LINE_MS);
    const frames = setInterval(() => setFrame((n) => (n + 1) % FRAMES.length), LINE_MS);
    return () => {
      clearInterval(lines);
      clearInterval(frames);
    };
  }, [failed]);

  if (failed) {
    return (
      <Screen back={onBack}>
        <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
          <img src={img['empty.error']} alt={alt['empty.error']} width={168} height={168} className="object-contain" />
          <h1 className="text-[24px] font-semibold leading-tight">That photo didn't quite work</h1>
          <p className="max-w-[19rem] text-[15px] leading-relaxed text-mutedText">It happens! A bright, front-facing photo with your whole face usually does the trick. Let's try again 💛</p>
          <Button size="lg" icon="📸" haptic onClick={onRetake}>
            Retake my photo
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen bg="sunGradient" back={onBack}>
      <div className="flex min-h-full flex-col items-center justify-center gap-6 px-2 text-center">
        <fm.div className="relative h-[300px] w-[300px]" animate={reduced ? undefined : { y: [0, -10, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}>
          <span aria-hidden="true" className="absolute inset-3 rounded-full bg-sun/30" />
          {FRAMES.map((k, i) => (
            <fm.img
              key={k}
              src={img[k]}
              alt={i === frame ? alt[k] : ''}
              aria-hidden={i === frame ? undefined : true}
              width={300}
              height={300}
              draggable={false}
              initial={false}
              animate={{ opacity: i === frame ? 1 : 0, ...(reduced ? {} : { scale: i === frame ? 1 : 0.96 }) }}
              transition={{ duration: reduced ? 0 : 1.6, ease: 'easeInOut' }}
              className="absolute inset-0 h-full w-full select-none object-contain"
            />
          ))}
        </fm.div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-[26px] font-semibold leading-tight">Making your avatar</h1>
          <p data-testid="creating-line" className="min-h-[28px] text-[18px] font-medium text-ink">
            {LINES[line]}
          </p>
        </div>
        <p className="max-w-[18rem] rounded-card bg-white/70 px-4 py-3 text-[14px] leading-snug text-mutedText">
          This can take a minute or two. Feel free to leave this screen, we'll keep going and your avatar will be waiting in My Avatar.
        </p>
      </div>
    </Screen>
  );
}
