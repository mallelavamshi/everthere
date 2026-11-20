import { useEffect, useState } from 'react';

/**
 * Viewports shorter than this get compact layouts: a phone in landscape is ~360 px tall, a 7–8" tablet in landscape
 * ~600 px, and the stacked PIN step (face, dots, big 4-row keypad, footer) needs ~680 px.
 */
export const SHORT_SCREEN_MAX_HEIGHT = 700;

const isShort = () => typeof window !== 'undefined' && window.innerHeight < SHORT_SCREEN_MAX_HEIGHT;

/** True while the window is shorter than SHORT_SCREEN_MAX_HEIGHT; follows rotation and resizes. */
export function useShortScreen(): boolean {
  const [short, setShort] = useState(isShort);
  useEffect(() => {
    const on = () => setShort(isShort());
    on();
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return short;
}
