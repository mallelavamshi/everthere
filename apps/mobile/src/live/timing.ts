/**
 * Connect timing (task 31). One line per step of a call's start, measured from the tap, e.g.
 *   [et-live] +1840ms session created
 * They reach `adb logcat` as Capacitor/Console lines, so a slow connect on a phone can be split into its parts
 * (mic check, our API, Napster's connection, the avatar's first frame). Silent under tests.
 */
let t0: number | null = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function liveMark(step: string, opts: { start?: boolean } = {}): void {
  if (opts.start || t0 === null) t0 = now();
  if (import.meta.env.MODE === 'test') return;
  console.info(`[et-live] +${Math.round(now() - t0)}ms ${step}`);
}
