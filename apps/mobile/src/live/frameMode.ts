import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Task 28 (experiment): on a portrait phone the 16:9 frame left the parent small. A crop mode gives the frame a taller
 * aspect and the video COVERS it (global.css `.live-hero.is-crop`): the stream keeps its full height and only its left
 * and right sides are cut, so this is never a zoom. `16:9` is the fitted contain frame (P-3). Landscape and tablets
 * always use 16:9. Long-press the frame to cycle; the choice persists on this device.
 */
export const FRAME_MODES = ['16:9', '1:1', '4:5', '3:4'] as const;
export type FrameMode = (typeof FRAME_MODES)[number];

/** The experiment build starts at 4:5. */
export const DEFAULT_FRAME_MODE: FrameMode = '4:5';
export const FRAME_MODE_KEY = 'everthere.liveFrameMode';
export const LONG_PRESS_MS = 600;
/** A finger that moves further than this (CSS px) is not a long-press. */
const LONG_PRESS_SLOP = 10;

const CROP_ASPECT: Record<Exclude<FrameMode, '16:9'>, number> = { '1:1': 1, '4:5': 0.8, '3:4': 0.75 };

const isFrameMode = (v: unknown): v is FrameMode => typeof v === 'string' && (FRAME_MODES as readonly string[]).includes(v);

export function nextFrameMode(mode: FrameMode): FrameMode {
  return FRAME_MODES[(FRAME_MODES.indexOf(mode) + 1) % FRAME_MODES.length]!;
}

export function loadFrameMode(): FrameMode {
  try {
    const v = window.localStorage.getItem(FRAME_MODE_KEY);
    return isFrameMode(v) ? v : DEFAULT_FRAME_MODE;
  } catch {
    return DEFAULT_FRAME_MODE;
  }
}

export function saveFrameMode(mode: FrameMode): void {
  try {
    window.localStorage.setItem(FRAME_MODE_KEY, mode);
  } catch {
    // Storage unavailable: the mode lasts for this call only.
  }
}

/** The frame's aspect (width / height) for a crop mode on a portrait phone; null means the 16:9 contain frame. */
export function cropAspect(mode: FrameMode, portraitPhone: boolean): number | null {
  if (!portraitPhone || mode === '16:9') return null;
  return CROP_ASPECT[mode];
}

const LANDSCAPE = '(orientation: landscape)';
const TABLET = '(min-width: 700px)';
const isPortraitPhone = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return !window.matchMedia(LANDSCAPE).matches && !window.matchMedia(TABLET).matches;
};

/** True on a phone held upright: not landscape and narrower than 700 CSS px. Follows rotation and resizes. */
export function usePortraitPhone(): boolean {
  const [on, setOn] = useState(isPortraitPhone);
  useEffect(() => {
    const queries = [window.matchMedia?.(LANDSCAPE), window.matchMedia?.(TABLET)];
    const update = () => setOn(isPortraitPhone());
    update();
    queries.forEach((q) => q?.addEventListener?.('change', update));
    window.addEventListener('resize', update);
    return () => {
      queries.forEach((q) => q?.removeEventListener?.('change', update));
      window.removeEventListener('resize', update);
    };
  }, []);
  return on;
}

/** The stored mode and a `cycle()` that moves to the next one, saves it and returns it. */
export function useFrameMode(): [FrameMode, () => FrameMode] {
  const [mode, setMode] = useState<FrameMode>(loadFrameMode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cycle = useCallback(() => {
    const next = nextFrameMode(modeRef.current);
    modeRef.current = next;
    saveFrameMode(next);
    setMode(next);
    return next;
  }, []);
  return [mode, cycle];
}

export interface LongPressHandlers {
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onPointerLeave?: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/**
 * Press and hold (LONG_PRESS_MS, finger still) calls `onLongPress` once. A short tap, a move past the slop, lifting,
 * leaving or a cancelled pointer does nothing. The context menu (Android's long-press menu) is always suppressed.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean, ms = LONG_PRESS_MS): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const cancel = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  const onContextMenu = (e: ReactMouseEvent) => e.preventDefault();
  if (!enabled) return { onContextMenu };
  return {
    onPointerDown: (e) => {
      if (e.button > 0) return; // primary button / touch / pen only
      cancel();
      start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
      timer.current = setTimeout(() => {
        timer.current = undefined;
        start.current = null;
        cb.current();
      }, ms);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s) return;
      if (Math.hypot((e.clientX ?? s.x) - s.x, (e.clientY ?? s.y) - s.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
  };
}
