import { useEffect, useState } from 'react';

/**
 * On a portrait phone the 16:9 frame left the parent small (task 28). The frame is 4:5 there and the video COVERS it
 * (global.css `.live-hero.is-crop`): the stream keeps its full height and only its left and right sides are cut, so
 * this is never a zoom. The user compared 16:9, 1:1, 4:5 and 3:4 on their phone and kept 4:5 (task 31). Landscape
 * and tablets keep the fitted 16:9 contain frame (P-3).
 */
export const PHONE_FRAME = '4:5';
const PHONE_ASPECT = 4 / 5;

/** The frame's aspect (width / height) on a portrait phone; null means the 16:9 contain frame. */
export function cropAspect(portraitPhone: boolean): number | null {
  return portraitPhone ? PHONE_ASPECT : null;
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
