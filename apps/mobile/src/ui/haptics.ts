import { haptics } from '../lib/native';

/** Light haptic tick (kept for callers of the old helper); see lib/native.ts for the full set. */
export function tick(): void {
  haptics.light();
}
