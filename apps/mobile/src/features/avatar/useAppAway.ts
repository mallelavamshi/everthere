import { useEffect, useState } from 'react';
import { onAppBackground, onAppEvent } from '../../lib/native';

/**
 * true while the app is in the background (Capacitor appStateChange isActive:false, or the page hidden), false
 * again on return. Camera and polling hooks use it to let go while nobody is looking and pick up on resume.
 */
export function useAppAway(): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const offBg = onAppBackground(() => setAway(true));
    const offState = onAppEvent('appStateChange', (e) => {
      if ((e as { isActive?: boolean } | undefined)?.isActive === true) setAway(false);
    });
    const onVis = () => {
      if (document.visibilityState === 'visible') setAway(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      offBg();
      offState();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return away;
}
