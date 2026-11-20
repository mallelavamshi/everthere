import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { colors } from '../theme/tokens';
import { sheetStack } from '../ui/sheetStack';
import { toast } from '../ui/toast';

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// ---- haptics ---------------------------------------------------------------------------------------------------

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* haptics are a nicety, never an error */
  }
}

/** Native haptics on the device, the Vibration API on the web. Never throws. */
export const haptics = {
  /** A light tick for presses. */
  light(): void {
    if (isNative()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else vibrate(10);
  },
  success(): void {
    if (isNative()) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else vibrate([10, 40, 10]);
  },
  error(): void {
    if (isNative()) Haptics.notification({ type: NotificationType.Error }).catch(() => {});
    else vibrate([30, 40, 30]);
  },
};

// ---- offline signal --------------------------------------------------------------------------------------------

// Offline when the OS says so, or when the last request died with a network error. The next successful request
// (or the OS reporting "online" again) clears it.
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let failures = 0;
let failed = false;
let offline = !online;
const netListeners = new Set<() => void>();

function recompute() {
  const next = !online || failed;
  if (next === offline) return;
  offline = next;
  netListeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const sync = () => {
    online = navigator.onLine !== false;
    if (online) {
      failures = 0;
      failed = false;
    }
    recompute();
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}

export const networkStatus = {
  /** The banner needs 2 consecutive failures, so one blip does not flash it. */
  reportFailure() {
    failures += 1;
    failed = failures >= 2;
    recompute();
  },
  reportSuccess() {
    failures = 0;
    failed = false;
    recompute();
  },
  /** Test helper: back to "whatever the browser says". */
  reset() {
    failures = 0;
    failed = false;
    online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    recompute();
  },
  subscribe(cb: () => void) {
    netListeners.add(cb);
    return () => netListeners.delete(cb);
  },
  /** true = offline. */
  getSnapshot: () => offline,
};

export const useOffline = (): boolean => useSyncExternalStore(networkStatus.subscribe, networkStatus.getSnapshot, networkStatus.getSnapshot);

// ---- app lifecycle ---------------------------------------------------------------------------------------------

type AppEvent = 'pause' | 'resume' | 'backButton' | 'appStateChange';

/** Subscribe to a Capacitor App event for the lifetime of the caller. Returns the unsubscribe. */
export function onAppEvent(name: AppEvent, cb: (e?: unknown) => void): () => void {
  let handle: { remove: () => Promise<void> } | null = null;
  let cancelled = false;
  void Promise.resolve(App.addListener(name as 'pause', cb as () => void))
    .then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}

/**
 * Calls `cb` when the app really goes to the background: Capacitor `appStateChange` with `isActive:false`
 * (fired from Activity.onStop), or the page becoming hidden (web / fallback). Deliberately NOT the `pause`
 * event: Android fires onPause for any overlay, including the RECORD_AUDIO permission dialog, which would end
 * a call while the parent is tapping "Allow". `cb` may run twice for one backgrounding; make it idempotent.
 */
export function onAppBackground(cb: () => void): () => void {
  const offState = onAppEvent('appStateChange', (e) => {
    if ((e as { isActive?: boolean } | undefined)?.isActive === false) cb();
  });
  const onVis = () => {
    if (document.visibilityState === 'hidden') cb();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return () => {
    offState();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  };
}

/** Calls `cb` when the app comes back to the foreground: Capacitor `appStateChange` isActive:true, or the page visible again. */
export function onAppResume(cb: () => void): () => void {
  const offState = onAppEvent('appStateChange', (e) => {
    if ((e as { isActive?: boolean } | undefined)?.isActive === true) cb();
  });
  const onVis = () => {
    if (document.visibilityState === 'visible') cb();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return () => {
    offState();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  };
}

/** Runs `cb` when the app goes to the background (see onAppBackground: not on permission dialogs). */
export function useAppBackground(cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onAppBackground(() => ref.current()), []);
}

/** @deprecated Same as useAppBackground (real backgrounding only, never the Android `pause` overlay event). */
export const useAppPause = useAppBackground;

// ---- hardware back button --------------------------------------------------------------------------------------

export const EXIT_WINDOW_MS = 2000;
const ROOTS = new Set(['/', '/onboarding', '/parent', '/admin', '/caregiver']);
export const isRoleRoot = (pathname: string): boolean => ROOTS.has(pathname.replace(/\/+$/, '') || '/');

/**
 * Android back, in order: close the top sheet; go back in history unless on a role root; on a role root, exit
 * only on a second press within 2 s (first press shows a toast). A deep link with no history goes to `home`.
 */
export function useBackButton(home = '/'): void {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useRef({ navigate, location, home });
  state.current = { navigate, location, home };
  const lastPress = useRef<number | null>(null);

  useEffect(() => {
    const unsub = onAppEvent('backButton', () => {
      if (sheetStack.closeTop()) return;
      const { navigate: go, location: loc, home: h } = state.current;
      if (!isRoleRoot(loc.pathname)) {
        if (loc.key === 'default') go(h, { replace: true });
        else go(-1);
        return;
      }
      const now = Date.now();
      if (lastPress.current !== null && now - lastPress.current <= EXIT_WINDOW_MS) {
        lastPress.current = null;
        void App.exitApp();
        return;
      }
      lastPress.current = now;
      toast.info('Press back again to exit');
    });
    return unsub;
  }, []);
}

// ---- status bar ------------------------------------------------------------------------------------------------

export type ScreenBg = 'cream' | 'sunGradient' | 'sunset';

/** Local Android plugin (android/.../WindowBackgroundPlugin.java): paints the window behind the system bars. */
const WindowBackground = registerPlugin<{ setColors(o: { top: string; bottom: string }): Promise<void> }>('WindowBackground');

/** What shows at the top and bottom edge of each screen background. */
const EDGES: Record<ScreenBg, { top: string; bottom: string }> = {
  cream: { top: colors.cream, bottom: colors.cream },
  sunGradient: { top: colors.sunSoft, bottom: colors.cream },
  sunset: { top: colors.sunsetPeach, bottom: colors.sunsetDusk },
};

/**
 * Light status bar (dark icons) tinted to the screen background. Under Android 15 edge-to-edge,
 * StatusBar.setBackgroundColor is ignored and older WebViews (< 140) are inset below the bars, so the window behind
 * them is painted to match the screen too (device test M-4). Newer WebViews draw the page under the bars (pt-safe).
 */
export function setStatusBar(bg: ScreenBg): void {
  if (!isNative()) return;
  const edges = EDGES[bg];
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: edges.top }).catch(() => {});
  try {
    WindowBackground.setColors(edges).catch(() => {});
  } catch {
    /* plugin missing (web, old native build): cosmetic only */
  }
}

export function useStatusBar(bg: ScreenBg = 'cream'): void {
  useEffect(() => setStatusBar(bg), [bg]);
}

// ---- keyboard --------------------------------------------------------------------------------------------------

/**
 * Resize mode `native`: the WebView itself shrinks above the keyboard, so the `h-full` Screen (and its sticky
 * footer) lands directly above it with no JS measuring. `body` would also work but leaves 100%-height roots
 * stale. (setResizeMode is iOS-only; on Android the WebView resize comes from the Keyboard plugin's insets handling.)
 * The focused field is also scrolled into view when the keyboard opens.
 */
export function initKeyboard(): () => void {
  if (!isNative()) return () => {};
  Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
  let handle: { remove: () => Promise<void> } | null = null;
  let cancelled = false;
  void Promise.resolve(
    Keyboard.addListener('keyboardDidShow', () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }),
  )
    .then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
