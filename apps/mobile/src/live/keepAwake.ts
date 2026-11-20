import { useEffect } from 'react';

// Keeps the screen on during a live session with the Screen Wake Lock API (Android WebView / Chrome 84+), so no
// native plugin is needed. The OS drops the lock whenever the page is hidden, so it is re-requested on return.
// Best-effort: every failure is swallowed (unsupported, low battery, permission policy).

type Sentinel = { release(): Promise<void> };
type WakeLockNav = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

export function useKeepAwake(on: boolean): void {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined') return;
    const nav = navigator as WakeLockNav;
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let live = true;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock!
        .request('screen')
        .then((s) => {
          if (live) sentinel = s;
          else void s.release().catch(() => {});
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [on]);
}
