import { useCallback, useRef, useState, type TouchEvent } from 'react';

const THRESHOLD = 64;
const MAX_PULL = 96;
/** The finger moves further than the page does: a rubber-band feel. */
const DAMPING = 0.5;

/**
 * A small pull-to-refresh for touch. Only starts when the scroll container (the nearest <main>) is at the top and
 * the finger moves down; releasing past the threshold runs `onRefresh`. Spread `bind` on the wrapper.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const live = useRef(0);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const set = (v: number) => {
    live.current = v;
    setPull(v);
  };

  const onTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    const scroller = (e.currentTarget as HTMLElement).closest('main');
    startY.current = busy.current || (scroller && scroller.scrollTop > 0) ? null : (e.touches[0]?.clientY ?? null);
  }, []);

  const onTouchMove = useCallback((e: TouchEvent<HTMLElement>) => {
    if (startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    set(dy > 0 ? Math.min(MAX_PULL, dy * DAMPING) : 0);
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (live.current < THRESHOLD) return set(0);
    busy.current = true;
    setRefreshing(true);
    set(THRESHOLD * 0.75);
    try {
      await refresh.current();
    } catch {
      /* the list shows its own error state */
    } finally {
      busy.current = false;
      setRefreshing(false);
      set(0);
    }
  }, []);

  /** The browser took the gesture (e.g. a system swipe): reset, never refresh. */
  const onTouchCancel = useCallback(() => {
    startY.current = null;
    set(0);
  }, []);

  return {
    pull,
    refreshing,
    ready: pull >= THRESHOLD,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
